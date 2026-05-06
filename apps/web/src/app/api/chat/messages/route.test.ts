import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  conversationCreate: vi.fn(),
  conversationFindFirst: vi.fn(),
  conversationUpdate: vi.fn(),
  chatMessageCreate: vi.fn(),
  documentCreate: vi.fn(),
  processingJobCreate: vi.fn(),
  extractedRecordFindMany: vi.fn(),
  getDefaultWorkspace: vi.fn(),
  storeChatAttachment: vi.fn(),
  persistExtractionResult: vi.fn(),
  markExtractionFailed: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: {
      create: mocks.conversationCreate,
      findFirst: mocks.conversationFindFirst,
      update: mocks.conversationUpdate
    },
    chatMessage: {
      create: mocks.chatMessageCreate
    },
    document: {
      create: mocks.documentCreate
    },
    processingJob: {
      create: mocks.processingJobCreate
    },
    extractedRecord: {
      findMany: mocks.extractedRecordFindMany
    }
  }
}));

vi.mock("@/lib/workspace", () => ({
  getDefaultWorkspace: mocks.getDefaultWorkspace
}));

vi.mock("@/lib/uploads", () => ({
  storeChatAttachment: mocks.storeChatAttachment
}));

vi.mock("@/lib/extraction-persistence", () => ({
  persistExtractionResult: mocks.persistExtractionResult,
  markExtractionFailed: mocks.markExtractionFailed
}));

vi.mock("@/lib/local-env", () => ({
  loadLocalEnv: vi.fn()
}));

import { POST } from "@/app/api/chat/messages/route";

const workspace = {
  id: "workspace_1",
  name: "Default Workspace",
  slug: "default"
};

const conversation = {
  id: "conversation_1",
  workspaceId: workspace.id,
  title: "Document intake"
};

const userMessage = {
  id: "message_user_1",
  workspaceId: workspace.id,
  conversationId: conversation.id,
  role: "USER",
  content: "Please process this invoice.",
  metadata: {},
  createdAt: new Date().toISOString()
};

const assistantMessage = {
  id: "message_assistant_1",
  workspaceId: workspace.id,
  conversationId: conversation.id,
  role: "ASSISTANT",
  content: "Done.",
  metadata: {},
  createdAt: new Date().toISOString()
};

const documentRecord = {
  id: "document_1",
  workspaceId: workspace.id,
  conversationId: conversation.id,
  messageId: userMessage.id,
  originalFilename: "invoice.md",
  contentType: "text/markdown",
  storageKey: "documents/invoice.md",
  checksum: "sha256:test",
  sizeBytes: 42,
  userInstructions: null,
  documentType: "INVOICE",
  status: "EXTRACTED",
  createdAt: new Date().toISOString()
};

const processingJob = {
  id: "job_1",
  workspaceId: workspace.id,
  conversationId: conversation.id,
  documentId: documentRecord.id,
  status: "EXTRACTED",
  stage: "extraction_completed",
  errorMessage: null,
  createdAt: new Date().toISOString()
};

const extractionPayload = {
  status: "extracted",
  documentId: documentRecord.id,
  documentType: "INVOICE",
  title: "Invoice 1001",
  commonFields: [],
  typeSpecificFields: [],
  summary: "Invoice from Acme.",
  keyFacts: ["Total due is 1200 USD."],
  tags: ["invoice"],
  documentConfidence: 0.93,
  fieldConfidences: {},
  validation: {
    status: "passed",
    missingRequiredFields: [],
    warnings: []
  },
  agentAssessment: {
    status: "extracted",
    validationStatus: "passed",
    documentConfidence: 0.93,
    reviewRequired: false,
    reviewReasons: [],
    missingFields: [],
    uncertainFields: [],
    automationDecision: "safe_to_save",
    automationDecisionReason: "Evidence is sufficient."
  },
  sourceReferences: [],
  vectorReferences: [
    {
      chunkId: "document_1:chunk:0",
      qdrantCollection: "revenue_brains_documents",
      qdrantPointId: "point_1",
      chunkIndex: 0,
      contentPreview: "Invoice from Acme.",
      metadata: {
        workspaceId: workspace.id,
        documentId: documentRecord.id,
        documentType: "INVOICE"
      }
    }
  ],
  chatReply: "Processed as Invoice with 93% confidence.",
  processingImplemented: true
};

function makeRequest(formData: FormData) {
  return new Request("http://localhost/api/chat/messages", {
    method: "POST",
    body: formData
  });
}

