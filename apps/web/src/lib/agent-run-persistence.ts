import {
  AgentArtifactType,
  AgentRunStatus,
  AgentStepStatus,
  DocumentStatus,
  MessageRole,
  ProcessingJobStatus,
  Prisma
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  markExtractionFailed,
  persistExtractionResult,
  type PersistedExtraction,
  type PythonExtractionPayload
} from "@/lib/extraction-persistence";
import { syncExtractionWebhook } from "@/lib/webhook-sync";

export type AgentRunAttachmentPayload = {
  documentId: string;
  fileStorageKey: string;
  checksum: string;
  originalFilename: string;
  contentType: string;
};

export type AgentRunStartAcceptedPayload = {
  status: "accepted";
  agentRunId: string;
  message: string;
};

export type AgentStepEventPayload = {
  sequence?: number;
  agentName: string;
  action: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  inputSummary?: string | null;
  outputSummary?: string | null;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
};

export type AgentQaAnswerPayload = {
  status: "answered";
  answer: string;
  retrievalMode: "postgres" | "qdrant" | "hybrid";
  citations: Array<{
    sourceType: "postgres" | "qdrant";
    documentId?: string | null;
    recordId?: string | null;
    qdrantPointId?: string | null;
    title?: string | null;
    snippet?: string | null;
  }>;
  confidence: number;
  limitations: string[];
};

export type AgentRunCompletePayload = {
  status: "completed" | "needs_review";
  intent: string;
  automationDecision: "safe_to_save" | "save_for_review" | "needs_clarification" | "unsupported";
  reply: string;
  toolActions: Array<{
    tool: string;
    status: string;
    summary: string;
  }>;
  extractions: PythonExtractionPayload[];
  qaAnswer?: AgentQaAnswerPayload | null;
  artifacts?: Array<{
    artifactType: keyof typeof AgentArtifactType;
    documentId?: string | null;
    jobId?: string | null;
    extractedRecordId?: string | null;
    payload: unknown;
  }>;
};

export type AgentRunFailPayload = {
  errorMessage: string;
  agentName?: string | null;
  metadata?: Record<string, unknown>;
};

export function isAgentCallbackAuthorized(request: Request) {
  const expectedSecret = process.env.AGENT_CALLBACK_SECRET ?? "change-me-agent-callback-secret";
  return request.headers.get("x-agent-callback-secret") === expectedSecret;
}

export function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function normalizeAgentStepStatus(status: AgentStepEventPayload["status"]) {
  if (status === "pending") {
    return AgentStepStatus.PENDING;
  }
  if (status === "running") {
    return AgentStepStatus.RUNNING;
  }
  if (status === "failed") {
    return AgentStepStatus.FAILED;
  }
  if (status === "skipped") {
    return AgentStepStatus.SKIPPED;
  }
  return AgentStepStatus.COMPLETED;
}

function isFinalAgentRunStatus(status: AgentRunStatus) {
  return (
    status === AgentRunStatus.COMPLETED ||
    status === AgentRunStatus.NEEDS_REVIEW ||
    status === AgentRunStatus.FAILED
  );
}

