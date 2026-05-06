import {
  DocumentStatus,
  MessageRole,
  Prisma,
  ProcessingJobStatus
} from "@/generated/prisma/client";
import { isUploadFile, jsonError, readOptionalString } from "@/lib/api";
import { prisma } from "@/lib/db";
import {
  markExtractionFailed,
  persistExtractionResult,
  type PersistedExtraction,
  type PythonExtractionPayload
} from "@/lib/extraction-persistence";
import { loadLocalEnv } from "@/lib/local-env";
import { storeChatAttachment } from "@/lib/uploads";
import { getDefaultWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

loadLocalEnv();

const pythonAgentUrl = process.env.PYTHON_AGENT_URL ?? "http://localhost:8000";

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

async function callPythonProcessor(input: {
  conversationId: string;
  messageId: string;
  documentId: string;
  workspaceId: string;
  fileStorageKey: string;
  checksum: string;
  originalFilename: string;
  contentType: string;
  userInstructions: string | null;
}) {
  const endpoint = `${pythonAgentUrl.replace(/\/$/, "")}/documents/process`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      conversationId: input.conversationId,
      messageId: input.messageId,
      documentId: input.documentId,
      workspaceId: input.workspaceId,
      fileStorageKey: input.fileStorageKey,
      checksum: input.checksum,
      originalFilename: input.originalFilename,
      contentType: input.contentType,
      userInstructions: input.userInstructions
    }),
    signal: AbortSignal.timeout(75_000)
  });

  const responseText = await response.text();
  const body = responseText ? parseJson(responseText) : null;
  const publicEndpoint = "/documents/process";

  if (!response.ok || !isExtractionPayload(body)) {
    const errorBody =
      typeof body === "object" && body !== null
        ? (body as { message?: string; error?: string })
        : null;
    return {
      endpoint: publicEndpoint,
      ok: false as const,
      statusCode: response.status,
      message:
        errorBody?.message ??
        errorBody?.error ??
        `Python agent returned HTTP ${response.status}.`
    };
  }

  return {
    endpoint: publicEndpoint,
    ok: true as const,
    statusCode: response.status,
    payload: body
  };
}

function parseJson(responseText: string): unknown {
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    return null;
  }
}

function isExtractionPayload(value: unknown): value is PythonExtractionPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<PythonExtractionPayload>;
  return (
    (candidate.status === "extracted" || candidate.status === "needs_review") &&
    typeof candidate.documentId === "string" &&
    typeof candidate.documentType === "string" &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.commonFields) &&
    Array.isArray(candidate.typeSpecificFields) &&
    typeof candidate.summary === "string" &&
    typeof candidate.documentConfidence === "number" &&
    typeof candidate.agentAssessment === "object" &&
    candidate.agentAssessment !== null &&
    (candidate.agentAssessment.status === "extracted" ||
      candidate.agentAssessment.status === "needs_review") &&
    typeof candidate.agentAssessment.documentConfidence === "number" &&
    Array.isArray(candidate.vectorReferences) &&
    typeof candidate.chatReply === "string" &&
    candidate.processingImplemented === true
  );
}

type IntakeResult = {
  document: PersistedExtraction["document"];
  job: PersistedExtraction["job"];
  extractedRecord?: PersistedExtraction["extractedRecord"];
  extraction?: PythonExtractionPayload;
  errorMessage?: string;
};

type RetrievalMode = "postgres" | "qdrant" | "hybrid";

type QaPlanPayload = {
  status: "planned";
  retrievalMode: RetrievalMode;
  postgresQuery: Record<string, unknown>;
  qdrantQuery: string;
  reasoning: string;
};

type QaAnswerPayload = {
  status: "answered";
  answer: string;
  retrievalMode: RetrievalMode;
  citations: Array<{
    sourceType: "postgres" | "qdrant";
    documentId?: string | null;
    recordId?: string | null;
    qdrantPointId?: string | null;
    title?: string | null;
    snippet?: string | null;
  }>;
  confidence: number;
  limitations: string[];
};

async function callQaPlan(input: {
  workspaceId: string;
  conversationId: string;
  question: string;
}): Promise<QaPlanPayload> {
  const endpoint = `${pythonAgentUrl.replace(/\/$/, "")}/qa/plan`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      question: input.question,
      filters: {}
    }),
    signal: AbortSignal.timeout(75_000)
  });
  const responseText = await response.text();
  const body = responseText ? parseJson(responseText) : null;

  if (!response.ok || !isQaPlanPayload(body)) {
    throw new Error(readAgentError(body, response.status));
  }

  return body;
}

async function callQaAnswer(input: {
  workspaceId: string;
  conversationId: string;
  question: string;
  retrievalMode: RetrievalMode;
  postgresEvidence: Array<Record<string, unknown>>;
}): Promise<QaAnswerPayload> {
  const endpoint = `${pythonAgentUrl.replace(/\/$/, "")}/qa/answer`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      question: input.question,
      retrievalMode: input.retrievalMode,
      postgresEvidence: input.postgresEvidence,
      qdrantContext: []
    }),
    signal: AbortSignal.timeout(75_000)
  });
  const responseText = await response.text();
  const body = responseText ? parseJson(responseText) : null;

  if (!response.ok || !isQaAnswerPayload(body)) {
    throw new Error(readAgentError(body, response.status));
  }

  return body;
}

