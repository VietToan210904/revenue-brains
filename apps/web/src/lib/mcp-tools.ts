import {
  AgentRunStatus,
  DocumentStatus,
  DocumentType,
  MessageRole,
  Prisma,
  ProcessingJobStatus,
  ValidationStatus,
  WebhookSyncStatus
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { type PersistedExtraction } from "@/lib/extraction-persistence";
import { loadLocalEnv } from "@/lib/local-env";
import { syncExtractionWebhook } from "@/lib/webhook-sync";
import { getDefaultWorkspace } from "@/lib/workspace";

loadLocalEnv();

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

export function isMcpInternalRequestAuthorized(request: Request) {
  const expected = process.env.MCP_INTERNAL_API_TOKEN ?? "change-me-internal-mcp-token";
  return request.headers.get("x-mcp-internal-token") === expected;
}

export async function executeMcpTool(tool: string, args: Record<string, unknown>) {
  switch (tool) {
    case "get_workspace_summary":
      return getWorkspaceSummary(args);
    case "search_documents":
      return searchDocuments(args);
    case "get_document_metadata":
      return getDocumentMetadata(args);
    case "get_processing_job":
      return getProcessingJob(args);
    case "search_extracted_records":
      return searchExtractedRecords(args);
    case "get_extracted_record":
      return getExtractedRecord(args);
    case "get_agent_run":
      return getAgentRun(args);
    case "get_vector_references":
      return getVectorReferences(args);
    case "list_webhook_sync_attempts":
      return listWebhookSyncAttempts(args);
    case "trigger_webhook_sync":
      return triggerWebhookSync(args);
    case "request_document_reprocess":
      return requestDocumentReprocess(args);
    default:
      throw new McpToolError(`Unknown MCP tool: ${tool}`, 404);
  }
}

export class McpToolError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function getWorkspaceSummary(args: Record<string, unknown>) {
  const workspace = await resolveWorkspace(args);
  const [
    conversations,
    messages,
    documents,
    extractedRecords,
    vectorReferences,
    agentRuns,
    webhookSyncAttempts
  ] = await Promise.all([
    prisma.conversation.count({ where: { workspaceId: workspace.id } }),
    prisma.chatMessage.count({ where: { workspaceId: workspace.id } }),
    prisma.document.count({ where: { workspaceId: workspace.id } }),
    prisma.extractedRecord.count({ where: { workspaceId: workspace.id } }),
    prisma.vectorReference.count({ where: { workspaceId: workspace.id } }),
    prisma.agentRun.count({ where: { workspaceId: workspace.id } }),
    prisma.webhookSyncAttempt.count({ where: { workspaceId: workspace.id } })
  ]);

  return {
    workspace: pickWorkspace(workspace),
    counts: {
      conversations,
      messages,
      documents,
      extractedRecords,
      vectorReferences,
      agentRuns,
      webhookSyncAttempts
    }
  };
}

async function searchDocuments(args: Record<string, unknown>) {
  const workspace = await resolveWorkspace(args);
  const query = optionalString(args.query);
  const documentType = normalizeEnum(DocumentType, args.documentType);
  const status = normalizeEnum(DocumentStatus, args.status);
  const where: Prisma.DocumentWhereInput = {
    workspaceId: workspace.id,
    ...(documentType ? { documentType } : {}),
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { originalFilename: { contains: query, mode: "insensitive" } },
            { contentType: { contains: query, mode: "insensitive" } },
            { checksum: { contains: query, mode: "insensitive" } }
          ]
        }
      : {})
  };
  const documents = await prisma.document.findMany({
    where,
    orderBy: {
      createdAt: "desc"
    },
    take: safeLimit(args.limit)
  });

  return {
    workspace: pickWorkspace(workspace),
    documents: documents.map(pickDocument)
  };
}

