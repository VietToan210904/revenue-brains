"use client";

import { FormEvent, KeyboardEvent, useMemo, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  metadata?: {
    agent?: boolean;
    intent?: string;
    automationDecision?: string;
    toolActions?: Array<{
      tool: string;
      status: string;
      summary: string;
    }>;
    qa?: boolean;
    retrievalMode?: string;
    confidence?: number;
    citations?: Array<{
      sourceType: "postgres" | "qdrant";
      documentId?: string | null;
      recordId?: string | null;
      qdrantPointId?: string | null;
      title?: string | null;
      snippet?: string | null;
    }>;
    limitations?: string[];
    pending?: boolean;
    agentRunId?: string;
    agentRunStatus?: "PENDING" | "RUNNING" | "COMPLETED" | "NEEDS_REVIEW" | "FAILED";
    pollTimedOut?: boolean;
  } | null;
  createdAt: string;
};

type DocumentRecord = {
  id: string;
  originalFilename: string;
  contentType: string;
  status:
    | "ATTACHED"
    | "HANDOFF_ACCEPTED"
    | "HANDOFF_FAILED"
    | "EXTRACTED"
    | "NEEDS_REVIEW"
    | "EXTRACTION_FAILED";
  documentType: "INVOICE" | "CONTRACT" | "PURCHASE_ORDER" | "RECEIPT_EXPENSE" | "KNOWLEDGE" | "UNKNOWN";
  storageKey: string;
  checksum: string;
  createdAt: string;
};

type ProcessingJob = {
  id: string;
  documentId: string;
  status: "QUEUED" | "PROCESSING" | "EXTRACTED" | "NEEDS_REVIEW" | "EXTRACTION_FAILED" | "FAILED";
  stage: string;
  errorMessage: string | null;
  createdAt: string;
};

type ExtractedField = {
  id: string;
  name: string;
  label: string | null;
  fieldType: string;
  valueString: string | null;
  valueNumber: number | null;
  valueDate: string | null;
  currency: string | null;
  valueJson: unknown;
  confidence: number;
  required: boolean;
  validationStatus: "PASSED" | "NEEDS_REVIEW" | "FAILED";
};

type SourceReference = {
  id: string;
  extractedFieldId: string | null;
  pageNumber: number | null;
  paragraphIndex: number | null;
  lineStart: number | null;
  evidenceSnippet: string | null;
};

type VectorReference = {
  id: string;
  qdrantCollection: string;
  qdrantPointId: string;
  chunkIndex: number;
  contentPreview: string;
};

type ExtractedRecord = {
  id: string;
  documentId: string;
  documentType: DocumentRecord["documentType"];
  title: string;
  summary: string;
  confidence: number;
  validationStatus: "PASSED" | "NEEDS_REVIEW" | "FAILED";
  normalizedPayload?: {
    validation?: {
      warnings?: string[];
      missingRequiredFields?: string[];
    };
    agentAssessment?: {
      reviewReasons?: string[];
      missingFields?: string[];
      uncertainFields?: string[];
      automationDecision?: string;
      automationDecisionReason?: string;
    };
  };
  fields: ExtractedField[];
  sourceReferences: SourceReference[];
  vectorReferences: VectorReference[];
};

type AgentStep = {
  id: string;
  sequence: number;
  agentName: string;
  action: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
  inputSummary: string | null;
  outputSummary: string | null;
  confidence: number | null;
  createdAt: string;
};

type AgentRunRecord = {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "NEEDS_REVIEW" | "FAILED";
  detectedIntent: string | null;
  automationDecision: string | null;
  finalReply: string | null;
  errorMessage: string | null;
  steps: AgentStep[];
};

type ChatResponse = {
  conversation: {
    id: string;
    title: string;
  };
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  documents: DocumentRecord[];
  jobs: ProcessingJob[];
  extractedRecords: ExtractedRecord[];
  agentRun?: AgentRunRecord;
};

type AgentRunPollResponse = {
  agentRun: AgentRunRecord;
  assistantMessage: ChatMessage | null;
  documents: DocumentRecord[];
  jobs: ProcessingJob[];
  extractedRecords: ExtractedRecord[];
};

const initialMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "ASSISTANT",
    content:
      "Send a message with company documents attached. Phase 7 uses an autonomous multi-agent team to plan, delegate, validate, remember, answer, and reply.",
    createdAt: new Date().toISOString()
  }
];

