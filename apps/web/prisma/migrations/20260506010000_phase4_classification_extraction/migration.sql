ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'EXTRACTED';
ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'NEEDS_REVIEW';
ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'EXTRACTION_FAILED';

ALTER TYPE "ProcessingJobStatus" ADD VALUE IF NOT EXISTS 'EXTRACTED';
ALTER TYPE "ProcessingJobStatus" ADD VALUE IF NOT EXISTS 'NEEDS_REVIEW';
ALTER TYPE "ProcessingJobStatus" ADD VALUE IF NOT EXISTS 'EXTRACTION_FAILED';

CREATE TYPE "ValidationStatus" AS ENUM ('PASSED', 'NEEDS_REVIEW', 'FAILED');

CREATE TYPE "ExtractedFieldType" AS ENUM (
  'STRING',
  'NUMBER',
  'DATE',
  'CURRENCY',
  'BOOLEAN',
  'JSON'
);

CREATE TABLE "ExtractedRecord" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "documentType" "DocumentType" NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "keyFacts" JSONB NOT NULL,
  "tags" JSONB NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "validationStatus" "ValidationStatus" NOT NULL,
  "normalizedPayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExtractedRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExtractedField" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "extractedRecordId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "label" TEXT,
  "fieldType" "ExtractedFieldType" NOT NULL,
  "valueString" TEXT,
  "valueNumber" DOUBLE PRECISION,
  "valueDate" TIMESTAMP(3),
  "currency" TEXT,
  "valueJson" JSONB,
  "confidence" DOUBLE PRECISION NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "validationStatus" "ValidationStatus" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ExtractedField_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceReference" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "extractedRecordId" TEXT NOT NULL,
  "extractedFieldId" TEXT,
  "pageNumber" INTEGER,
  "paragraphIndex" INTEGER,
  "lineStart" INTEGER,
  "lineEnd" INTEGER,
  "charStart" INTEGER,
  "charEnd" INTEGER,
  "evidenceSnippet" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SourceReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExtractedRecord_documentId_key" ON "ExtractedRecord"("documentId");
CREATE INDEX "ExtractedRecord_workspaceId_documentType_idx" ON "ExtractedRecord"("workspaceId", "documentType");
CREATE INDEX "ExtractedRecord_conversationId_createdAt_idx" ON "ExtractedRecord"("conversationId", "createdAt");
CREATE INDEX "ExtractedRecord_validationStatus_idx" ON "ExtractedRecord"("validationStatus");

CREATE INDEX "ExtractedField_workspaceId_name_idx" ON "ExtractedField"("workspaceId", "name");
CREATE INDEX "ExtractedField_documentId_name_idx" ON "ExtractedField"("documentId", "name");
CREATE INDEX "ExtractedField_extractedRecordId_idx" ON "ExtractedField"("extractedRecordId");
CREATE INDEX "ExtractedField_validationStatus_idx" ON "ExtractedField"("validationStatus");

CREATE INDEX "SourceReference_workspaceId_documentId_idx" ON "SourceReference"("workspaceId", "documentId");
CREATE INDEX "SourceReference_extractedRecordId_idx" ON "SourceReference"("extractedRecordId");
CREATE INDEX "SourceReference_extractedFieldId_idx" ON "SourceReference"("extractedFieldId");

ALTER TABLE "ExtractedRecord"
  ADD CONSTRAINT "ExtractedRecord_workspaceId_fkey"
  FOREIGN KEY ("workspaceId")
  REFERENCES "Workspace"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ExtractedRecord"
  ADD CONSTRAINT "ExtractedRecord_conversationId_fkey"
  FOREIGN KEY ("conversationId")
  REFERENCES "Conversation"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ExtractedRecord"
  ADD CONSTRAINT "ExtractedRecord_documentId_fkey"
  FOREIGN KEY ("documentId")
  REFERENCES "Document"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ExtractedField"
  ADD CONSTRAINT "ExtractedField_workspaceId_fkey"
  FOREIGN KEY ("workspaceId")
  REFERENCES "Workspace"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ExtractedField"
  ADD CONSTRAINT "ExtractedField_documentId_fkey"
  FOREIGN KEY ("documentId")
  REFERENCES "Document"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ExtractedField"
  ADD CONSTRAINT "ExtractedField_extractedRecordId_fkey"
  FOREIGN KEY ("extractedRecordId")
  REFERENCES "ExtractedRecord"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "SourceReference"
  ADD CONSTRAINT "SourceReference_workspaceId_fkey"
  FOREIGN KEY ("workspaceId")
  REFERENCES "Workspace"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "SourceReference"
  ADD CONSTRAINT "SourceReference_documentId_fkey"
  FOREIGN KEY ("documentId")
  REFERENCES "Document"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "SourceReference"
  ADD CONSTRAINT "SourceReference_extractedRecordId_fkey"
  FOREIGN KEY ("extractedRecordId")
  REFERENCES "ExtractedRecord"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "SourceReference"
  ADD CONSTRAINT "SourceReference_extractedFieldId_fkey"
  FOREIGN KEY ("extractedFieldId")
  REFERENCES "ExtractedField"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
