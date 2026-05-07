# API Contracts

This directory documents the HTTP boundary between the TypeScript web app, the Python agent service, and the Revenue Brains MCP server. The current implementation includes web health, chat ingestion, async autonomous agent runs, internal agent-run callbacks, conversation/job reads, Python health, a compatibility LangGraph supervisor endpoint, LangGraph document ingestion with extraction and Qdrant vector storage, LangGraph Q&A planning/answer routes, webhook sync, and controlled MCP tools.

The TypeScript app also owns outgoing webhook sync for trusted extracted records. Python never calls external webhooks directly.

## Ownership

- TypeScript owns Postgres reads and writes through Prisma.
- Python owns parsing, extraction, validation, Qdrant writes, Qdrant retrieval, and final answer generation.
- Python should not connect directly to Postgres in the MVP.
- Q&A flows that need exact records should use typed retrieval plans and structured Postgres evidence passed through the TypeScript app.
- Chat message and attachment APIs are the primary MVP ingestion interface. A separate dashboard upload endpoint should not be added before the chat ingestion flow works.

## Implemented MCP Interfaces

The TypeScript/Node MCP server runs from `services/mcp-server/` and supports:

- Streamable HTTP at `http://localhost:8787/mcp`
- stdio mode through `npm run mcp:stdio`

HTTP requests require `Authorization: Bearer <MCP_SERVER_TOKEN>`. The MCP server calls the web app's internal tool executor at `POST /api/internal/mcp/tools` using `x-mcp-internal-token`, so Postgres access remains TypeScript-owned through Prisma.

During autonomous runs, the Python MCP Tool Agent loads the available MCP tool list, chooses relevant tools from the Manager intent, attachments, question text, and run context, calls the MCP server, and emits one `AgentStep` for each MCP tool call. Successful MCP results are converted into exact evidence for the Q&A Agent and verified context for the Response Agent.

Implemented tools:

- `get_workspace_summary`
- `search_documents`
- `get_document_metadata`
- `get_processing_job`
- `search_extracted_records`
- `get_extracted_record`
- `get_agent_run`
- `get_vector_references`
- `list_webhook_sync_attempts`
- `trigger_webhook_sync`
- `request_document_reprocess`

The MCP layer must not expose raw SQL, shell execution, raw private uploads, full document text, secrets, raw embeddings, or unrestricted filesystem tools.

## Implemented Web Endpoints

### `GET /api/health`

Returns web app health plus local dependency checks for Postgres, the Python agent, Qdrant, and the configured Qdrant collection.

Example response:

```json
{
  "status": "ok",
  "service": "web",
  "app": "revenue-brains",
  "timestamp": "2026-05-06T06:00:00.000Z",
  "uptimeSeconds": 12,
  "checks": {
    "process": {
      "status": "ok",
      "message": "Web process is running."
    },
    "postgres": {
      "status": "ok",
      "message": "Postgres query succeeded.",
      "durationMs": 8
    },
    "agent": {
      "status": "ok",
      "message": "Python agent health check succeeded.",
      "durationMs": 14
    },
    "qdrant": {
      "status": "ok",
      "message": "Qdrant service is reachable.",
      "durationMs": 9
    },
    "qdrantCollection": {
      "status": "ok",
      "message": "Qdrant collection 'revenue_brains_documents' exists.",
      "durationMs": 10
    }
  }
}
```

The top-level `status` is `ok` when every dependency check passes and `degraded` when one or more local dependencies are unavailable. The route must not expose secrets, raw connection strings, API keys, or document content.

### `POST /api/chat/messages`

Accepts multipart form data from the chat composer.

Fields:

- `conversationId`: optional existing conversation ID.
- `content`: optional chat message text.
- `userInstructions`: optional processing instruction text.
- `files`: zero or more attached files.

The route creates or updates a conversation, stores the user chat message, saves attached files under ignored local upload storage, stores document metadata and processing jobs in Postgres, creates an `AgentRun`, creates a pending assistant message, gathers recent Postgres evidence, and calls Python `POST /agent/runs/start`.

If the chat message has no attachments, the same route still starts an autonomous run. The Manager Agent can route the request to Q&A, ask for clarification, or return a safe unsupported response. The lower-level document, Q&A, and supervisor endpoints remain available for compatibility and testing.

