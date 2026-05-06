import {
  Document as DocumentModel,
  DocumentStatus,
  DocumentType,
  ExtractedFieldType,
  ProcessingJob,
  ProcessingJobStatus,
  Prisma,
  ValidationStatus
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export type PythonExtractionField = {
  name: string;
  label?: string | null;
  fieldType: string;
  valueString?: string | null;
  valueNumber?: number | null;
  valueDate?: string | null;
  currency?: string | null;
  valueJson?: unknown;
  confidence: number;
  required: boolean;
  validationStatus: "passed" | "needs_review" | "failed";
};

export type PythonSourceReference = {
  fieldName?: string | null;
  pageNumber?: number | null;
  paragraphIndex?: number | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  charStart?: number | null;
  charEnd?: number | null;
  evidenceSnippet?: string | null;
};

export type PythonVectorReference = {
  chunkId: string;
  qdrantCollection: string;
  qdrantPointId: string;
  chunkIndex: number;
  contentPreview: string;
  metadata: Record<string, unknown>;
};

export type PythonExtractionPayload = {
  status: "extracted" | "needs_review";
  documentId: string;
  documentType: string;
  title: string;
  commonFields: PythonExtractionField[];
  typeSpecificFields: PythonExtractionField[];
  summary: string;
  keyFacts: string[];
  tags: string[];
  documentConfidence: number;
  fieldConfidences: Record<string, number>;
  validation: {
    status: "passed" | "needs_review" | "failed";
    missingRequiredFields: string[];
    warnings: string[];
  };
  agentAssessment: {
    status: "extracted" | "needs_review";
    validationStatus: "passed" | "needs_review" | "failed";
    documentConfidence: number;
    reviewRequired: boolean;
    reviewReasons: string[];
    missingFields: string[];
    uncertainFields: string[];
    automationDecision: "safe_to_save" | "save_for_review";
    automationDecisionReason: string;
  };
  sourceReferences: PythonSourceReference[];
  vectorReferences: PythonVectorReference[];
  chatReply: string;
  processingImplemented: true;
};

export type PersistedExtraction = {
  document: DocumentModel;
  job: ProcessingJob;
  extractedRecord: Prisma.ExtractedRecordGetPayload<{
    include: {
      fields: true;
      sourceReferences: true;
      vectorReferences: true;
    };
  }>;
};

export async function persistExtractionResult(input: {
  workspaceId: string;
  conversationId: string;
  documentId: string;
  jobId: string;
  agentEndpoint: string;
  agentStatusCode: number;
  extraction: PythonExtractionPayload;
}): Promise<PersistedExtraction> {
  return prisma.$transaction(async (tx) => {
    const previousRecord = await tx.extractedRecord.findUnique({
      where: {
        documentId: input.documentId
      },
      select: {
        id: true
      }
    });

    if (previousRecord) {
      await tx.vectorReference.deleteMany({
        where: {
          documentId: input.documentId
        }
      });
      await tx.sourceReference.deleteMany({
        where: {
          extractedRecordId: previousRecord.id
        }
      });
      await tx.extractedField.deleteMany({
        where: {
          extractedRecordId: previousRecord.id
        }
      });
      await tx.extractedRecord.delete({
        where: {
          id: previousRecord.id
        }
      });
    }

    await tx.vectorReference.deleteMany({
      where: {
        documentId: input.documentId
      }
    });

    const extractionStatus = input.extraction.agentAssessment.status;
    const validationStatus = normalizeValidationStatus(
      input.extraction.agentAssessment.validationStatus
    );
    const documentType = normalizeDocumentType(input.extraction.documentType);
    const record = await tx.extractedRecord.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        documentId: input.documentId,
        documentType,
        title:
          input.extraction.title ??
          fieldStringValue(input.extraction.commonFields, "title") ??
          "Untitled document",
        summary: input.extraction.summary,
        keyFacts: toJson(input.extraction.keyFacts),
        tags: toJson(input.extraction.tags),
        confidence: input.extraction.agentAssessment.documentConfidence,
        validationStatus,
        normalizedPayload: toJson(input.extraction)
      }
    });

    const fieldIdByName = new Map<string, string>();
    for (const field of [...input.extraction.commonFields, ...input.extraction.typeSpecificFields]) {
      const createdField = await tx.extractedField.create({
        data: {
          workspaceId: input.workspaceId,
          documentId: input.documentId,
          extractedRecordId: record.id,
          name: field.name,
          label: field.label ?? null,
          fieldType: normalizeFieldType(field.fieldType),
          valueString: field.valueString ?? null,
          valueNumber: field.valueNumber ?? null,
          valueDate: parseDateOrNull(field.valueDate),
          currency: field.currency ?? null,
          ...(field.valueJson === undefined || field.valueJson === null
            ? {}
            : { valueJson: toJson(field.valueJson) }),
          confidence: field.confidence,
          required: field.required,
          validationStatus: normalizeValidationStatus(field.validationStatus)
        }
      });
      fieldIdByName.set(field.name, createdField.id);
    }

    for (const reference of input.extraction.sourceReferences) {
      await tx.sourceReference.create({
        data: {
          workspaceId: input.workspaceId,
          documentId: input.documentId,
          extractedRecordId: record.id,
          extractedFieldId: reference.fieldName
            ? fieldIdByName.get(reference.fieldName) ?? null
            : null,
          pageNumber: reference.pageNumber ?? null,
          paragraphIndex: reference.paragraphIndex ?? null,
          lineStart: reference.lineStart ?? null,
          lineEnd: reference.lineEnd ?? null,
          charStart: reference.charStart ?? null,
          charEnd: reference.charEnd ?? null,
          evidenceSnippet: reference.evidenceSnippet ?? null
        }
      });
    }

    for (const vectorReference of input.extraction.vectorReferences ?? []) {
      await tx.vectorReference.create({
        data: {
          workspaceId: input.workspaceId,
          documentId: input.documentId,
          extractedRecordId: record.id,
          chunkId: vectorReference.chunkId,
          chunkIndex: vectorReference.chunkIndex,
          qdrantCollection: vectorReference.qdrantCollection,
          qdrantPointId: vectorReference.qdrantPointId,
          contentPreview: vectorReference.contentPreview,
          metadata: toJson(vectorReference.metadata)
        }
      });
    }

    const document = await tx.document.update({
      where: { id: input.documentId },
      data: {
        documentType,
        status:
          extractionStatus === "extracted" ? DocumentStatus.EXTRACTED : DocumentStatus.NEEDS_REVIEW
      }
    });
    const job = await tx.processingJob.update({
      where: { id: input.jobId },
      data: {
        status:
          extractionStatus === "extracted"
            ? ProcessingJobStatus.EXTRACTED
            : ProcessingJobStatus.NEEDS_REVIEW,
        stage: extractionStatus === "extracted" ? "extraction_completed" : "extraction_needs_review",
        agentEndpoint: input.agentEndpoint,
        agentStatusCode: input.agentStatusCode,
        errorMessage: null,
        acceptedAt: new Date(),
        failedAt: null
      }
    });
    const extractedRecord = await tx.extractedRecord.findUniqueOrThrow({
      where: {
        id: record.id
      },
      include: {
        fields: {
          orderBy: {
            createdAt: "asc"
          }
        },
        sourceReferences: {
          orderBy: {
            createdAt: "asc"
          }
        },
        vectorReferences: {
          orderBy: {
            chunkIndex: "asc"
          }
        }
      }
    });

    return {
      document,
      job,
      extractedRecord
    };
  });
}