async function getDocumentMetadata(args: Record<string, unknown>) {
  const workspace = await resolveWorkspace(args);
  const documentId = requiredString(args.documentId, "documentId");
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      workspaceId: workspace.id
    },
    include: {
      jobs: {
        orderBy: {
          createdAt: "desc"
        },
        take: 5
      },
      extractedRecord: {
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
      },
      sourceReferences: {
        orderBy: {
          createdAt: "asc"
        },
        take: 20
      },
      vectorReferences: {
        orderBy: {
          chunkIndex: "asc"
        },
        take: 20
      }
    }
  });

  if (!document) {
    throw new McpToolError("Document was not found in this workspace.", 404);
  }

  return {
    workspace: pickWorkspace(workspace),
    document: pickDocument(document),
    jobs: document.jobs.map(pickJob),
    extractedRecord: document.extractedRecord ? pickExtractedRecord(document.extractedRecord) : null,
    sourceReferences: document.sourceReferences.map(pickSourceReference),
    vectorReferences: document.vectorReferences.map(pickVectorReference)
  };
}

async function getProcessingJob(args: Record<string, unknown>) {
  const workspace = await resolveWorkspace(args);
  const jobId = optionalString(args.jobId);
  const documentId = optionalString(args.documentId);
  if (!jobId && !documentId) {
    throw new McpToolError("Provide either jobId or documentId.");
  }

  const job = await prisma.processingJob.findFirst({
    where: {
      workspaceId: workspace.id,
      ...(jobId ? { id: jobId } : { documentId: documentId as string })
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  if (!job) {
    throw new McpToolError("Processing job was not found in this workspace.", 404);
  }

  return {
    workspace: pickWorkspace(workspace),
    job: pickJob(job)
  };
}

async function searchExtractedRecords(args: Record<string, unknown>) {
  const workspace = await resolveWorkspace(args);
  const query = optionalString(args.query);
  const documentType = normalizeEnum(DocumentType, args.documentType);
  const validationStatus = normalizeEnum(ValidationStatus, args.validationStatus);
  const where: Prisma.ExtractedRecordWhereInput = {
    workspaceId: workspace.id,
    ...(documentType ? { documentType } : {}),
    ...(validationStatus ? { validationStatus } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { summary: { contains: query, mode: "insensitive" } },
            {
              document: {
                originalFilename: { contains: query, mode: "insensitive" }
              }
            },
            {
              fields: {
                some: {
                  OR: [
                    { name: { contains: query, mode: "insensitive" } },
                    { valueString: { contains: query, mode: "insensitive" } }
                  ]
                }
              }
            }
          ]
        }
      : {})
  };
  const records = await prisma.extractedRecord.findMany({
    where,
    orderBy: {
      createdAt: "desc"
    },
    take: safeLimit(args.limit),
    include: {
      document: {
        select: {
          id: true,
          originalFilename: true,
          documentType: true,
          status: true
        }
      },
      fields: {
        orderBy: {
          createdAt: "asc"
        },
        take: 25
      },
      sourceReferences: {
        orderBy: {
          createdAt: "asc"
        },
        take: 10
      },
      vectorReferences: {
        orderBy: {
          chunkIndex: "asc"
        },
        take: 10
      }
    }
  });

  return {
    workspace: pickWorkspace(workspace),
    records: records.map((record) => ({
      ...pickExtractedRecord(record),
      document: record.document
    }))
  };
}

async function getExtractedRecord(args: Record<string, unknown>) {
  const workspace = await resolveWorkspace(args);
  const recordId = optionalString(args.recordId);
  const documentId = optionalString(args.documentId);
  if (!recordId && !documentId) {
    throw new McpToolError("Provide either recordId or documentId.");
  }

  const record = await prisma.extractedRecord.findFirst({
    where: {
      workspaceId: workspace.id,
      ...(recordId ? { id: recordId } : { documentId: documentId as string })
    },
    include: {
      document: {
        select: {
          id: true,
          originalFilename: true,
          contentType: true,
          storageKey: true,
          checksum: true,
          status: true,
          documentType: true
        }
      },
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

  if (!record) {
    throw new McpToolError("Extracted record was not found in this workspace.", 404);
  }

  return {
    workspace: pickWorkspace(workspace),
    record: {
      ...pickExtractedRecord(record),
      document: record.document
    }
  };
}

async function getAgentRun(args: Record<string, unknown>) {
  const workspace = await resolveWorkspace(args);
  const agentRunId = requiredString(args.agentRunId, "agentRunId");
  const agentRun = await prisma.agentRun.findFirst({
    where: {
      id: agentRunId,
      workspaceId: workspace.id
    },
    include: {
      steps: {
        orderBy: {
          sequence: "asc"
        }
      },
      artifacts: {
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });

  if (!agentRun) {
    throw new McpToolError("Agent run was not found in this workspace.", 404);
  }

  return {
    workspace: pickWorkspace(workspace),
    agentRun: {
      id: agentRun.id,
      conversationId: agentRun.conversationId,
      status: agentRun.status,
      goal: agentRun.goal,
      detectedIntent: agentRun.detectedIntent,
      automationDecision: agentRun.automationDecision,
      finalReply: agentRun.finalReply,
      errorMessage: agentRun.errorMessage,
      startedAt: agentRun.startedAt,
      completedAt: agentRun.completedAt,
      failedAt: agentRun.failedAt,
      steps: agentRun.steps.map((step) => ({
        id: step.id,
        sequence: step.sequence,
        agentName: step.agentName,
        action: step.action,
        status: step.status,
        inputSummary: step.inputSummary,
        outputSummary: step.outputSummary,
        confidence: step.confidence
      })),
      artifacts: agentRun.artifacts.map((artifact) => ({
        id: artifact.id,
        artifactType: artifact.artifactType,
        documentId: artifact.documentId,
        jobId: artifact.jobId,
        extractedRecordId: artifact.extractedRecordId,
        payload: artifact.payload,
        createdAt: artifact.createdAt
      }))
    }
  };
}

async function getVectorReferences(args: Record<string, unknown>) {
  const workspace = await resolveWorkspace(args);
  const documentId = optionalString(args.documentId);
  const extractedRecordId = optionalString(args.extractedRecordId);
  if (!documentId && !extractedRecordId) {
    throw new McpToolError("Provide either documentId or extractedRecordId.");
  }

  const vectorReferences = await prisma.vectorReference.findMany({
    where: {
      workspaceId: workspace.id,
      ...(documentId ? { documentId } : {}),
      ...(extractedRecordId ? { extractedRecordId } : {})
    },
    orderBy: {
      chunkIndex: "asc"
    },
    take: safeLimit(args.limit)
  });

  return {
    workspace: pickWorkspace(workspace),
    vectorReferences: vectorReferences.map(pickVectorReference)
  };
}

async function listWebhookSyncAttempts(args: Record<string, unknown>) {
  const workspace = await resolveWorkspace(args);
  const status = normalizeEnum(WebhookSyncStatus, args.status);
  const documentId = optionalString(args.documentId);
  const extractedRecordId = optionalString(args.extractedRecordId);
  const attempts = await prisma.webhookSyncAttempt.findMany({
    where: {
      workspaceId: workspace.id,
      ...(documentId ? { documentId } : {}),
      ...(extractedRecordId ? { extractedRecordId } : {}),
      ...(status ? { status } : {})
    },
    orderBy: {
      createdAt: "desc"
    },
    take: safeLimit(args.limit)
  });

  return {
    workspace: pickWorkspace(workspace),
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      eventType: attempt.eventType,
      status: attempt.status,
      webhookUrl: attempt.webhookUrl,
      responseStatusCode: attempt.responseStatusCode,
      responseBodyPreview: attempt.responseBodyPreview,
      errorMessage: attempt.errorMessage,
      attemptedAt: attempt.attemptedAt,
      deliveredAt: attempt.deliveredAt,
      failedAt: attempt.failedAt,
      skippedAt: attempt.skippedAt,
      createdAt: attempt.createdAt
    }))
  };
}

async function triggerWebhookSync(args: Record<string, unknown>) {
  const workspace = await resolveWorkspace(args);
  const extractedRecordId = requiredString(args.extractedRecordId, "extractedRecordId");
  const record = await prisma.extractedRecord.findFirst({
    where: {
      id: extractedRecordId,
      workspaceId: workspace.id
    },
    include: {
      document: true,
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

  if (!record) {
    throw new McpToolError("Extracted record was not found in this workspace.", 404);
  }

  const job = await prisma.processingJob.findFirst({
    where: {
      documentId: record.documentId,
      workspaceId: workspace.id
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  const agentRun =
    optionalString(args.agentRunId) !== null
      ? await prisma.agentRun.findFirst({
          where: {
            id: optionalString(args.agentRunId) ?? undefined,
            workspaceId: workspace.id
          }
        })
      : await prisma.agentRun.findFirst({
          where: {
            conversationId: record.conversationId,
            workspaceId: workspace.id
          },
          orderBy: {
            createdAt: "desc"
          }
        });

  if (!job) {
    throw new McpToolError("Cannot trigger webhook sync because the document has no processing job.", 409);
  }
  if (!agentRun) {
    throw new McpToolError("Cannot trigger webhook sync because no related agent run was found.", 409);
  }

  const persisted: PersistedExtraction = {
    document: record.document,
    job,
    extractedRecord: record
  };
  const attempt = await syncExtractionWebhook({
    agentRunId: agentRun.id,
    automationDecision: "safe_to_save",
    persisted
  });

  return {
    workspace: pickWorkspace(workspace),
    synced: Boolean(attempt),
    attempt: attempt
      ? {
          id: attempt.id,
          status: attempt.status,
          eventType: attempt.eventType,
          responseStatusCode: attempt.responseStatusCode,
          errorMessage: attempt.errorMessage
        }
      : null
  };
}

async function requestDocumentReprocess(args: Record<string, unknown>) {
  const workspace = await resolveWorkspace(args);
  const documentId = requiredString(args.documentId, "documentId");
  const reason = requiredString(args.reason, "reason").slice(0, 500);
  const sourceDocument = await prisma.document.findFirst({
    where: {
      id: documentId,
      workspaceId: workspace.id
    }
  });

  if (!sourceDocument) {
    throw new McpToolError("Document was not found in this workspace.", 404);
  }

  const userMessage = await prisma.chatMessage.create({
    data: {
      workspaceId: workspace.id,
      conversationId: sourceDocument.conversationId,
      role: MessageRole.USER,
      content: `MCP requested reprocessing for ${sourceDocument.originalFilename}: ${reason}`,
      metadata: jsonValue({
        source: "mcp",
        reprocessSourceDocumentId: sourceDocument.id,
        reason
      })
    }
  });
  const assistantMessage = await prisma.chatMessage.create({
    data: {
      workspaceId: workspace.id,
      conversationId: sourceDocument.conversationId,
      role: MessageRole.ASSISTANT,
      content: "The autonomous document team is reprocessing this document.",
      metadata: jsonValue({
        agent: true,
        pending: true,
        source: "mcp",
        automationDecision: "in_progress"
      })
    }
  });
  const clonedDocument = await prisma.document.create({
    data: {
      workspaceId: workspace.id,
      conversationId: sourceDocument.conversationId,
      messageId: userMessage.id,
      originalFilename: sourceDocument.originalFilename,
      contentType: sourceDocument.contentType,
      storageKey: sourceDocument.storageKey,
      checksum: sourceDocument.checksum,
      sizeBytes: sourceDocument.sizeBytes,
      userInstructions: reason,
      status: DocumentStatus.ATTACHED
    }
  });
  const job = await prisma.processingJob.create({
    data: {
      workspaceId: workspace.id,
      conversationId: sourceDocument.conversationId,
      documentId: clonedDocument.id,
      status: ProcessingJobStatus.QUEUED,
      stage: "mcp_reprocess_queued"
    }
  });
  const agentRun = await prisma.agentRun.create({
    data: {
      workspaceId: workspace.id,
      conversationId: sourceDocument.conversationId,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      status: AgentRunStatus.PENDING,
      goal: userMessage.content,
      metadata: jsonValue({
        source: "mcp",
        reprocessSourceDocumentId: sourceDocument.id,
        reprocessDocumentId: clonedDocument.id,
        reason
      })
    }
  });

  try {
    await startPythonAgentRun({
      agentRunId: agentRun.id,
      workspaceId: workspace.id,
      conversationId: sourceDocument.conversationId,
      messageId: userMessage.id,
      userMessage: userMessage.content,
      userInstructions: reason,
      attachment: {
        documentId: clonedDocument.id,
        fileStorageKey: clonedDocument.storageKey,
        checksum: clonedDocument.checksum,
        originalFilename: clonedDocument.originalFilename,
        contentType: clonedDocument.contentType
      }
    });
    await prisma.$transaction([
      prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: AgentRunStatus.RUNNING,
          startedAt: new Date()
        }
      }),
      prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: ProcessingJobStatus.PROCESSING,
          stage: "mcp_reprocess_started",
          acceptedAt: new Date()
        }
      })
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP reprocess run could not start.";
    await prisma.$transaction([
      prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: AgentRunStatus.FAILED,
          errorMessage: message,
          failedAt: new Date()
        }
      }),
      prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: ProcessingJobStatus.FAILED,
          stage: "mcp_reprocess_start_failed",
          errorMessage: message,
          failedAt: new Date()
        }
      }),
      prisma.chatMessage.update({
        where: { id: assistantMessage.id },
        data: {
          content: `The MCP reprocess request could not start: ${message}`,
          metadata: jsonValue({
            agent: true,
            pending: false,
            source: "mcp",
            failed: true,
            errorMessage: message
          })
        }
      })
    ]);
  }

  return {
    workspace: pickWorkspace(workspace),
    sourceDocument: pickDocument(sourceDocument),
    reprocessDocument: pickDocument(clonedDocument),
    agentRun: {
      id: agentRun.id,
      status: agentRun.status,
      conversationId: agentRun.conversationId
    },
    job: pickJob(job)
  };
}

