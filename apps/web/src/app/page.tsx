const conversations = [
  {
    name: "Company document intake",
    detail: "Workspace scaffold",
    active: true
  },
  {
    name: "Invoice review queue",
    detail: "Pending pipeline"
  },
  {
    name: "Contract Q&A",
    detail: "Pending Q&A pipeline"
  }
];

const messages = [
  {
    author: "Revenue Brains",
    tone: "agent",
    body: "The web scaffold is online. App Router, TypeScript, ESLint, and the health endpoint are ready."
  },
  {
    author: "Workspace",
    tone: "user",
    body: "Keep the next milestone focused on chat-attached documents, processing status, and typed service contracts."
  },
  {
    author: "Revenue Brains",
    tone: "agent",
    body: "Upload, extraction, RAG, auth, webhook sync, and real processing remain outside this scaffold."
  }
];

const serviceStatuses = [
  {
    name: "Web app",
    state: "Online",
    description: "Next.js process and App Router"
  },
  {
    name: "Health API",
    state: "Ready",
    description: "GET /api/health"
  },
  {
    name: "Chat ingestion",
    state: "Planned",
    description: "No message API yet"
  },
  {
    name: "Agent service",
    state: "Planned",
    description: "FastAPI scaffold exposes /health"
  }
];

export default function Home() {
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
          {conversations.map((conversation) => (
            <a
              className={conversation.active ? "conversation active" : "conversation"}
              href="#workspace"
              key={conversation.name}
            >
              <span>{conversation.name}</span>
              <small>{conversation.detail}</small>
            </a>
          ))}
        </nav>
      </aside>

      <section className="workspace-panel" id="workspace" aria-labelledby="workspace-title">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Chat workspace</p>
            <h2 id="workspace-title">Company document thread</h2>
          </div>
          <span className="status-pill">Scaffold</span>
        </header>

        <div className="message-stack" aria-label="Thread preview">
          {messages.map((message) => (
            <article className={`message ${message.tone}`} key={message.body}>
              <div className="message-author">{message.author}</div>
              <p>{message.body}</p>
            </article>
          ))}
        </div>

        <form className="composer" aria-label="Message composer">
          <label htmlFor="message">Message</label>
          <textarea
            id="message"
            name="message"
            placeholder="Chat API will connect here in a later milestone."
            readOnly
            rows={4}
          />
          <div className="composer-actions">
            <span>Attachment workflow is not enabled.</span>
            <button type="button" disabled>
              Send
            </button>
          </div>
        </form>
      </section>

      <aside className="status-panel" aria-labelledby="status-title">
        <div className="panel-heading">
          <p className="eyebrow">Runtime</p>
          <h2 id="status-title">Status</h2>
        </div>

        <div className="status-list">
          {serviceStatuses.map((service) => (
            <article className="status-row" key={service.name}>
              <div>
                <h3>{service.name}</h3>
                <p>{service.description}</p>
              </div>
              <span className={`state state-${service.state.toLowerCase()}`}>{service.state}</span>
            </article>
          ))}
        </div>
      </aside>
    </main>
  );
}