async function getPostgresEvidence(input: {
  workspaceId: string;
  conversationId: string;
  retrievalMode: RetrievalMode;
}) {
  if (input.retrievalMode === "qdrant") {
    return [];
  }

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

async function answerChatQuestion(input: {
  workspaceId: string;
  conversationId: string;
  question: string;
}) {
  const plan = await callQaPlan(input);
  const postgresEvidence = await getPostgresEvidence({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    retrievalMode: plan.retrievalMode
  });
  const answer = await callQaAnswer({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    question: input.question,
    retrievalMode: plan.retrievalMode,
    postgresEvidence
  });

  return { plan, answer, postgresEvidenceCount: postgresEvidence.length };
}

function isQaPlanPayload(value: unknown): value is QaPlanPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<QaPlanPayload>;
  return (
    candidate.status === "planned" &&
    (candidate.retrievalMode === "postgres" ||
      candidate.retrievalMode === "qdrant" ||
      candidate.retrievalMode === "hybrid") &&
    typeof candidate.qdrantQuery === "string" &&
    typeof candidate.reasoning === "string"
  );
}

function isQaAnswerPayload(value: unknown): value is QaAnswerPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<QaAnswerPayload>;
  return (
    candidate.status === "answered" &&
    typeof candidate.answer === "string" &&
    (candidate.retrievalMode === "postgres" ||
      candidate.retrievalMode === "qdrant" ||
      candidate.retrievalMode === "hybrid") &&
    Array.isArray(candidate.citations) &&
    typeof candidate.confidence === "number"
  );
}

function readAgentError(body: unknown, statusCode: number) {
  if (typeof body === "object" && body !== null) {
    const candidate = body as { message?: string; error?: string };
    return candidate.message ?? candidate.error ?? `Python agent returned HTTP ${statusCode}.`;
  }

  return `Python agent returned HTTP ${statusCode}.`;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
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

    if (files.length === 0 && content) {
      let assistantContent: string;
      let metadata: Record<string, unknown>;

      try {
        const qa = await answerChatQuestion({
          workspaceId: workspace.id,
          conversationId: conversation.id,
          question: content
        });
        assistantContent = qa.answer.answer;
        metadata = {
          qa: true,
          retrievalMode: qa.answer.retrievalMode,
          confidence: qa.answer.confidence,
          citations: qa.answer.citations,
          limitations: qa.answer.limitations,
          plan: qa.plan,
          postgresEvidenceCount: qa.postgresEvidenceCount
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "The Q&A agent could not answer right now.";
        assistantContent = `I could not answer from company memory yet: ${message}`;
        metadata = {
          qa: true,
          failed: true,
          errorMessage: message
        };
      }

      const assistantMessage = await prisma.chatMessage.create({
        data: {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          role: MessageRole.ASSISTANT,
          content: assistantContent,
          metadata: toJsonValue(metadata)
        }
      });

      return Response.json(
        {
          conversation,
          userMessage,
          assistantMessage,
          documents: [],
          jobs: [],
          extractedRecords: []
        },
        {
          status: 201
        }
      );
    }

    const intakeResults: IntakeResult[] = [];

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
          stage: "queued"
        }
      });

      try {
        const handoff = await callPythonProcessor({
          conversationId: conversation.id,
          messageId: userMessage.id,
          documentId: document.id,
          workspaceId: workspace.id,
          fileStorageKey: document.storageKey,
          checksum: document.checksum,
          originalFilename: document.originalFilename,
          contentType: document.contentType,
          userInstructions
        });

        if (!handoff.ok) {
          const failure = await markExtractionFailed({
            documentId: document.id,
            jobId: job.id,
            agentEndpoint: handoff.endpoint,
            agentStatusCode: handoff.statusCode,
            errorMessage: handoff.message
          });

          intakeResults.push({
            ...failure,
            errorMessage: handoff.message
          });
          continue;
        }

        const persisted = await persistExtractionResult({
          workspaceId: workspace.id,
          conversationId: conversation.id,
          documentId: document.id,
          jobId: job.id,
          agentEndpoint: handoff.endpoint,
          agentStatusCode: handoff.statusCode,
          extraction: handoff.payload
        });

        intakeResults.push({
          ...persisted,
          extraction: handoff.payload
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Python extraction failed unexpectedly.";
        const failure = await markExtractionFailed({
          documentId: document.id,
          jobId: job.id,
          agentEndpoint: "/documents/process",
          errorMessage: message
        });

        intakeResults.push({
          ...failure,
          errorMessage: message
        });
      }
    }

    const extractedCount = intakeResults.filter(
      (result) => result.extraction?.agentAssessment.status === "extracted"
    ).length;
    const reviewCount = intakeResults.filter(
      (result) => result.extraction?.agentAssessment.status === "needs_review"
    ).length;
    const failedCount = intakeResults.filter((result) => result.errorMessage).length;
    const extractionReplies = intakeResults
      .map((result) =>
        result.extraction
          ? result.extraction.chatReply
          : `Extraction failed for ${result.document.originalFilename}: ${result.errorMessage}`
      )
      .join("\n\n");
    const assistantContent =
      files.length === 0
        ? "Message saved. Attach a document in chat when you are ready to start processing."
        : extractionReplies ||
          `Processed ${files.length} attachment${files.length === 1 ? "" : "s"}.`;

    const assistantMessage = await prisma.chatMessage.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        role: MessageRole.ASSISTANT,
        content: assistantContent,
        metadata: {
          extractedCount,
          reviewCount,
          failedCount,
          processingImplemented: files.length > 0
        }
      }
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        title: conversation.title
      }
    });

    return Response.json(
      {
        conversation,
        userMessage,
        assistantMessage,
        documents: intakeResults.map((result) => result.document),
        jobs: intakeResults.map((result) => result.job),
        extractedRecords: intakeResults.flatMap((result) =>
          result.extractedRecord ? [result.extractedRecord] : []
        )
      },
      {
        status: 201
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