describe("POST /api/chat/messages", () => {
  beforeEach(() => {
    mocks.getDefaultWorkspace.mockResolvedValue(workspace);
    mocks.conversationCreate.mockResolvedValue(conversation);
    mocks.conversationFindFirst.mockResolvedValue(conversation);
    mocks.conversationUpdate.mockResolvedValue(conversation);
    mocks.chatMessageCreate.mockImplementation(({ data }) =>
      Promise.resolve({
        ...(data.role === "USER" ? userMessage : assistantMessage),
        ...data,
        id: data.role === "USER" ? userMessage.id : assistantMessage.id
      })
    );
    mocks.storeChatAttachment.mockResolvedValue({
      storageKey: documentRecord.storageKey,
      checksum: documentRecord.checksum,
      sizeBytes: documentRecord.sizeBytes,
      originalFilename: documentRecord.originalFilename,
      contentType: documentRecord.contentType
    });
    mocks.documentCreate.mockResolvedValue({
      ...documentRecord,
      status: "ATTACHED"
    });
    mocks.processingJobCreate.mockResolvedValue({
      ...processingJob,
      status: "QUEUED",
      stage: "queued"
    });
    mocks.persistExtractionResult.mockResolvedValue({
      document: documentRecord,
      job: processingJob,
      extractedRecord: {
        id: "record_1",
        documentId: documentRecord.id,
        vectorReferences: extractionPayload.vectorReferences
      }
    });
    mocks.extractedRecordFindMany.mockResolvedValue([]);
    vi.stubEnv("PYTHON_AGENT_URL", "http://agent.local");
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        const target = String(url);

        if (target.endsWith("/documents/process")) {
          return Promise.resolve(Response.json(extractionPayload));
        }

        if (target.endsWith("/qa/plan")) {
          return Promise.resolve(
            Response.json({
              status: "planned",
              retrievalMode: "qdrant",
              postgresQuery: {
                intent: "semantic_lookup",
                documentTypes: [],
                recordLimit: 5
              },
              qdrantQuery: "What did I upload?",
              reasoning: "Semantic document context is needed."
            })
          );
        }

        if (target.endsWith("/qa/answer")) {
          return Promise.resolve(
            Response.json({
              status: "answered",
              answer: "The uploaded document is an invoice from Acme.",
              retrievalMode: "qdrant",
              citations: [
                {
                  sourceType: "qdrant",
                  documentId: documentRecord.id,
                  recordId: null,
                  qdrantPointId: "point_1",
                  title: "Invoice 1001",
                  snippet: "Invoice from Acme."
                }
              ],
              confidence: 0.88,
              limitations: ["Only uploaded document memory was searched."]
            })
          );
        }

        return Promise.resolve(Response.json({ error: "unexpected" }, { status: 404 }));
      })
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("persists attachment processing results and vector references from the Python agent", async () => {
    const formData = new FormData();
    formData.set("content", "Please process this invoice.");
    formData.append("files", new File(["# Invoice\nTotal: 1200 USD"], "invoice.md"));

    const response = await POST(makeRequest(formData));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.storeChatAttachment).toHaveBeenCalledOnce();
    expect(mocks.persistExtractionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: documentRecord.id,
        extraction: expect.objectContaining({
          vectorReferences: extractionPayload.vectorReferences
        })
      })
    );
    expect(body.extractedRecords[0].vectorReferences).toHaveLength(1);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const requestBody = JSON.parse(String(fetchCall[1]?.body));
    expect(requestBody).toMatchObject({
      fileStorageKey: documentRecord.storageKey,
      checksum: documentRecord.checksum,
      originalFilename: documentRecord.originalFilename
    });
    expect(requestBody).not.toHaveProperty("fileBytes");
  });

  it("persists Q&A answer metadata and citations for text-only chat", async () => {
    const formData = new FormData();
    formData.set("content", "What did I upload?");

    const response = await POST(makeRequest(formData));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.documents).toEqual([]);
    expect(body.assistantMessage.metadata).toMatchObject({
      qa: true,
      retrievalMode: "qdrant",
      confidence: 0.88,
      citations: [
        expect.objectContaining({
          sourceType: "qdrant",
          qdrantPointId: "point_1",
          title: "Invoice 1001"
        })
      ],
      limitations: ["Only uploaded document memory was searched."]
    });
    expect(mocks.extractedRecordFindMany).not.toHaveBeenCalled();
  });
});