async function startPythonAgentRun(input: {
  agentRunId: string;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  userMessage: string;
  userInstructions: string;
  attachment: {
    documentId: string;
    fileStorageKey: string;
    checksum: string;
    originalFilename: string;
    contentType: string;
  };
}) {
  const pythonAgentUrl = process.env.PYTHON_AGENT_URL ?? "http://localhost:8000";
  const callbackBaseUrl = process.env.AGENT_CALLBACK_BASE_URL ?? "http://localhost:3000";
  const response = await fetch(`${pythonAgentUrl.replace(/\/$/, "")}/agent/runs/start`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      agentRunId: input.agentRunId,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      userMessage: input.userMessage,
      userInstructions: input.userInstructions,
      attachments: [input.attachment],
      postgresEvidence: [],
      callbackBaseUrl,
      processingOptions: {
        source: "mcp",
        reprocess: true
      }
    }),
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    throw new Error(`Python agent returned HTTP ${response.status}.`);
  }
}

async function resolveWorkspace(args: Record<string, unknown>) {
  const workspaceId = optionalString(args.workspaceId);
  if (!workspaceId) {
    return getDefaultWorkspace();
  }

  const workspace = await prisma.workspace.findUnique({
    where: {
      id: workspaceId
    }
  });

  if (!workspace) {
    throw new McpToolError("Workspace was not found.", 404);
  }

  return workspace;
}