function shortenText(value: string, limit = 160) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= limit) {
    return cleaned;
  }

  return `${cleaned.slice(0, Math.max(limit - 3, 0)).trim()}...`;
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatCitationSource(sourceType: string) {
  return sourceType === "qdrant" ? "Qdrant" : "Postgres";
}

function formatFieldValue(field: ExtractedField) {
  if (field.valueNumber !== null) {
    return `${field.currency ? `${field.currency} ` : ""}${field.valueNumber.toLocaleString()}`;
  }

  if (field.valueDate) {
    return field.valueDate.slice(0, 10);
  }

  if (field.valueString) {
    return field.valueString;
  }

  if (Array.isArray(field.valueJson)) {
    return shortenText(field.valueJson.slice(0, 3).map(String).join(", "));
  }

  if (field.valueJson && typeof field.valueJson === "object") {
    return shortenText(JSON.stringify(field.valueJson), 180);
  }

  if (typeof field.valueJson === "string") {
    try {
      const parsed = JSON.parse(field.valueJson) as unknown;
      if (Array.isArray(parsed)) {
        return shortenText(parsed.slice(0, 3).map(String).join(", "));
      }
      if (parsed && typeof parsed === "object") {
        return shortenText(JSON.stringify(parsed), 180);
      }
    } catch {
      return shortenText(field.valueJson, 180);
    }
  }

  return "Missing";
}

function hasFieldValue(field: ExtractedField) {
  return formatFieldValue(field) !== "Missing";
}

function confidencePercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function getProcessingText(message: ChatMessage) {
  const actions = message.metadata?.toolActions ?? [];
  const activeAction = actions
    .slice()
    .reverse()
    .find((action) => ["PENDING", "RUNNING", "pending", "running"].includes(action.status));

  if (activeAction) {
    return `${formatStatus(activeAction.tool)} is ${formatStatus(activeAction.status).toLowerCase()}.`;
  }

  if (message.metadata?.agentRunStatus === "PENDING") {
    return "Preparing the autonomous agent team.";
  }

  if (message.metadata?.agentRunStatus === "RUNNING") {
    return "Agents are planning, using tools, and checking the result.";
  }

  return "Processing your request.";
}

