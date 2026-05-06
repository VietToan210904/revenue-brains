import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getDefaultWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    runId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { runId } = await context.params;
  const workspace = await getDefaultWorkspace();

  const agentRun = await prisma.agentRun.findFirst({
    where: {
      id: runId,
      workspaceId: workspace.id
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

  if (!agentRun) {
    return jsonError("Agent run was not found in this workspace.", 404);
  }

  const [assistantMessage, documents, jobs, extractedRecords] = await Promise.all([
    prisma.chatMessage.findUnique({
      where: {
        id: agentRun.assistantMessageId
      }
    }),
    prisma.document.findMany({
      where: {
        messageId: agentRun.userMessageId
      },
      orderBy: {
        createdAt: "desc"
      }
    }),
    prisma.processingJob.findMany({
      where: {
        conversationId: agentRun.conversationId
      },
      orderBy: {
        createdAt: "desc"
      }
    }),
    prisma.extractedRecord.findMany({
      where: {
        conversationId: agentRun.conversationId
      },
      orderBy: {
        createdAt: "desc"
      },
      include: {
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
    })
  ]);

  return Response.json({
    agentRun,
    assistantMessage,
    documents,
    jobs,
    extractedRecords
  });
}