export async function markExtractionFailed(input: {
  documentId: string;
  jobId: string;
  agentEndpoint: string;
  agentStatusCode?: number;
  errorMessage: string;
}) {
  const [document, job] = await prisma.$transaction([
    prisma.document.update({
      where: { id: input.documentId },
      data: { status: DocumentStatus.EXTRACTION_FAILED }
    }),
    prisma.processingJob.update({
      where: { id: input.jobId },
      data: {
        status: ProcessingJobStatus.EXTRACTION_FAILED,
        stage: "extraction_failed",
        agentEndpoint: input.agentEndpoint,
        agentStatusCode: input.agentStatusCode ?? null,
        errorMessage: input.errorMessage,
        failedAt: new Date()
      }
    })
  ]);

  return { document, job };
}

function normalizeDocumentType(value: string): DocumentType {
  return value in DocumentType ? DocumentType[value as keyof typeof DocumentType] : DocumentType.UNKNOWN;
}

function normalizeFieldType(value: string): ExtractedFieldType {
  return value in ExtractedFieldType
    ? ExtractedFieldType[value as keyof typeof ExtractedFieldType]
    : ExtractedFieldType.STRING;
}

function normalizeValidationStatus(value: string): ValidationStatus {
  if (value === "passed") {
    return ValidationStatus.PASSED;
  }
  if (value === "failed") {
    return ValidationStatus.FAILED;
  }
  return ValidationStatus.NEEDS_REVIEW;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseDateOrNull(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function fieldStringValue(fields: PythonExtractionField[], name: string) {
  const field = fields.find((candidate) => candidate.name === name);
  return field?.valueString ?? field?.valueDate ?? null;
}