export async function persistAgentRunEvent(runId: string, payload: AgentStepEventPayload) {
  const run = await prisma.agentRun.findUniqueOrThrow({
    where: { id: runId }
  });
  const sequence =
    payload.sequence ??
    ((await prisma.agentStep.count({
      where: {
        agentRunId: runId
      }
    })) +
      1);

  const stepWrite = prisma.agentStep.upsert({
    where: {
      agentRunId_sequence: {
        agentRunId: runId,
        sequence
      }
    },
    update: {
      agentName: payload.agentName,
      action: payload.action,
      status: normalizeAgentStepStatus(payload.status),
      inputSummary: payload.inputSummary ?? null,
      outputSummary: payload.outputSummary ?? null,
      confidence: payload.confidence ?? null,
      metadata: payload.metadata === undefined ? undefined : jsonValue(payload.metadata)
    },
    create: {
      workspaceId: run.workspaceId,
      agentRunId: runId,
      sequence,
      agentName: payload.agentName,
      action: payload.action,
      status: normalizeAgentStepStatus(payload.status),
      inputSummary: payload.inputSummary ?? null,
      outputSummary: payload.outputSummary ?? null,
      confidence: payload.confidence ?? null,
      metadata: payload.metadata === undefined ? undefined : jsonValue(payload.metadata)
    }
  });

  if (isFinalAgentRunStatus(run.status)) {
    const step = await stepWrite;
    return { run, step };
  }

  const [updatedRun, step] = await prisma.$transaction([
    prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: AgentRunStatus.RUNNING,
        startedAt: run.startedAt ?? new Date()
      }
    }),
    stepWrite
  ]);

  return { run: updatedRun, step };
}

export async function completeAgentRun(runId: string, payload: AgentRunCompletePayload) {
  const run = await prisma.agentRun.findUniqueOrThrow({
    where: { id: runId }
  });
  const documents = await prisma.document.findMany({
    where: {
      messageId: run.userMessageId
    },
    orderBy: {
      createdAt: "asc"
    }
  });
  const jobs = await prisma.processingJob.findMany({
    where: {
      documentId: {
        in: documents.map((document) => document.id)
      }
    }
  });
  const jobByDocumentId = new Map(jobs.map((job) => [job.documentId, job]));
  const extractionByDocumentId = new Map(
    payload.extractions.map((extraction) => [extraction.documentId, extraction])
  );
  const persistedRecords: PersistedExtraction[] = [];
  const updatedDocuments = [];
  const updatedJobs = [];

  for (const document of documents) {
    const job = jobByDocumentId.get(document.id);
    if (!job) {
      continue;
    }

    const extraction = extractionByDocumentId.get(document.id);
    if (!extraction) {
      const failed = await markExtractionFailed({
        documentId: document.id,
        jobId: job.id,
        agentEndpoint: "/agent/runs/start",
        agentStatusCode: 200,
        errorMessage: "Autonomous run finished without an extraction for this document."
      });
      updatedDocuments.push(failed.document);
      updatedJobs.push(failed.job);
      continue;
    }

    const persisted = await persistExtractionResult({
      workspaceId: run.workspaceId,
      conversationId: run.conversationId,
      documentId: document.id,
      jobId: job.id,
      agentEndpoint: "/agent/runs/start",
      agentStatusCode: 200,
      extraction
    });
    persistedRecords.push(persisted);
    updatedDocuments.push(persisted.document);
    updatedJobs.push(persisted.job);
  }

  for (const persisted of persistedRecords) {
    await prisma.agentArtifact.create({
      data: {
        workspaceId: run.workspaceId,
        agentRunId: runId,
        artifactType: AgentArtifactType.EXTRACTION,
        documentId: persisted.document.id,
        jobId: persisted.job.id,
        extractedRecordId: persisted.extractedRecord.id,
        payload: jsonValue({
          title: persisted.extractedRecord.title,
          documentType: persisted.extractedRecord.documentType,
          confidence: persisted.extractedRecord.confidence,
          validationStatus: persisted.extractedRecord.validationStatus
        })
      }
    });
  }

  if (payload.qaAnswer) {
    await prisma.agentArtifact.create({
      data: {
        workspaceId: run.workspaceId,
        agentRunId: runId,
        artifactType: AgentArtifactType.QA_ANSWER,
        payload: jsonValue(payload.qaAnswer)
      }
    });
  }

  for (const artifact of payload.artifacts ?? []) {
    await prisma.agentArtifact.create({
      data: {
        workspaceId: run.workspaceId,
        agentRunId: runId,
        artifactType: AgentArtifactType[artifact.artifactType] ?? AgentArtifactType.RUN_METADATA,
        documentId: artifact.documentId ?? null,
        jobId: artifact.jobId ?? null,
        extractedRecordId: artifact.extractedRecordId ?? null,
        payload: jsonValue(artifact.payload)
      }
    });
  }

  const finalStatus =
    payload.status === "needs_review" || payload.automationDecision === "save_for_review"
      ? AgentRunStatus.NEEDS_REVIEW
      : AgentRunStatus.COMPLETED;
  const assistantMetadata = jsonValue({
    agent: true,
    pending: false,
    agentRunId: runId,
    intent: payload.intent,
    automationDecision: payload.automationDecision,
    toolActions: payload.toolActions,
    qa: Boolean(payload.qaAnswer),
    retrievalMode: payload.qaAnswer?.retrievalMode,
    confidence: payload.qaAnswer?.confidence,
    citations: payload.qaAnswer?.citations ?? [],
    limitations: payload.qaAnswer?.limitations ?? [],
    extractedCount: payload.extractions.filter(
      (extraction) => extraction.agentAssessment.status === "extracted"
    ).length,
    reviewCount: payload.extractions.filter(
      (extraction) => extraction.agentAssessment.status === "needs_review"
    ).length,
    agentRunStatus: finalStatus
  });

  const [updatedRun, assistantMessage] = await prisma.$transaction([
    prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: finalStatus,
        detectedIntent: payload.intent,
        automationDecision: payload.automationDecision,
        finalReply: payload.reply,
        completedAt: new Date()
      }
    }),
    prisma.chatMessage.update({
      where: { id: run.assistantMessageId },
      data: {
        role: MessageRole.ASSISTANT,
        content: payload.reply,
        metadata: assistantMetadata
      }
    })
  ]);

  const webhookSyncAttempts = [];
  for (const persisted of persistedRecords) {
    const webhookSyncAttempt = await syncExtractionWebhook({
      agentRunId: runId,
      automationDecision: payload.automationDecision,
      persisted
    });

    if (webhookSyncAttempt) {
      webhookSyncAttempts.push(webhookSyncAttempt);
    }
  }

  return {
    run: updatedRun,
    assistantMessage,
    extractedRecords: persistedRecords.map((record) => record.extractedRecord),
    documents: updatedDocuments,
    jobs: updatedJobs,
    webhookSyncAttempts
  };
}

