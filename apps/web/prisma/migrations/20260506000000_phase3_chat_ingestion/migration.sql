CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

CREATE TYPE "DocumentType" AS ENUM (
  'INVOICE',
  'CONTRACT',
  'PURCHASE_ORDER',
  'RECEIPT_EXPENSE',
  'KNOWLEDGE',
  'UNKNOWN'
);

CREATE TYPE "DocumentStatus" AS ENUM (
  'ATTACHED',
  'HANDOFF_ACCEPTED',
  'HANDOFF_FAILED'
);

CREATE TYPE "ProcessingJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'FAILED');

CREATE TABLE "Workspace" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMessage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role" "MessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Document" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "userInstructions" TEXT,
  "documentType" "DocumentType" NOT NULL DEFAULT 'UNKNOWN',
  "status" "DocumentStatus" NOT NULL DEFAULT 'ATTACHED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcessingJob" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "status" "ProcessingJobStatus" NOT NULL DEFAULT 'QUEUED',
  "stage" TEXT NOT NULL DEFAULT 'queued',
  "agentEndpoint" TEXT,
  "agentStatusCode" INTEGER,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),

  CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
CREATE INDEX "Conversation_workspaceId_createdAt_idx" ON "Conversation"("workspaceId", "createdAt");
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");
CREATE INDEX "ChatMessage_workspaceId_createdAt_idx" ON "ChatMessage"("workspaceId", "createdAt");
CREATE INDEX "Document_conversationId_createdAt_idx" ON "Document"("conversationId", "createdAt");
CREATE INDEX "Document_workspaceId_createdAt_idx" ON "Document"("workspaceId", "createdAt");
CREATE INDEX "Document_checksum_idx" ON "Document"("checksum");
CREATE INDEX "ProcessingJob_conversationId_createdAt_idx" ON "ProcessingJob"("conversationId", "createdAt");
CREATE INDEX "ProcessingJob_documentId_createdAt_idx" ON "ProcessingJob"("documentId", "createdAt");
CREATE INDEX "ProcessingJob_workspaceId_status_idx" ON "ProcessingJob"("workspaceId", "status");

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_workspaceId_fkey"
  FOREIGN KEY ("workspaceId")
  REFERENCES "Workspace"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_workspaceId_fkey"
  FOREIGN KEY ("workspaceId")
  REFERENCES "Workspace"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_conversationId_fkey"
  FOREIGN KEY ("conversationId")
  REFERENCES "Conversation"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_workspaceId_fkey"
  FOREIGN KEY ("workspaceId")
  REFERENCES "Workspace"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_conversationId_fkey"
  FOREIGN KEY ("conversationId")
  REFERENCES "Conversation"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_messageId_fkey"
  FOREIGN KEY ("messageId")
  REFERENCES "ChatMessage"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ProcessingJob"
  ADD CONSTRAINT "ProcessingJob_workspaceId_fkey"
  FOREIGN KEY ("workspaceId")
  REFERENCES "Workspace"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ProcessingJob"
  ADD CONSTRAINT "ProcessingJob_conversationId_fkey"
  FOREIGN KEY ("conversationId")
  REFERENCES "Conversation"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ProcessingJob"
  ADD CONSTRAINT "ProcessingJob_documentId_fkey"
  FOREIGN KEY ("documentId")
  REFERENCES "Document"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
