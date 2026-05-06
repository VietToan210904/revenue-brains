import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getDefaultWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const workspace = await getDefaultWorkspace();

  const job = await prisma.processingJob.findFirst({
    where: {
      id: jobId,
      workspaceId: workspace.id
    },
    include: {
      document: {
        include: {
          extractedRecord: {
            include: {
              fields: true,
              sourceReferences: true,
              vectorReferences: true
            }
          }
        }
      }
    }
  });

  if (!job) {
    return jsonError("Processing job was not found in this workspace.", 404);
  }

  return Response.json({ job });
}