export async function failAgentRun(runId: string, payload: AgentRunFailPayload) {
  const run = await prisma.agentRun.findUniqueOrThrow({
    where: { id: runId }
  });
  const documents = await prisma.document.findMany({
    where: {
      messageId: run.userMessageId
    }
  });
  const jobs = await prisma.processingJob.findMany({
    where: {
      documentId: {
        in: documents.map((document) => document.id)
      }
    }
  });

  await Promise.all(
    jobs.map((job) =>
      prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: ProcessingJobStatus.EXTRACTION_FAILED,
          stage: "agent_run_failed",
          errorMessage: payload.errorMessage,
          failedAt: new Date()
        }
      })
    )
  );
  await Promise.all(
    documents.map((document) =>
      prisma.document.update({
        where: { id: document.id },
        data: {
          status: DocumentStatus.EXTRACTION_FAILED
        }
      })
    )
  );

  const [updatedRun, assistantMessage] = await prisma.$transaction([
    prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: AgentRunStatus.FAILED,
        errorMessage: payload.errorMessage,
        failedAt: new Date()
      }
    }),
    prisma.chatMessage.update({
      where: { id: run.assistantMessageId },
      data: {
        content: `The autonomous agent run failed: ${payload.errorMessage}`,
        metadata: jsonValue({
          agent: true,
          pending: false,
          agentRunId: runId,
          agentRunStatus: AgentRunStatus.FAILED,
          automationDecision: "failed",
          failed: true,
          errorMessage: payload.errorMessage,
          failedAgent: payload.agentName ?? null
        })
      }
    })
  ]);

  return { run: updatedRun, assistantMessage };
}
