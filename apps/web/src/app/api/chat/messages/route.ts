import { AgentRunStatus, DocumentStatus, MessageRole, ProcessingJobStatus } from "@/generated/prisma/client";
import { isUploadFile, jsonError, readOptionalString } from "@/lib/api";
import {
  failAgentRun,
  jsonValue,
  type AgentRunAttachmentPayload,
  type AgentRunStartAcceptedPayload
} from "@/lib/agent-run-persistence";
import { prisma } from "@/lib/db";
import { loadLocalEnv } from "@/lib/local-env";
import { storeChatAttachment } from "@/lib/uploads";
import { getDefaultWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

loadLocalEnv();

const pythonAgentUrl = process.env.PYTHON_AGENT_URL ?? "http://localhost:8000";
const callbackBaseUrl = process.env.AGENT_CALLBACK_BASE_URL ?? "http://localhost:3000";

function isDatabaseSetupError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : null;

  return (
    code === "ECONNREFUSED" ||
    code === "P1000" ||
    code === "P1001" ||
    code === "P2021" ||
    code === "P2022"
  );
}

function titleFromMessage(content: string | null, fileCount: number) {
  if (content) {
    return content.length > 70 ? `${content.slice(0, 67)}...` : content;
  }

  return fileCount === 1 ? "Document intake" : "Document intake thread";
}

function parseJson(responseText: string): unknown {
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    return null;
  }
}

function isRunAcceptedPayload(value: unknown): value is AgentRunStartAcceptedPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AgentRunStartAcceptedPayload>;
  return (
    candidate.status === "accepted" &&
    typeof candidate.agentRunId === "string" &&
    typeof candidate.message === "string"
  );
}

function readAgentError(body: unknown, statusCode: number) {
  if (typeof body === "object" && body !== null) {
    const candidate = body as { message?: string; error?: string };
    return candidate.message ?? candidate.error ?? `Python agent returned HTTP ${statusCode}.`;
  }

  return `Python agent returned HTTP ${statusCode}.`;
}

