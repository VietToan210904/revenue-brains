import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { loadLocalEnv } from "@/lib/local-env";

loadLocalEnv();

const defaultDatabaseUrl =
  "postgresql://revenue_brains:change-me-local-only@localhost:5432/revenue_brains";

const connectionString = process.env.DATABASE_URL ?? defaultDatabaseUrl;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString
    })
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
