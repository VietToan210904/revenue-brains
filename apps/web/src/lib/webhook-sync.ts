import { createHmac, randomUUID } from "node:crypto";

import { DocumentStatus, ValidationStatus, WebhookSyncStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { loadLocalEnv } from "@/lib/local-env";
import { type PersistedExtraction } from "@/lib/extraction-persistence";

const WEBHOOK_EVENT_TYPE = "extraction.completed";
const WEBHOOK_TIMEOUT_MS = 10_000;
const RESPONSE_PREVIEW_LIMIT = 500;

loadLocalEnv();

export async function syncExtractionWebhook(input: {
  agentRunId: string;
  automationDecision: string;
  persisted: PersistedExtraction;
}) {
  if (!shouldSyncExtraction(input)) {
    return null;
  }

  const webhookUrl = process.env.WEBHOOK_URL?.trim() ?? "";
  const webhookSecret = process.env.WEBHOOK_SECRET ?? "";
  const deliveryId = randomUUID();
  const payload = buildWebhookPayload({
    deliveryId,
    agentRunId: input.agentRunId,
    automationDecision: input.automationDecision,
    persisted: input.persisted
  });

  if (!webhookUrl) {
    return prisma.webhookSyncAttempt.create({
      data: {
        id: deliveryId,
        workspaceId: input.persisted.document.workspaceId,
        agentRunId: input.agentRunId,
        documentId: input.persisted.document.id,
        extractedRecordId: input.persisted.extractedRecord.id,
        eventType: WEBHOOK_EVENT_TYPE,
        status: WebhookSyncStatus.SKIPPED,
        payload: jsonValue(payload),
        errorMessage: "WEBHOOK_URL is not configured.",
        skippedAt: new Date()
      }
    });
  }

  if (!webhookSecret) {
    return prisma.webhookSyncAttempt.create({
      data: {
        id: deliveryId,
        workspaceId: input.persisted.document.workspaceId,
        agentRunId: input.agentRunId,
        documentId: input.persisted.document.id,
        extractedRecordId: input.persisted.extractedRecord.id,
        eventType: WEBHOOK_EVENT_TYPE,
        status: WebhookSyncStatus.FAILED,
        webhookUrl: safeWebhookUrl(webhookUrl),
        payload: jsonValue(payload),
        errorMessage: "WEBHOOK_SECRET is required when WEBHOOK_URL is configured.",
        attemptedAt: new Date(),
        failedAt: new Date()
      }
    });
  }

  await prisma.webhookSyncAttempt.create({
    data: {
      id: deliveryId,
      workspaceId: input.persisted.document.workspaceId,
      agentRunId: input.agentRunId,
      documentId: input.persisted.document.id,
      extractedRecordId: input.persisted.extractedRecord.id,
      eventType: WEBHOOK_EVENT_TYPE,
      status: WebhookSyncStatus.PENDING,
      webhookUrl: safeWebhookUrl(webhookUrl),
      payload: jsonValue(payload),
      attemptedAt: new Date()
    }
  });

  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", webhookSecret).update(body).digest("hex")}`;

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-revenue-brains-event": WEBHOOK_EVENT_TYPE,
        "x-revenue-brains-delivery-id": deliveryId,
        "x-revenue-brains-signature": signature
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
    });
    const responseText = await response.text();

    if (response.ok) {
      return prisma.webhookSyncAttempt.update({
        where: { id: deliveryId },
        data: {
          status: WebhookSyncStatus.DELIVERED,
          responseStatusCode: response.status,
          responseBodyPreview: preview(responseText),
          deliveredAt: new Date()
        }
      });
    }

    return prisma.webhookSyncAttempt.update({
      where: { id: deliveryId },
      data: {
        status: WebhookSyncStatus.FAILED,
        responseStatusCode: response.status,
        responseBodyPreview: preview(responseText),
        errorMessage: `Webhook returned HTTP ${response.status}.`,
        failedAt: new Date()
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook delivery failed.";
    return prisma.webhookSyncAttempt.update({
      where: { id: deliveryId },
      data: {
        status: WebhookSyncStatus.FAILED,
        errorMessage: message,
        failedAt: new Date()
      }
    });
  }
}

function shouldSyncExtraction(input: {
  automationDecision: string;
  persisted: PersistedExtraction;
}) {
  return (
    input.automationDecision === "safe_to_save" &&
    input.persisted.document.status === DocumentStatus.EXTRACTED &&
    input.persisted.extractedRecord.validationStatus === ValidationStatus.PASSED
  );
}

function buildWebhookPayload(input: {
  deliveryId: string;
  agentRunId: string;
  automationDecision: string;
  persisted: PersistedExtraction;
}) {
  const { document, extractedRecord } = input.persisted;

  return {
    event: WEBHOOK_EVENT_TYPE,
    deliveryId: input.deliveryId,
    workspaceId: document.workspaceId,
    conversationId: document.conversationId,
    agentRun: {
      id: input.agentRunId,
      automationDecision: input.automationDecision
    },
    document: {
      id: document.id,
      originalFilename: document.originalFilename,
      contentType: document.contentType,
      storageKey: document.storageKey,
      checksum: document.checksum,
      documentType: document.documentType,
      status: document.status
    },
    extractedRecord: {
      id: extractedRecord.id,
      title: extractedRecord.title,
      summary: extractedRecord.summary,
      documentType: extractedRecord.documentType,
      confidence: extractedRecord.confidence,
      validationStatus: extractedRecord.validationStatus,
      keyFacts: extractedRecord.keyFacts,
      tags: extractedRecord.tags,
      fields: extractedRecord.fields.map((field) => ({
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
      })),
      sourceReferences: extractedRecord.sourceReferences.map((reference) => ({
        extractedFieldId: reference.extractedFieldId,
        pageNumber: reference.pageNumber,
        paragraphIndex: reference.paragraphIndex,
        lineStart: reference.lineStart,
        lineEnd: reference.lineEnd,
        evidenceSnippet: reference.evidenceSnippet
      })),
      vectorReferences: extractedRecord.vectorReferences.map((reference) => ({
        chunkId: reference.chunkId,
        chunkIndex: reference.chunkIndex,
        qdrantCollection: reference.qdrantCollection,
        qdrantPointId: reference.qdrantPointId,
        contentPreview: reference.contentPreview
      }))
    }
  };
}

function safeWebhookUrl(value: string) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = url.search ? "?..." : "";
    return url.toString();
  } catch {
    return "invalid-url";
  }
}

function preview(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= RESPONSE_PREVIEW_LIMIT) {
    return cleaned;
  }
  return `${cleaned.slice(0, RESPONSE_PREVIEW_LIMIT - 3).trim()}...`;
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}
