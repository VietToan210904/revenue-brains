import "dotenv/config";

import { defineConfig } from "prisma/config";

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