function pickWorkspace(workspace: { id: string; name: string; slug: string }) {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug
  };
}

function pickDocument(document: {
  id: string;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  originalFilename: string;
  contentType: string;
  storageKey: string;
  checksum: string;
  sizeBytes: number;
  userInstructions: string | null;
  documentType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: document.id,
    workspaceId: document.workspaceId,
    conversationId: document.conversationId,
    messageId: document.messageId,
    originalFilename: document.originalFilename,
    contentType: document.contentType,
    storageKey: document.storageKey,
    checksum: document.checksum,
    sizeBytes: document.sizeBytes,
    userInstructions: document.userInstructions,
    documentType: document.documentType,
    status: document.status,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}

function pickJob(job: {
  id: string;
  documentId: string;
  status: string;
  stage: string;
  agentEndpoint: string | null;
  agentStatusCode: number | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  acceptedAt: Date | null;
  failedAt: Date | null;
}) {
  return {
    id: job.id,
    documentId: job.documentId,
    status: job.status,
    stage: job.stage,
    agentEndpoint: job.agentEndpoint,
    agentStatusCode: job.agentStatusCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    acceptedAt: job.acceptedAt,
    failedAt: job.failedAt
  };
}

function pickExtractedRecord(record: {
  id: string;
  documentId: string;
  documentType: string;
  title: string;
  summary: string;
  keyFacts: Prisma.JsonValue;
  tags: Prisma.JsonValue;
  confidence: number;
  validationStatus: string;
  createdAt: Date;
  updatedAt: Date;
  fields?: Array<Parameters<typeof pickField>[0]>;
  sourceReferences?: Array<Parameters<typeof pickSourceReference>[0]>;
  vectorReferences?: Array<Parameters<typeof pickVectorReference>[0]>;
}) {
  return {
    id: record.id,
    documentId: record.documentId,
    documentType: record.documentType,
    title: record.title,
    summary: record.summary,
    keyFacts: record.keyFacts,
    tags: record.tags,
    confidence: record.confidence,
    validationStatus: record.validationStatus,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    fields: record.fields?.map(pickField) ?? [],
    sourceReferences: record.sourceReferences?.map(pickSourceReference) ?? [],
    vectorReferences: record.vectorReferences?.map(pickVectorReference) ?? []
  };
}

function pickField(field: {
  id: string;
  name: string;
  label: string | null;
  fieldType: string;
  valueString: string | null;
  valueNumber: number | null;
  valueDate: Date | null;
  currency: string | null;
  valueJson: Prisma.JsonValue | null;
  confidence: number;
  required: boolean;
  validationStatus: string;
}) {
  return {
    id: field.id,
    name: field.name,
    label: field.label,
    fieldType: field.fieldType,
    valueString: field.valueString,
    valueNumber: field.valueNumber,
    valueDate: field.valueDate,
    currency: field.currency,
    valueJson: field.valueJson,
    confidence: field.confidence,
    required: field.required,
    validationStatus: field.validationStatus
  };
}

function pickSourceReference(reference: {
  id: string;
  extractedFieldId: string | null;
  pageNumber: number | null;
  paragraphIndex: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  charStart?: number | null;
  charEnd?: number | null;
  evidenceSnippet: string | null;
}) {
  return {
    id: reference.id,
    extractedFieldId: reference.extractedFieldId,
    pageNumber: reference.pageNumber,
    paragraphIndex: reference.paragraphIndex,
    lineStart: reference.lineStart,
    lineEnd: reference.lineEnd,
    charStart: reference.charStart ?? null,
    charEnd: reference.charEnd ?? null,
    evidenceSnippet: reference.evidenceSnippet
  };
}

function pickVectorReference(reference: {
  id: string;
  documentId: string;
  extractedRecordId: string | null;
  chunkId: string;
  chunkIndex: number;
  qdrantCollection: string;
  qdrantPointId: string;
  contentPreview: string;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}) {
  return {
    id: reference.id,
    documentId: reference.documentId,
    extractedRecordId: reference.extractedRecordId,
    chunkId: reference.chunkId,
    chunkIndex: reference.chunkIndex,
    qdrantCollection: reference.qdrantCollection,
    qdrantPointId: reference.qdrantPointId,
    contentPreview: reference.contentPreview,
    metadata: reference.metadata,
    createdAt: reference.createdAt
  };
}

function safeLimit(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeEnum<T extends Record<string, string>>(values: T, value: unknown): T[keyof T] | null {
  const normalized = optionalString(value);
  if (!normalized || !(normalized in values)) {
    return null;
  }

  return values[normalized as keyof T];
}

function requiredString(value: unknown, name: string) {
  const result = optionalString(value);
  if (!result) {
    throw new McpToolError(`${name} is required.`);
  }
  return result;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
