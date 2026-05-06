import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

loadDotenv({ path: path.resolve(currentDir, "../../.env"), override: false, quiet: true });
loadDotenv({ override: false, quiet: true });

const defaultDatabaseUrl =
  "postgresql://revenue_brains:change-me-local-only@localhost:5432/revenue_brains";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: process.env.DATABASE_URL ?? defaultDatabaseUrl
  }
});
