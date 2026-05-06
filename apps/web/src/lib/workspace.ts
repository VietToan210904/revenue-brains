import { prisma } from "@/lib/db";

const DEFAULT_WORKSPACE_SLUG = "default";

export async function getDefaultWorkspace() {
  return prisma.workspace.upsert({
    where: {
      slug: DEFAULT_WORKSPACE_SLUG
    },
    update: {},
    create: {
      name: "Default Workspace",
      slug: DEFAULT_WORKSPACE_SLUG
    }
  });
}