### `GET /api/agent-runs/:runId`

Returns one async autonomous run with ordered steps, artifacts, the pending or final assistant message, related documents, jobs, and extracted records. The chat UI polls this endpoint to show the live multi-agent activity timeline.

### Internal Agent Run Callback Endpoints

Python calls these TypeScript endpoints during async autonomous runs:

- `POST /api/internal/agent-runs/:runId/events`
- `POST /api/internal/agent-runs/:runId/complete`
- `POST /api/internal/agent-runs/:runId/fail`

Callbacks must include `x-agent-callback-secret` matching `AGENT_CALLBACK_SECRET`. Payloads should contain safe summaries, structured extraction results, Q&A answers, vector references, artifacts, and status metadata. They must not include API keys, raw database credentials, raw full document text, raw storage paths, or unrestricted model traces.

Phase 7.1 requires every async run to settle into a final state: `COMPLETED`, `NEEDS_REVIEW`, or `FAILED`. Late progress events may still be stored for audit, but they must not reopen a finished run. If Python fails during the autonomous team run, it should call the fail callback with safe error text and redacted metadata so the UI can stop polling and show a clear failure.

### `GET /api/chat/:conversationId`

Returns one conversation with ordered messages, attached documents, processing jobs, extracted records, extracted fields, source references, and vector references.

### `GET /api/jobs/:jobId`

Returns one processing job with its document metadata and extracted record when available.

## Implemented Agent Endpoints

### `GET /health`

Returns Python agent process health.

Example response:

```json
{
  "status": "ok",
  "service": "agent"
}
```

### `POST /agent/runs/start`

Current status: implemented as the Phase 7.1 stabilized async autonomous multi-agent endpoint. This is the primary endpoint used by the web chat route. It receives the user message, attachment metadata/storage keys, optional instructions, callback base URL, and recent TypeScript-owned Postgres evidence. It starts a background autonomous team run and immediately returns `202 Accepted`.

Request shape:

```json
{
  "agentRunId": "run_123",
  "workspaceId": "workspace_123",
  "conversationId": "conv_123",
  "messageId": "msg_123",
  "userMessage": "Please process this invoice and tell me the due date.",
  "userInstructions": "Keep payment terms visible.",
  "attachments": [
    {
      "documentId": "doc_123",
      "fileStorageKey": "documents/invoice.md",
      "checksum": "sha256:placeholder",
      "originalFilename": "invoice.md",
      "contentType": "text/markdown"
    }
  ],
  "postgresEvidence": [],
  "callbackBaseUrl": "http://localhost:3000",
  "processingOptions": {}
}
```

Accepted response shape:

```json
{
  "status": "accepted",
  "agentRunId": "run_123",
  "message": "Autonomous agent run started."
}
```

The autonomous team emits ordered callback events for the Manager, Intake, Extraction, Validation/Critic, Memory, MCP Tool, Q&A, and Response agents. Completion payloads include `intent`, `toolActions`, `extractions`, optional `qaAnswer`, `automationDecision`, `reply`, and safe artifacts. MCP tool calls are logged as agent steps with safe arguments, status, and output summaries. Failure payloads include a safe error message and optional agent name.

### `POST /agent/respond`

Current status: implemented as the Phase 6 LangGraph supervisor compatibility endpoint. It remains available for direct tests and backward compatibility, but the web chat route now uses `POST /agent/runs/start`.

Allowed `intent` values are `ingest_documents`, `answer_question`, `ingest_and_answer`, `clarify`, and `unsupported`. Clarification responses use top-level `status: "needs_clarification"`. Unsupported MVP requests use `status: "unsupported"`. The endpoint should not expose secrets, raw database credentials, or raw document content in errors.

### `POST /documents/process`

Current status: implemented as LangGraph synchronous document ingestion. The endpoint resolves `fileStorageKey` under `UPLOAD_STORAGE_PATH`, parses supported text-based files, classifies the document, extracts structured data with LangChain structured output unless test processing options request deterministic extraction, returns an AI-owned `agentAssessment`, chunks parsed text, embeds chunks, stores them in Qdrant, and returns source references plus vector references.

Request shape:

