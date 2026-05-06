CREATE TABLE "VectorReference" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "extractedRecordId" TEXT,
  "chunkId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "qdrantCollection" TEXT NOT NULL,
  "qdrantPointId" TEXT NOT NULL,
  "contentPreview" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VectorReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VectorReference_qdrantPointId_key" ON "VectorReference"("qdrantPointId");
CREATE INDEX "VectorReference_workspaceId_documentId_idx" ON "VectorReference"("workspaceId", "documentId");
CREATE INDEX "VectorReference_extractedRecordId_idx" ON "VectorReference"("extractedRecordId");
CREATE INDEX "VectorReference_qdrantCollection_idx" ON "VectorReference"("qdrantCollection");

ALTER TABLE "VectorReference"
  ADD CONSTRAINT "VectorReference_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VectorReference"
  ADD CONSTRAINT "VectorReference_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VectorReference"
  ADD CONSTRAINT "VectorReference_extractedRecordId_fkey"
  FOREIGN KEY ("extractedRecordId") REFERENCES "ExtractedRecord"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
