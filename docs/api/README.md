# API Contracts

This directory documents the HTTP boundary between the TypeScript web app and the Python agent service. The current implementation includes web health, chat ingestion, conversation/job reads, Python health, LangGraph document ingestion with extraction and Qdrant vector storage, and LangGraph Q&A planning/answer routes.

## Ownership

- TypeScript owns Postgres reads and writes through Prisma.
- Python owns parsing, extraction, validation, Qdrant writes, Qdrant retrieval, and final answer generation.
- Python should not connect directly to Postgres in the MVP.
- Q&A flows that need exact records should use typed retrieval plans and structured Postgres evidence passed through the TypeScript app.
- Chat message and attachment APIs are the primary MVP ingestion interface. A separate dashboard upload endpoint should not be added before the chat ingestion flow works.

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

The route creates or updates a conversation, stores the user chat message, saves attached files under ignored local upload storage, stores document metadata and processing jobs in Postgres, calls Python `POST /documents/process` once per document, saves returned extraction records/fields/source references/vector references through Prisma, updates status, and stores an assistant reply.

If the chat message has no attachments, the same route treats the message as a company-brain question. It calls Python `POST /qa/plan`, fetches TypeScript-owned Postgres evidence when requested, calls Python `POST /qa/answer`, and stores the answer as an assistant message.

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

## MVP Processing Request

The TypeScript app sends Python:

- `conversationId`
- `messageId`
- `documentId`
- `workspaceId`
- `fileStorageKey`
- `checksum`
- `originalFilename`
- `contentType`
- `userInstructions`
- optional `processingOptions`

The MVP should pass a storage key and user instructions, not raw file bytes. Local development should resolve the key against an ignored private upload path shared by the local web and agent processes.

Live processing requires `OPENAI_API_KEY`. `OPENAI_MODEL` defaults to `gpt-4.1-mini`, `OPENAI_EMBEDDING_MODEL` defaults to `text-embedding-3-small`, and `QDRANT_COLLECTION` defaults to `revenue_brains_documents`. Automated tests should use deterministic mocked extraction/vector behavior and must not call live OpenAI or Qdrant.

## MVP Q&A Flow

For semantic-only chat questions, TypeScript can call Python with the question, conversation context, and filters, and Python can retrieve from Qdrant and answer.

For exact-record or hybrid questions:

1. TypeScript sends the question, conversation context, and filters to Python.
2. Python returns a typed retrieval plan when exact Postgres evidence is needed.
3. TypeScript executes the plan through Prisma.
4. TypeScript sends structured evidence back to Python.
5. Python combines structured evidence with Qdrant evidence when needed and returns the cited answer.