```json
{
  "conversationId": "conv_123",
  "messageId": "msg_123",
  "documentId": "doc_123",
  "workspaceId": "workspace_123",
  "fileStorageKey": "documents/doc_123.pdf",
  "checksum": "sha256:placeholder",
  "originalFilename": "invoice.pdf",
  "contentType": "application/pdf",
  "userInstructions": "Extract invoice fields.",
  "processingOptions": {}
}
```

Successful extraction response:

```json
{
  "status": "extracted",
  "documentId": "doc_123",
  "documentType": "INVOICE",
  "title": "Invoice INV-1001",
  "commonFields": [
    {
      "name": "title",
      "label": "Title",
      "fieldType": "STRING",
      "valueString": "Invoice INV-1001",
      "valueNumber": null,
      "valueDate": null,
      "currency": null,
      "valueJson": null,
      "confidence": 0.92,
      "required": true,
      "validationStatus": "passed"
    }
  ],
  "typeSpecificFields": [
    {
      "name": "invoice_number",
      "label": "Invoice Number",
      "fieldType": "STRING",
      "valueString": "INV-1001",
      "valueNumber": null,
      "valueDate": null,
      "currency": null,
      "valueJson": null,
      "confidence": 0.91,
      "required": true,
      "validationStatus": "passed"
    }
  ],
  "summary": "Invoice from Acme Cloud for hosted services.",
  "keyFacts": ["Vendor: Acme Cloud", "Invoice Number: INV-1001"],
  "tags": ["invoice", "finance"],
  "documentConfidence": 0.9,
  "fieldConfidences": {
    "invoice_number": 0.91
  },
  "validation": {
    "status": "passed",
    "missingRequiredFields": [],
    "warnings": []
  },
  "agentAssessment": {
    "status": "extracted",
    "validationStatus": "passed",
    "documentConfidence": 0.9,
    "reviewRequired": false,
    "reviewReasons": [],
    "missingFields": [],
    "uncertainFields": [],
    "automationDecision": "safe_to_save",
    "automationDecisionReason": "All important fields are supported by evidence."
  },
  "sourceReferences": [
    {
      "fieldName": "invoice_number",
      "pageNumber": 1,
      "paragraphIndex": null,
      "lineStart": null,
      "lineEnd": null,
      "charStart": null,
      "charEnd": null,
      "evidenceSnippet": "Invoice Number: INV-1001"
    }
  ],
  "vectorReferences": [
    {
      "chunkId": "doc_123:chunk:0",
      "qdrantCollection": "revenue_brains_documents",
      "qdrantPointId": "9d8f0c5e-2e29-5e99-9282-8f4c973e9f65",
      "chunkIndex": 0,
      "contentPreview": "Invoice Number: INV-1001 Vendor: Acme Cloud...",
      "metadata": {
        "workspaceId": "workspace_123",
        "documentId": "doc_123",
        "documentType": "INVOICE"
      }
    }
  ],
  "chatReply": "Processed as Invoice with 90% confidence. Invoice Number: INV-1001.",
  "processingImplemented": true
}
```

The `status` value is the agent's decision. `extracted` means the agent believes the record is ready to save as extracted; `needs_review` means the agent wants the result kept visible but reviewable. Missing files, unsupported formats, parse failures, model failures, malformed agent assessments, and invalid extractions return structured non-2xx errors:

```json
{
  "status": "error",
  "code": "missing_file",
  "message": "The uploaded document file was not found in private storage.",
  "documentId": "doc_123",
  "processingImplemented": true,
  "details": {
    "fileStorageKey": "documents/doc_123.pdf"
  }
}
```

Python owns Qdrant writes and returns vector references. TypeScript persists those references in Postgres so semantic chunks remain auditable back to source documents and extracted records.

### `POST /qa/plan`

Current status: implemented as a LangGraph retrieval planner.

Request shape:

```json
{
  "workspaceId": "workspace_123",
  "conversationId": "conv_123",
  "question": "Which invoices are overdue?",
  "filters": {}
}
```

Successful response:

```json
{
  "status": "planned",
  "retrievalMode": "hybrid",
  "postgresQuery": {
    "documentType": "CONTRACT"
  },
  "qdrantQuery": "What does the renewal clause say?",
  "reasoning": "The answer needs exact contract records and semantic clause context."
}
```

`retrievalMode` is `postgres`, `qdrant`, or `hybrid`. TypeScript owns any Postgres reads implied by the plan.

