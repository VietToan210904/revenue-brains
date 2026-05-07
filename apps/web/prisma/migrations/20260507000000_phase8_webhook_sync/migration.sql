CREATE TYPE "WebhookSyncStatus" AS ENUM (
  'PENDING',
  'DELIVERED',
  'FAILED',
  'SKIPPED'
);

CREATE TABLE "WebhookSyncAttempt" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "agentRunId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "extractedRecordId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" "WebhookSyncStatus" NOT NULL DEFAULT 'PENDING',
  "webhookUrl" TEXT,
  "payload" JSONB NOT NULL,
  "responseStatusCode" INTEGER,
  "responseBodyPreview" TEXT,
  "errorMessage" TEXT,
  "attemptedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "skippedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebhookSyncAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookSyncAttempt_workspaceId_status_idx"
  ON "WebhookSyncAttempt"("workspaceId", "status");

CREATE INDEX "WebhookSyncAttempt_agentRunId_createdAt_idx"
  ON "WebhookSyncAttempt"("agentRunId", "createdAt");

CREATE INDEX "WebhookSyncAttempt_documentId_createdAt_idx"
  ON "WebhookSyncAttempt"("documentId", "createdAt");

CREATE INDEX "WebhookSyncAttempt_extractedRecordId_createdAt_idx"
  ON "WebhookSyncAttempt"("extractedRecordId", "createdAt");

CREATE INDEX "WebhookSyncAttempt_eventType_idx"
  ON "WebhookSyncAttempt"("eventType");

ALTER TABLE "WebhookSyncAttempt"
  ADD CONSTRAINT "WebhookSyncAttempt_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookSyncAttempt"
  ADD CONSTRAINT "WebhookSyncAttempt_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookSyncAttempt"
  ADD CONSTRAINT "WebhookSyncAttempt_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookSyncAttempt"
  ADD CONSTRAINT "WebhookSyncAttempt_extractedRecordId_fkey"
  FOREIGN KEY ("extractedRecordId") REFERENCES "ExtractedRecord"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
