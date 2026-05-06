import { DocumentStatus, MessageRole, ProcessingJobStatus } from "@/generated/prisma/client";
import { isUploadFile, jsonError, readOptionalString } from "@/lib/api";
import { prisma } from "@/lib/db";
import { storeChatAttachment } from "@/lib/uploads";
import { getDefaultWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    signal: AbortSignal.timeout(10_000)
  });

  return {
    endpoint: "/documents/process",
    ok: response.status === 202,
    statusCode: response.status
  };
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

    const intakeResults = [];

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
          throw new Error(`Python agent returned HTTP ${handoff.statusCode}.`);
        }

        const [updatedDocument, updatedJob] = await prisma.$transaction([
          prisma.document.update({
            where: { id: document.id },
            data: { status: DocumentStatus.HANDOFF_ACCEPTED }
          }),
          prisma.processingJob.update({
            where: { id: job.id },
            data: {
              status: ProcessingJobStatus.PROCESSING,
              stage: "agent_handoff_accepted",
              agentEndpoint: handoff.endpoint,
              agentStatusCode: handoff.statusCode,
              acceptedAt: new Date()
            }
          })
        ]);

        intakeResults.push({
          document: updatedDocument,
          job: updatedJob
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Python agent handoff failed unexpectedly.";
        const [updatedDocument, updatedJob] = await prisma.$transaction([
          prisma.document.update({
            where: { id: document.id },
            data: { status: DocumentStatus.HANDOFF_FAILED }
          }),
          prisma.processingJob.update({
            where: { id: job.id },
            data: {
              status: ProcessingJobStatus.FAILED,
              stage: "agent_handoff_failed",
              agentEndpoint: "/documents/process",
              errorMessage: message,
              failedAt: new Date()
            }
          })
        ]);

        intakeResults.push({
          document: updatedDocument,
          job: updatedJob
        });
      }
    }

    const acceptedCount = intakeResults.filter(
      (result) => result.job.stage === "agent_handoff_accepted"
    ).length;
    const failedCount = intakeResults.filter(
      (result) => result.job.stage === "agent_handoff_failed"
    ).length;
    const assistantContent =
      files.length === 0
        ? "Message saved. Attach a document in chat when you are ready to start processing."
        : `Saved ${files.length} attachment${files.length === 1 ? "" : "s"}. ${acceptedCount} handoff${acceptedCount === 1 ? "" : "s"} accepted by the agent service${failedCount ? `, ${failedCount} failed` : ""}.`;

    const assistantMessage = await prisma.chatMessage.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        role: MessageRole.ASSISTANT,
        content: assistantContent,
        metadata: {
          acceptedCount,
          failedCount,
          processingImplemented: false
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
        jobs: intakeResults.map((result) => result.job)
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
