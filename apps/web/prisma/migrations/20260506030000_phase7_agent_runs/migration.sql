CREATE TYPE "AgentRunStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'NEEDS_REVIEW',
  'FAILED'
);

CREATE TYPE "AgentStepStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'SKIPPED'
);

CREATE TYPE "AgentArtifactType" AS ENUM (
  'EXTRACTION',
  'QA_ANSWER',
  'VECTOR_MEMORY',
  'FINAL_REPLY',
  'REVIEW_DECISION',
  'RUN_METADATA'
);

CREATE TABLE "AgentRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userMessageId" TEXT NOT NULL,
  "assistantMessageId" TEXT NOT NULL,
  "status" "AgentRunStatus" NOT NULL DEFAULT 'PENDING',
  "goal" TEXT NOT NULL,
  "detectedIntent" TEXT,
  "automationDecision" TEXT,
  "finalReply" TEXT,
  "errorMessage" TEXT,
  "metadata" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentStep" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "agentRunId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "agentName" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" "AgentStepStatus" NOT NULL,
  "inputSummary" TEXT,
  "outputSummary" TEXT,
  "confidence" DOUBLE PRECISION,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentArtifact" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "agentRunId" TEXT NOT NULL,
  "artifactType" "AgentArtifactType" NOT NULL,
  "documentId" TEXT,
  "jobId" TEXT,
  "extractedRecordId" TEXT,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentArtifact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentRun_workspaceId_status_idx" ON "AgentRun"("workspaceId", "status");
CREATE INDEX "AgentRun_conversationId_createdAt_idx" ON "AgentRun"("conversationId", "createdAt");
CREATE INDEX "AgentRun_userMessageId_idx" ON "AgentRun"("userMessageId");
CREATE INDEX "AgentRun_assistantMessageId_idx" ON "AgentRun"("assistantMessageId");

CREATE UNIQUE INDEX "AgentStep_agentRunId_sequence_key" ON "AgentStep"("agentRunId", "sequence");
CREATE INDEX "AgentStep_workspaceId_agentRunId_idx" ON "AgentStep"("workspaceId", "agentRunId");
CREATE INDEX "AgentStep_agentName_idx" ON "AgentStep"("agentName");

CREATE INDEX "AgentArtifact_workspaceId_agentRunId_idx" ON "AgentArtifact"("workspaceId", "agentRunId");
CREATE INDEX "AgentArtifact_artifactType_idx" ON "AgentArtifact"("artifactType");
CREATE INDEX "AgentArtifact_documentId_idx" ON "AgentArtifact"("documentId");
CREATE INDEX "AgentArtifact_jobId_idx" ON "AgentArtifact"("jobId");
CREATE INDEX "AgentArtifact_extractedRecordId_idx" ON "AgentArtifact"("extractedRecordId");

ALTER TABLE "AgentRun"
  ADD CONSTRAINT "AgentRun_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentRun"
  ADD CONSTRAINT "AgentRun_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentStep"
  ADD CONSTRAINT "AgentStep_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentStep"
  ADD CONSTRAINT "AgentStep_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentArtifact"
  ADD CONSTRAINT "AgentArtifact_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentArtifact"
  ADD CONSTRAINT "AgentArtifact_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
