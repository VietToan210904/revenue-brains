"use client";

import { FormEvent, KeyboardEvent, useMemo, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  createdAt: string;
};

type DocumentRecord = {
  id: string;
  originalFilename: string;
  contentType: string;
  status: "ATTACHED" | "HANDOFF_ACCEPTED" | "HANDOFF_FAILED";
  storageKey: string;
  checksum: string;
  createdAt: string;
};

type ProcessingJob = {
  id: string;
  documentId: string;
  status: "QUEUED" | "PROCESSING" | "FAILED";
  stage: string;
  errorMessage: string | null;
  createdAt: string;
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
};

const initialMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "ASSISTANT",
    content:
      "Send a message with company documents attached. Phase 3 will save the files, create processing jobs, and hand them to the agent service.",
    createdAt: new Date().toISOString()
  }
];

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function Home() {
  const formRef = useRef<HTMLFormElement>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptedJobs = useMemo(
    () => jobs.filter((job) => job.stage === "agent_handoff_accepted").length,
    [jobs]
  );
  const failedJobs = useMemo(
    () => jobs.filter((job) => job.stage === "agent_handoff_failed").length,
    [jobs]
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);

    if (conversationId) {
      formData.set("conversationId", conversationId);
    }

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
      setConversationId(data.conversation.id);
      setMessages((current) => [...current, data.userMessage, data.assistantMessage]);
      setDocuments((current) => [...data.documents, ...current]);
      setJobs((current) => [...data.jobs, ...current]);
      formRef.current?.reset();
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Chat message could not be sent.";
      setError(message);
    } finally {
      setIsSending(false);
    }
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
            <small>{jobs.length} handoff job records</small>
          </a>
        </nav>
      </aside>

      <section className="workspace-panel" id="workspace" aria-labelledby="workspace-title">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Agent chat</p>
            <h2 id="workspace-title">Company document intake</h2>
          </div>
          <span className="status-pill">Phase 3</span>
        </header>

        <div className="message-stack" aria-label="Thread">
          {messages.map((message) => (
            <article
              className={`message ${message.role === "USER" ? "user" : "agent"}`}
              key={message.id}
            >
              <div className="message-author">
                {message.role === "USER" ? "Employee" : "Revenue Brains"}
              </div>
              <p>{message.content}</p>
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
          <h2 id="status-title">Handoff</h2>
        </div>

        <div className="metric-grid" aria-label="Processing summary">
          <div className="metric">
            <strong>{documents.length}</strong>
            <span>documents</span>
          </div>
          <div className="metric">
            <strong>{acceptedJobs}</strong>
            <span>accepted</span>
          </div>
          <div className="metric">
            <strong>{failedJobs}</strong>
            <span>failed</span>
          </div>
        </div>

        <section className="status-list" id="documents" aria-label="Documents">
          {documents.length ? (
            documents.map((document) => (
              <article className="status-row" key={document.id}>
                <div>
                  <h3>{document.originalFilename}</h3>
                  <p>{document.storageKey}</p>
                </div>
                <span className={`state state-${document.status.toLowerCase()}`}>
                  {formatStatus(document.status)}
                </span>
              </article>
            ))
          ) : (
            <article className="empty-state">
              <h3>No documents yet</h3>
              <p>Attach files in the chat composer to create document and job records.</p>
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
