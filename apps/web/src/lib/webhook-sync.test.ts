import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  webhookSyncAttemptCreate: vi.fn(),
  webhookSyncAttemptUpdate: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    webhookSyncAttempt: {
      create: mocks.webhookSyncAttemptCreate,
      update: mocks.webhookSyncAttemptUpdate
    }
  }
}));

vi.mock("@/lib/local-env", () => ({
  loadLocalEnv: vi.fn()
}));

import { syncExtractionWebhook } from "@/lib/webhook-sync";

const persistedExtraction = {
  document: {
    id: "doc_123",
    workspaceId: "workspace_123",
    conversationId: "conv_123",
    originalFilename: "invoice.md",
    contentType: "text/markdown",
    storageKey: "documents/invoice.md",
    checksum: "sha256:test",
    documentType: "INVOICE",
    status: "EXTRACTED"
  },
  job: {
    id: "job_123"
  },
  extractedRecord: {
    id: "record_123",
    documentId: "doc_123",
    documentType: "INVOICE",
    title: "Invoice INV-1001",
    summary: "Invoice from Acme Cloud.",
    keyFacts: ["Vendor: Acme Cloud"],
    tags: ["invoice"],
    confidence: 0.93,
    validationStatus: "PASSED",
    normalizedPayload: {
      rawText: "FULL_RAW_DOCUMENT_TEXT"
    },
    fields: [
      {
        id: "field_123",
        name: "vendor",
        label: "Vendor",
        fieldType: "STRING",
        valueString: "Acme Cloud",
        valueNumber: null,
        valueDate: null,
        currency: null,
        valueJson: null,
        confidence: 0.94,
        required: true,
        validationStatus: "PASSED"
      }
    ],
    sourceReferences: [
      {
        id: "source_123",
        extractedFieldId: "field_123",
        pageNumber: 1,
        paragraphIndex: null,
        lineStart: 2,
        lineEnd: 2,
        evidenceSnippet: "Vendor: Acme Cloud"
      }
    ],
    vectorReferences: [
      {
        id: "vector_123",
        chunkId: "doc_123:chunk:0",
        chunkIndex: 0,
        qdrantCollection: "revenue_brains_documents",
        qdrantPointId: "point_123",
        contentPreview: "Invoice INV-1001 from Acme Cloud."
      }
    ]
  }
};

function clonePersistedExtraction(overrides: Record<string, unknown> = {}) {
  return {
    ...structuredClone(persistedExtraction),
    ...overrides
  };
}

describe("syncExtractionWebhook", () => {
  beforeEach(() => {
    mocks.webhookSyncAttemptCreate.mockImplementation(({ data }) => Promise.resolve(data));
    mocks.webhookSyncAttemptUpdate.mockImplementation(({ data, where }) =>
      Promise.resolve({ id: where.id, ...data })
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("creates a skipped attempt when WEBHOOK_URL is empty", async () => {
    vi.stubEnv("WEBHOOK_URL", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const attempt = await syncExtractionWebhook({
      agentRunId: "run_123",
      automationDecision: "safe_to_save",
      persisted: clonePersistedExtraction() as never
    });

    expect(attempt?.status).toBe("SKIPPED");
    expect(mocks.webhookSyncAttemptCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SKIPPED",
          eventType: "extraction.completed",
          errorMessage: "WEBHOOK_URL is not configured."
        })
      })
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("delivers signed high-confidence extraction payloads", async () => {
    vi.stubEnv("WEBHOOK_URL", "http://receiver.local/hook?token=secret-token");
    vi.stubEnv("WEBHOOK_SECRET", "test-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })))
    );

    const attempt = await syncExtractionWebhook({
      agentRunId: "run_123",
      automationDecision: "safe_to_save",
      persisted: clonePersistedExtraction() as never
    });

    const createData = mocks.webhookSyncAttemptCreate.mock.calls[0][0].data;
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = String(fetchCall[1]?.body);
    const expectedSignature = `sha256=${createHmac("sha256", "test-secret")
      .update(body)
      .digest("hex")}`;

    expect(createData.status).toBe("PENDING");
    expect(createData.webhookUrl).toBe("http://receiver.local/hook?...");
    expect(fetchCall[0]).toBe("http://receiver.local/hook?token=secret-token");
    expect(fetchCall[1]?.headers).toMatchObject({
      "x-revenue-brains-event": "extraction.completed",
      "x-revenue-brains-delivery-id": createData.id,
      "x-revenue-brains-signature": expectedSignature
    });
    expect(JSON.parse(body)).toMatchObject({
      event: "extraction.completed",
      deliveryId: createData.id,
      document: {
        id: "doc_123",
        storageKey: "documents/invoice.md"
      },
      extractedRecord: {
        id: "record_123",
        fields: [
          expect.objectContaining({
            name: "vendor",
            valueString: "Acme Cloud"
          })
        ]
      }
    });
    expect(body).not.toContain("FULL_RAW_DOCUMENT_TEXT");
    expect(body).not.toContain("test-secret");
    expect(attempt?.status).toBe("DELIVERED");
  });

  it("records failed attempts without throwing when the receiver rejects delivery", async () => {
    vi.stubEnv("WEBHOOK_URL", "http://receiver.local/hook");
    vi.stubEnv("WEBHOOK_SECRET", "test-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("receiver failed", { status: 500 })))
    );

    const attempt = await syncExtractionWebhook({
      agentRunId: "run_123",
      automationDecision: "safe_to_save",
      persisted: clonePersistedExtraction() as never
    });

    expect(attempt?.status).toBe("FAILED");
    expect(mocks.webhookSyncAttemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          responseStatusCode: 500,
          responseBodyPreview: "receiver failed",
          errorMessage: "Webhook returned HTTP 500."
        })
      })
    );
  });

  it("does not send review-needed records", async () => {
    vi.stubEnv("WEBHOOK_URL", "http://receiver.local/hook");
    vi.stubEnv("WEBHOOK_SECRET", "test-secret");
    vi.stubGlobal("fetch", vi.fn());

    const reviewRecord = clonePersistedExtraction({
      document: {
        ...persistedExtraction.document,
        status: "NEEDS_REVIEW"
      },
      extractedRecord: {
        ...persistedExtraction.extractedRecord,
        validationStatus: "NEEDS_REVIEW"
      }
    });

    const attempt = await syncExtractionWebhook({
      agentRunId: "run_123",
      automationDecision: "save_for_review",
      persisted: reviewRecord as never
    });

    expect(attempt).toBeNull();
    expect(mocks.webhookSyncAttemptCreate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