### `POST /qa/answer`

Current status: implemented as a LangGraph Q&A answer generator.

Request shape:

```json
{
  "workspaceId": "workspace_123",
  "conversationId": "conv_123",
  "question": "What does the renewal clause say?",
  "retrievalMode": "hybrid",
  "postgresEvidence": [],
  "qdrantContext": []
}
```

Successful response:

```json
{
  "status": "answered",
  "answer": "The renewal clause requires 30 days notice before the renewal date.",
  "retrievalMode": "hybrid",
  "citations": [
    {
      "sourceType": "qdrant",
      "documentId": "doc_123",
      "recordId": null,
      "qdrantPointId": "9d8f0c5e-2e29-5e99-9282-8f4c973e9f65",
      "title": "Master Services Agreement",
      "snippet": "renewal requires 30 days notice"
    }
  ],
  "confidence": 0.86,
  "limitations": []
}
```

The answer endpoint retrieves Qdrant context when the request mode is `qdrant` or `hybrid`. For `postgres`, it answers from the supplied Postgres evidence only.

Q&A citations are practical MVP citations. They should identify whether the evidence came from Postgres or Qdrant, include a document title or source ID when available, include a short snippet, and preserve enough IDs for follow-up audit. Full audit-grade navigation is deferred.

## MVP Autonomous Run And Processing Request

The TypeScript app now sends normal chat work to Python through `POST /agent/runs/start` with:

- `agentRunId`
- `conversationId`
- `messageId`
- `workspaceId`
- `userMessage`
- `userInstructions`
- `attachments` containing document IDs, storage keys, checksums, filenames, and content types
- `postgresEvidence` containing recent TypeScript-owned exact records
- `callbackBaseUrl`
- optional `processingOptions`

The lower-level `POST /documents/process` endpoint still accepts one document ID and one storage key. The MVP should pass storage keys and user instructions, not raw file bytes. Local development should resolve the key against an ignored private upload path shared by the local web and agent processes.

Live processing requires `OPENAI_API_KEY`. `OPENAI_MODEL` defaults to `gpt-4.1-mini`, `OPENAI_EMBEDDING_MODEL` defaults to `text-embedding-3-small`, and `QDRANT_COLLECTION` defaults to `revenue_brains_documents`. Automated tests should use deterministic mocked extraction/vector behavior and must not call live OpenAI or Qdrant.

## MVP Q&A Flow

For normal chat questions, TypeScript starts an autonomous run with the question, conversation context, and recent Postgres evidence. The Manager Agent can delegate to the MCP Tool Agent for exact-record tools and to the Q&A Agent for Qdrant retrieval and answer generation.

For exact-record or hybrid questions:

1. TypeScript sends the question, conversation context, and recent structured evidence to the autonomous team.
2. The Manager Agent decides whether Q&A is needed.
3. The MCP Tool Agent chooses and calls exact-record MCP tools when useful.
4. The Q&A graph plans Qdrant or hybrid retrieval.
5. Python combines TypeScript-supplied structured evidence, MCP tool results, and Qdrant evidence when needed.
6. Python returns the cited answer through the autonomous run completion callback.

## Outgoing Webhook Sync

Current status: implemented as Phase 8 env-configured sync for high-confidence extracted records.

`WEBHOOK_URL` controls delivery. Blank means disabled and creates a skipped sync attempt for otherwise eligible records. `WEBHOOK_SECRET` is required when `WEBHOOK_URL` is set and signs the raw JSON payload.

Eligible records:

- document status is `EXTRACTED`
- extracted record validation status is `PASSED`
- agent automation decision is `safe_to_save`

Review-needed, failed, unsupported, clarification, or missing-extraction runs are not sent externally.

Outgoing headers:

```txt
x-revenue-brains-event: extraction.completed
x-revenue-brains-delivery-id: <WebhookSyncAttempt.id>
x-revenue-brains-signature: sha256=<hmac>
```

Payload includes safe structured data only: workspace/document/conversation IDs, original filename, content type, storage key, checksum, extracted record title/summary/confidence/status, extracted fields, source reference snippets, vector reference IDs/previews, agent run ID, and automation decision. It must not include raw full document text, API keys, raw database credentials, or full model traces.
