import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  conversationCreate: vi.fn(),
  conversationFindFirst: vi.fn(),
  chatMessageCreate: vi.fn(),
  chatMessageFindUniqueOrThrow: vi.fn(),
  documentCreate: vi.fn(),
  processingJobCreate: vi.fn(),
  processingJobUpdateMany: vi.fn(),
  extractedRecordFindMany: vi.fn(),
  agentRunCreate: vi.fn(),
  agentRunUpdate: vi.fn(),
  agentRunFindUniqueOrThrow: vi.fn(),
  getDefaultWorkspace: vi.fn(),
  storeChatAttachment: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: {
      create: mocks.conversationCreate,
      findFirst: mocks.conversationFindFirst
    },
    chatMessage: {
      create: mocks.chatMessageCreate,
      findUniqueOrThrow: mocks.chatMessageFindUniqueOrThrow
    },
    document: {
      create: mocks.documentCreate
    },
    processingJob: {
      create: mocks.processingJobCreate,
      updateMany: mocks.processingJobUpdateMany
    },
    extractedRecord: {
      findMany: mocks.extractedRecordFindMany
    },
    agentRun: {
      create: mocks.agentRunCreate,
      update: mocks.agentRunUpdate,
      findUniqueOrThrow: mocks.agentRunFindUniqueOrThrow
    }
  }
}));

vi.mock("@/lib/workspace", () => ({
  getDefaultWorkspace: mocks.getDefaultWorkspace
}));

vi.mock("@/lib/uploads", () => ({
  storeChatAttachment: mocks.storeChatAttachment
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
  content:
    "The autonomous document team is working on this. I will update this message when the run finishes.",
  metadata: {
    agent: true,
    pending: true
  },
  createdAt: new Date().toISOString()
};

const agentRun = {
  id: "agent_run_1",
  workspaceId: workspace.id,
  conversationId: conversation.id,
  userMessageId: userMessage.id,
  assistantMessageId: assistantMessage.id,
  status: "RUNNING",
  goal: userMessage.content,
  detectedIntent: null,
  automationDecision: null,
  finalReply: null,
  errorMessage: null,
  steps: [],
  artifacts: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
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
  documentType: "UNKNOWN",
  status: "ATTACHED",
  createdAt: new Date().toISOString()
};

const processingJob = {
  id: "job_1",
  workspaceId: workspace.id,
  conversationId: conversation.id,
  documentId: documentRecord.id,
  status: "QUEUED",
  stage: "agent_run_queued",
  errorMessage: null,
  createdAt: new Date().toISOString()
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
    mocks.chatMessageCreate.mockImplementation(({ data }) =>
      Promise.resolve({
        ...(data.role === "USER" ? userMessage : assistantMessage),
        ...data,
        id: data.role === "USER" ? userMessage.id : assistantMessage.id
      })
    );
    mocks.chatMessageFindUniqueOrThrow.mockResolvedValue(assistantMessage);
    mocks.storeChatAttachment.mockResolvedValue({
      storageKey: documentRecord.storageKey,
      checksum: documentRecord.checksum,
      sizeBytes: documentRecord.sizeBytes,
      originalFilename: documentRecord.originalFilename,
      contentType: documentRecord.contentType
    });
    mocks.documentCreate.mockResolvedValue(documentRecord);
    mocks.processingJobCreate.mockResolvedValue(processingJob);
    mocks.processingJobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.extractedRecordFindMany.mockResolvedValue([]);
    mocks.agentRunCreate.mockResolvedValue({
      ...agentRun,
      status: "PENDING"
    });
    mocks.agentRunUpdate.mockResolvedValue(agentRun);
    mocks.agentRunFindUniqueOrThrow.mockResolvedValue(agentRun);
    vi.stubEnv("PYTHON_AGENT_URL", "http://agent.local");
    vi.stubEnv("AGENT_CALLBACK_BASE_URL", "http://web.local");
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL, init?: RequestInit) => {
        const target = String(url);

        if (target.endsWith("/agent/runs/start")) {
          const requestBody = JSON.parse(String(init?.body)) as {
            agentRunId: string;
            attachments: unknown[];
          };

          return Promise.resolve(
            Response.json(
              {
                status: "accepted",
                agentRunId: requestBody.agentRunId,
                message: "Autonomous agent run started."
              },
              { status: 202 }
            )
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

  it("starts an autonomous agent run with attachment metadata and storage keys", async () => {
    const formData = new FormData();
    formData.set("content", "Please process this invoice.");
    formData.append("files", new File(["# Invoice\nTotal: 1200 USD"], "invoice.md"));

    const response = await POST(makeRequest(formData));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(mocks.storeChatAttachment).toHaveBeenCalledOnce();
    expect(mocks.agentRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: workspace.id,
          conversationId: conversation.id,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          status: "PENDING"
        })
      })
    );
    expect(mocks.agentRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: agentRun.id },
        data: expect.objectContaining({ status: "RUNNING" })
      })
    );
    expect(mocks.processingJobUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: {
            in: [processingJob.id]
          }
        },
        data: expect.objectContaining({
          status: "PROCESSING",
          stage: "agent_run_started"
        })
      })
    );
    expect(body.extractedRecords).toEqual([]);
    expect(body.agentRun.id).toBe(agentRun.id);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const requestBody = JSON.parse(String(fetchCall[1]?.body));
    expect(String(fetchCall[0])).toMatch(/\/agent\/runs\/start$/);
    expect(requestBody).toMatchObject({
      agentRunId: agentRun.id,
      workspaceId: workspace.id,
      conversationId: conversation.id,
      messageId: userMessage.id,
      callbackBaseUrl: "http://localhost:3000"
    });
    expect(requestBody.attachments[0]).toMatchObject({
      documentId: documentRecord.id,
      fileStorageKey: documentRecord.storageKey,
      checksum: documentRecord.checksum,
      originalFilename: documentRecord.originalFilename
    });
    expect(requestBody).not.toHaveProperty("fileBytes");
    expect(requestBody.attachments[0]).not.toHaveProperty("fileBytes");
  });

  it("starts a text-only autonomous Q&A run with recent Postgres evidence", async () => {
    const formData = new FormData();
    formData.set("content", "What did I upload?");
    mocks.extractedRecordFindMany.mockResolvedValueOnce([
      {
        id: "record_1",
        documentId: documentRecord.id,
        documentType: "INVOICE",
        title: "Invoice 1001",
        summary: "Invoice from Acme.",
        confidence: 0.9,
        validationStatus: "PASSED",
        document: {
          id: documentRecord.id,
          originalFilename: documentRecord.originalFilename,
          documentType: "INVOICE",
          status: "EXTRACTED",
          createdAt: documentRecord.createdAt
        },
        fields: [],
        sourceReferences: [],
        vectorReferences: []
      }
    ]);

    const response = await POST(makeRequest(formData));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.documents).toEqual([]);
    expect(body.jobs).toEqual([]);
    expect(mocks.processingJobUpdateMany).not.toHaveBeenCalled();
    expect(body.assistantMessage.metadata).toMatchObject({
      agent: true,
      pending: true
    });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const requestBody = JSON.parse(String(fetchCall[1]?.body));
    expect(requestBody.attachments).toEqual([]);
    expect(requestBody.postgresEvidence[0]).toMatchObject({
      recordId: "record_1",
      documentId: documentRecord.id,
      title: "Invoice 1001"
    });
  });

  it("rejects empty chat submissions before creating agent runs", async () => {
    const formData = new FormData();

    const response = await POST(makeRequest(formData));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Send a message, attach at least one file, or do both.");
    expect(mocks.agentRunCreate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
