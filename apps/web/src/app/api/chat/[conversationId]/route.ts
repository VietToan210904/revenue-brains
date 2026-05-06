import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getDefaultWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const workspace = await getDefaultWorkspace();

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      workspaceId: workspace.id
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc"
        }
      },
      documents: {
        orderBy: {
          createdAt: "desc"
        },
        include: {
          extractedRecord: {
            include: {
              fields: true,
              sourceReferences: true,
              vectorReferences: true
            }
          }
        }
      },
      jobs: {
        orderBy: {
          createdAt: "desc"
        }
      },
      extractedRecords: {
        orderBy: {
          createdAt: "desc"
        },
        include: {
          fields: true,
          sourceReferences: true,
          vectorReferences: true
        }
      }
    }
  });

  if (!conversation) {
    return jsonError("Conversation was not found in this workspace.", 404);
  }

  return Response.json({ conversation });
}