function delay(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function mergeById<T extends { id: string }>(incoming: T[], current: T[]) {
  const merged = new Map<string, T>();
  for (const item of current) {
    merged.set(item.id, item);
  }
  for (const item of incoming) {
    merged.set(item.id, item);
  }
  return Array.from(merged.values());
}

function withAgentRunTimeline(message: ChatMessage, agentRun: AgentRunRecord): ChatMessage {
  return {
    ...message,
    metadata: {
      ...(message.metadata ?? {}),
      agent: true,
      pending: agentRun.status === "PENDING" || agentRun.status === "RUNNING",
      agentRunId: agentRun.id,
      agentRunStatus: agentRun.status,
      pollTimedOut: false,
      intent: message.metadata?.intent ?? agentRun.detectedIntent ?? undefined,
      automationDecision:
        message.metadata?.automationDecision ?? agentRun.automationDecision ?? undefined,
      toolActions:
        agentRun.steps.length > 0
          ? agentRun.steps.map((step) => ({
              tool: step.agentName,
              status: step.status,
              summary: step.outputSummary ?? step.inputSummary ?? step.action
            }))
          : message.metadata?.toolActions
    }
  };
}

export default function Home() {
  const formRef = useRef<HTMLFormElement>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [extractedRecords, setExtractedRecords] = useState<ExtractedRecord[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extractedDocuments = useMemo(
    () => documents.filter((document) => document.status === "EXTRACTED").length,
    [documents]
  );
  const reviewDocuments = useMemo(
    () => documents.filter((document) => document.status === "NEEDS_REVIEW").length,
    [documents]
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setIsSending(true);
    setError(null);

    const formData = new FormData(form);
    const content = String(formData.get("content") ?? "").trim();
    const attachedFiles = formData
      .getAll("files")
      .filter((item): item is File => item instanceof File && item.size > 0);

    if (!content && attachedFiles.length === 0) {
      setError("Send a message, attach at least one file, or do both.");
      setIsSending(false);
      return;
    }

    const optimisticCreatedAt = new Date().toISOString();
    const optimisticUserMessage: ChatMessage = {
      id: `optimistic-user-${crypto.randomUUID()}`,
      role: "USER",
      content: content || "Attached documents for processing.",
      createdAt: optimisticCreatedAt
    };
    const thinkingMessage: ChatMessage = {
      id: `thinking-${crypto.randomUUID()}`,
      role: "ASSISTANT",
      content: attachedFiles.length
        ? "Processing your request... Reading the attached document now."
        : "Processing your request...",
      metadata: {
        pending: true
      },
      createdAt: optimisticCreatedAt
    };

    if (conversationId) {
      formData.set("conversationId", conversationId);
    }

    setMessages((current) => [...current, optimisticUserMessage, thinkingMessage]);
    form.reset();

    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        body: formData
      });
      const responseText = await response.text();
      const body = responseText ? JSON.parse(responseText) : {};

      if (!response.ok) {
        throw new Error(body.error ?? "Chat message could not be sent.");
      }

      const data = body as ChatResponse;
      const assistantMessage = data.agentRun
        ? withAgentRunTimeline(data.assistantMessage, data.agentRun)
        : data.assistantMessage;
      setConversationId(data.conversation.id);
      setMessages((current) =>
        current.map((message) => {
          if (message.id === optimisticUserMessage.id) {
            return data.userMessage;
          }
          if (message.id === thinkingMessage.id) {
            return assistantMessage;
          }
          return message;
        })
      );
      setDocuments((current) => [...data.documents, ...current]);
      setJobs((current) => [...data.jobs, ...current]);
      setExtractedRecords((current) => [...data.extractedRecords, ...current]);
      if (data.agentRun?.id) {
        void pollAgentRun(data.agentRun.id);
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Chat message could not be sent.";
      setMessages((current) =>
        current.map((candidate) =>
          candidate.id === thinkingMessage.id
            ? {
                ...candidate,
                content: `I could not finish that request: ${message}`,
                metadata: {
                  pending: false
                }
              }
            : candidate
        )
      );
      setError(message);
    } finally {
      setIsSending(false);
    }
  }

  async function pollAgentRun(runId: string) {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await delay(attempt === 0 ? 500 : 1500);

      try {
        const response = await fetch(`/api/agent-runs/${runId}`);
        const body = (await response.json()) as AgentRunPollResponse | { error?: string };

        if (!response.ok || !("agentRun" in body)) {
          continue;
        }

        const runBody = body as AgentRunPollResponse;
        setMessages((current) =>
          current.map((message) => {
            if (
              message.metadata?.agentRunId !== runBody.agentRun.id &&
              message.id !== runBody.assistantMessage?.id
            ) {
              return message;
            }

            const baseMessage = runBody.assistantMessage ?? message;
            return withAgentRunTimeline(baseMessage, runBody.agentRun);
          })
        );
        setDocuments((current) => mergeById(runBody.documents, current));
        setJobs((current) => mergeById(runBody.jobs, current));
        setExtractedRecords((current) => mergeById(runBody.extractedRecords, current));

        if (["COMPLETED", "NEEDS_REVIEW", "FAILED"].includes(runBody.agentRun.status)) {
          return;
        }
      } catch {
        continue;
      }
    }

    setMessages((current) =>
      current.map((message) =>
        message.metadata?.agentRunId === runId
          ? {
              ...message,
              content:
                "The agent run is taking longer than expected. The saved run is still visible below; check health or retry if it does not finish.",
              metadata: {
                ...(message.metadata ?? {}),
                pending: false,
                pollTimedOut: true
              }
            }
          : message
      )
    );
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            RB
          </div>
          <div>
            <p className="eyebrow">Revenue Brains</p>
            <h1>Workspace</h1>
          </div>
        </div>

        <nav className="conversation-list" aria-label="Conversations">
          <a className="conversation active" href="#workspace">
          <span>{conversationId ? "Active document thread" : "New document thread"}</span>
          <small>{conversationId ?? "Conversation starts after first message"}</small>
          </a>
          <a className="conversation" href="#documents">
            <span>Documents</span>
            <small>{documents.length} attached in this session</small>
          </a>
          <a className="conversation" href="#jobs">
            <span>Processing jobs</span>
            <small>{jobs.length} extraction job records</small>
          </a>
        </nav>
      </aside>

      <section className="workspace-panel" id="workspace" aria-labelledby="workspace-title">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Agent chat</p>
            <h2 id="workspace-title">Company document intake</h2>
          </div>
          <span className="status-pill">Phase 7</span>
        </header>

        <div className="message-stack" aria-label="Thread">
          {messages.map((message) => (
            <article
              className={`message ${message.role === "USER" ? "user" : "agent"} ${
                message.metadata?.pending ? "thinking" : ""
              }`}
              key={message.id}
            >
              <div className="message-author">
                {message.role === "USER" ? "Employee" : "Revenue Brains"}
              </div>
              <p>{message.content}</p>
              {message.metadata?.pending ? (
                <div className="processing-indicator" role="status" aria-live="polite">
                  <span className="processing-orb" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span>{getProcessingText(message)}</span>
                  <span className="typing-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              ) : null}
              {message.metadata?.pollTimedOut ? (
                <div className="run-notice" role="status">
                  The run did not finish inside this browser polling window.
                </div>
              ) : null}
              {message.metadata?.qa ? (
                <div className="answer-meta">
                  {message.metadata.retrievalMode ? (
                    <span>{formatStatus(message.metadata.retrievalMode)}</span>
                  ) : null}
                  {typeof message.metadata.confidence === "number" ? (
                    <span>{confidencePercent(message.metadata.confidence)} confidence</span>
                  ) : null}
                </div>
              ) : null}
              {message.metadata?.agent ? (
                <div className="agent-activity">
                  <div className="agent-activity-pills">
                    {message.metadata.intent ? (
                      <span>{formatStatus(message.metadata.intent)}</span>
                    ) : null}
                    {message.metadata.automationDecision ? (
                      <span>{formatStatus(message.metadata.automationDecision)}</span>
                    ) : null}
                  </div>
                  {message.metadata.toolActions?.length ? (
                    <ul>
                      {message.metadata.toolActions.map((action, index) => (
                        <li
                          className={`agent-step-${action.status.toLowerCase()}`}
                          key={`${action.tool}-${index}`}
                        >
                          <strong>{formatStatus(action.tool)}</strong>
                          <span>{formatStatus(action.status)}</span>
                          <p>{shortenText(action.summary, 180)}</p>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {message.metadata?.citations?.length ? (
                <div className="citation-list">
                  {message.metadata.citations.slice(0, 3).map((citation, index) => (
                    <div
                      className="citation-item"
                      key={`${citation.sourceType}-${citation.documentId ?? citation.qdrantPointId ?? index}`}
                    >
                      <strong>
                        {formatCitationSource(citation.sourceType)}
                        {citation.title ? ` · ${citation.title}` : ""}
                      </strong>
                      <p>
                        {shortenText(
                          citation.snippet ??
                            citation.documentId ??
                            citation.qdrantPointId ??
                            "Citation source available.",
                          180
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              {message.metadata?.limitations?.length ? (
                <div className="limitation-list">
                  {message.metadata.limitations.slice(0, 2).map((limitation) => (
                    <p key={limitation}>{shortenText(limitation, 180)}</p>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>

        <form
          className="composer"
          aria-label="Message composer"
          ref={formRef}
          onSubmit={handleSubmit}
        >
          <label htmlFor="content">Message or instructions</label>
          <textarea
            id="content"
            name="content"
            onKeyDown={handleComposerKeyDown}
            placeholder="Example: Please process this invoice and keep the payment terms visible."
            rows={4}
          />

          <div className="composer-grid">
            <label className="field-group" htmlFor="userInstructions">
              <span>Processing note</span>
              <input
                id="userInstructions"
                name="userInstructions"
                placeholder="Optional instruction for the agent"
                type="text"
              />
            </label>

            <label className="field-group" htmlFor="files">
              <span>Attachments</span>
              <input
                id="files"
                name="files"
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown"
              />
            </label>
          </div>

          <div className="composer-actions">
            <span>
              Files are stored privately, then handed to the Python agent by storage key.
            </span>
            <button type="submit" disabled={isSending}>
              {isSending ? "Sending" : "Send"}
            </button>
          </div>

          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </section>

      <aside className="status-panel" aria-labelledby="status-title">
          <div className="panel-heading">
            <p className="eyebrow">Intake status</p>
          <h2 id="status-title">Extraction</h2>
        </div>

        <div className="metric-grid" aria-label="Processing summary">
          <div className="metric">
            <strong>{documents.length}</strong>
            <span>documents</span>
          </div>
          <div className="metric">
            <strong>{extractedDocuments}</strong>
            <span>extracted</span>
          </div>
          <div className="metric">
            <strong>{reviewDocuments}</strong>
            <span>review</span>
          </div>
        </div>

        <section className="status-list" id="documents" aria-label="Documents">
          {documents.length ? (
            documents.map((document) => {
              const record = extractedRecords.find(
                (candidate) => candidate.documentId === document.id
              );
              const assessment = record?.normalizedPayload?.agentAssessment;
              const warnings =
                assessment?.reviewReasons ?? record?.normalizedPayload?.validation?.warnings ?? [];
              const requiredWarnings =
                assessment?.missingFields ??
                record?.normalizedPayload?.validation?.missingRequiredFields ??
                [];
              const uncertainWarnings =
                assessment?.uncertainFields?.map((field) => `Uncertain field: ${field}`) ?? [];
              const importantFields =
                record?.fields.filter((field) => field.required && hasFieldValue(field)) ?? [];
              const fallbackFields =
                record?.fields.filter((field) => !field.required && hasFieldValue(field)) ?? [];
              const visibleFields = [...importantFields, ...fallbackFields].slice(0, 5);

              return (
                <article className="status-row extraction-row" key={document.id}>
                  <div>
                    <div className="row-heading">
                      <div>
                        <h3>{document.originalFilename}</h3>
                        <p>
                          {record
                            ? `${formatStatus(record.documentType)} · ${confidencePercent(record.confidence)} confidence`
                            : document.storageKey}
                        </p>
                      </div>
                      <span className={`state state-${document.status.toLowerCase()}`}>
                        {formatStatus(document.status)}
                      </span>
                    </div>

                    {record ? (
                      <div className="extraction-detail">
                        <p>{record.summary}</p>
                        {visibleFields.length ? (
                          <dl className="field-list">
                            {visibleFields.map((field) => (
                              <div key={field.id}>
                                <dt>{field.label ?? formatStatus(field.name)}</dt>
                                <dd>
                                  {formatFieldValue(field)}
                                  <span>{confidencePercent(field.confidence)}</span>
                                </dd>
                              </div>
                            ))}
                          </dl>
                        ) : null}

                        {warnings.length || requiredWarnings.length || uncertainWarnings.length ? (
                          <div className="warning-list">
                            {[...requiredWarnings, ...uncertainWarnings, ...warnings]
                              .slice(0, 3)
                              .map((warning) => (
                                <p key={warning}>{warning}</p>
                              ))}
                          </div>
                        ) : null}

                        {record.sourceReferences.length ? (
                          <div className="source-list">
                            {record.sourceReferences.slice(0, 2).map((reference) => (
                              <p key={reference.id}>
                                Source evidence ·{" "}
                                {reference.pageNumber ? `Page ${reference.pageNumber}: ` : ""}
                                {reference.paragraphIndex
                                  ? `Paragraph ${reference.paragraphIndex}: `
                                  : ""}
                                {reference.lineStart ? `Line ${reference.lineStart}: ` : ""}
                                {reference.evidenceSnippet
                                  ? shortenText(reference.evidenceSnippet, 180)
                                  : "Evidence reference saved."}
                              </p>
                            ))}
                          </div>
                        ) : null}

                        {record.vectorReferences.length ? (
                          <div className="source-list">
                            {record.vectorReferences.slice(0, 2).map((reference) => (
                              <p key={reference.id}>
                                Vector memory · Chunk {reference.chunkIndex + 1} ·{" "}
                                {shortenText(reference.contentPreview, 180)}
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })
          ) : (
            <article className="empty-state">
              <h3>No documents yet</h3>
              <p>Attach files in the chat composer to create extraction records.</p>
            </article>
          )}
        </section>

        <section className="status-list" id="jobs" aria-label="Processing jobs">
          {jobs.map((job) => (
            <article className="status-row" key={job.id}>
              <div>
                <h3>{formatStatus(job.status)}</h3>
                <p>{job.stage}</p>
              </div>
              <span className={`state state-${job.status.toLowerCase()}`}>
                {formatStatus(job.status)}
              </span>
            </article>
          ))}
        </section>
      </aside>
    </main>
  );
}