async function getRecentPostgresEvidence(input: { workspaceId: string }) {
  const records = await prisma.extractedRecord.findMany({
    where: {
      workspaceId: input.workspaceId
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 10,
    include: {
      document: {
        select: {
          id: true,
          originalFilename: true,
          documentType: true,
          status: true,
          createdAt: true
        }
      },
      fields: {
        orderBy: {
          createdAt: "asc"
        }
      },
      sourceReferences: {
        orderBy: {
          createdAt: "asc"
        }
      },
      vectorReferences: {
        orderBy: {
          chunkIndex: "asc"
        }
      }
    }
  });

  return records.map((record) => ({
    recordId: record.id,
    documentId: record.documentId,
    documentType: record.documentType,
    title: record.title,
    summary: record.summary,
    confidence: record.confidence,
    validationStatus: record.validationStatus,
    document: record.document,
    fields: record.fields.map((field) => ({
      name: field.name,
      label: field.label,
      fieldType: field.fieldType,
      valueString: field.valueString,
      valueNumber: field.valueNumber,
      valueDate: field.valueDate,
      currency: field.currency,
      valueJson: field.valueJson,
      confidence: field.confidence,
      validationStatus: field.validationStatus
    })),
    sourceReferences: record.sourceReferences.map((reference) => ({
      pageNumber: reference.pageNumber,
      paragraphIndex: reference.paragraphIndex,
      lineStart: reference.lineStart,
      evidenceSnippet: reference.evidenceSnippet
    })),
    vectorReferences: record.vectorReferences.map((reference) => ({
      qdrantCollection: reference.qdrantCollection,
      qdrantPointId: reference.qdrantPointId,
      chunkIndex: reference.chunkIndex,
      contentPreview: reference.contentPreview
    }))
  }));
}

async function callAutonomousRunStart(input: {
  agentRunId: string;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  userMessage: string;
  userInstructions: string | null;
  attachments: AgentRunAttachmentPayload[];
  postgresEvidence: Array<Record<string, unknown>>;
}) {
  const endpoint = `${pythonAgentUrl.replace(/\/$/, "")}/agent/runs/start`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      agentRunId: input.agentRunId,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      userMessage: input.userMessage,
      userInstructions: input.userInstructions,
      attachments: input.attachments,
      postgresEvidence: input.postgresEvidence,
      callbackBaseUrl,
      processingOptions: {}
    }),
    signal: AbortSignal.timeout(15_000)
  });
  const responseText = await response.text();
  const body = responseText ? parseJson(responseText) : null;

  if (!response.ok || !isRunAcceptedPayload(body)) {
    throw new Error(readAgentError(body, response.status));
  }

  return body;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const content = readOptionalString(formData.get("content"));
    const userInstructions = readOptionalString(formData.get("userInstructions"));
    const requestedConversationId = readOptionalString(formData.get("conversationId"));
    const files = formData.getAll("files").filter(isUploadFile);

    if (!content && files.length === 0) {
      return jsonError("Send a message, attach at least one file, or do both.", 400);
    }

    const workspace = await getDefaultWorkspace();
    const conversation = requestedConversationId
      ? await prisma.conversation.findFirst({
          where: {
            id: requestedConversationId,
            workspaceId: workspace.id
          }
        })
      : await prisma.conversation.create({
          data: {
            title: titleFromMessage(content, files.length),
            workspaceId: workspace.id
          }
        });

    if (!conversation) {
      return jsonError("Conversation was not found in this workspace.", 404);
    }

    const userMessage = await prisma.chatMessage.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        role: MessageRole.USER,
        content: content ?? "Attached documents for processing.",
        metadata: {
          userInstructions,
          attachmentCount: files.length
        }
      }
    });
    const assistantMessage = await prisma.chatMessage.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        role: MessageRole.ASSISTANT,
        content:
          "The autonomous document team is working on this. I will update this message when the run finishes.",
        metadata: jsonValue({
          agent: true,
          pending: true,
          intent: "agent_run",
          automationDecision: "in_progress",
          toolActions: [
            {
              tool: "manager_agent",
              status: "running",
              summary: "Autonomous run accepted by the web app."
            }
          ]
        })
      }
    });
    const agentRun = await prisma.agentRun.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        status: AgentRunStatus.PENDING,
        goal: userMessage.content,
        metadata: jsonValue({
          userInstructions,
          attachmentCount: files.length
        })
      }
    });

    const attachments: AgentRunAttachmentPayload[] = [];
    const documents = [];
    const jobs = [];
    for (const file of files) {
      const storedUpload = await storeChatAttachment(file);
      const document = await prisma.document.create({
        data: {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          messageId: userMessage.id,
          originalFilename: storedUpload.originalFilename,
          contentType: storedUpload.contentType,
          storageKey: storedUpload.storageKey,
          checksum: storedUpload.checksum,
          sizeBytes: storedUpload.sizeBytes,
          userInstructions,
          status: DocumentStatus.ATTACHED
        }
      });
      const job = await prisma.processingJob.create({
        data: {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          documentId: document.id,
          status: ProcessingJobStatus.QUEUED,
          stage: "agent_run_queued"
        }
      });

      documents.push(document);
      jobs.push(job);
      attachments.push({
        documentId: document.id,
        fileStorageKey: document.storageKey,
        checksum: document.checksum,
        originalFilename: document.originalFilename,
        contentType: document.contentType
      });
    }
    let responseJobs = jobs;

    try {
      const postgresEvidence = await getRecentPostgresEvidence({ workspaceId: workspace.id });
      await callAutonomousRunStart({
        agentRunId: agentRun.id,
        workspaceId: workspace.id,
        conversationId: conversation.id,
        messageId: userMessage.id,
        userMessage: userMessage.content,
        userInstructions,
        attachments,
        postgresEvidence
      });
      await prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: AgentRunStatus.RUNNING,
          startedAt: new Date()
        }
      });
      if (jobs.length > 0) {
        const acceptedAt = new Date();
        await prisma.processingJob.updateMany({
          where: {
            id: {
              in: jobs.map((job) => job.id)
            }
          },
          data: {
            status: ProcessingJobStatus.PROCESSING,
            stage: "agent_run_started",
            acceptedAt
          }
        });
        responseJobs = jobs.map((job) => ({
          ...job,
          status: ProcessingJobStatus.PROCESSING,
          stage: "agent_run_started",
          acceptedAt
        }));
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The autonomous agent run could not start.";
      await failAgentRun(agentRun.id, {
        errorMessage: message,
        agentName: "Manager Agent"
      });
    }

    const updatedRun = await prisma.agentRun.findUniqueOrThrow({
      where: {
        id: agentRun.id
      },
      include: {
        steps: {
          orderBy: {
            sequence: "asc"
          }
        },
        artifacts: {
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    });
    const updatedAssistantMessage = await prisma.chatMessage.findUniqueOrThrow({
      where: {
        id: assistantMessage.id
      }
    });

    return Response.json(
      {
        conversation,
        userMessage,
        assistantMessage: updatedAssistantMessage,
        documents,
        jobs: responseJobs,
        extractedRecords: [],
        agentRun: updatedRun
      },
      {
        status: 202
      }
    );
  } catch (error) {
    if (isDatabaseSetupError(error)) {
      return jsonError(
        "Postgres is not ready. Start Docker Desktop, run `docker compose up -d postgres qdrant`, then run `npm run db:migrate`.",
        503
      );
    }

    const message =
      error instanceof Error ? error.message : "Chat message could not be processed.";

    return jsonError(message, 500);
  }
}
