# API Contracts

This directory documents the HTTP boundary between the TypeScript web app and the Python agent service. The current Phase 3 implementation includes web health, chat ingestion, conversation/job reads, Python health, Python document handoff acceptance, and placeholder Q&A routes.

## Ownership

- TypeScript owns Postgres reads and writes through Prisma.
- Python owns parsing, extraction, validation, Qdrant writes, Qdrant retrieval, and final answer generation.
- Python should not connect directly to Postgres in the MVP.
- Q&A flows that need exact records should use typed retrieval plans and structured Postgres evidence passed through the TypeScript app.
- Chat message and attachment APIs are the primary MVP ingestion interface. A separate dashboard upload endpoint should not be added before the chat ingestion flow works.

## Implemented Web Endpoints

### `GET /api/health`

Returns web app process health.

Example response:

```json
{
  "status": "ok",
  "service": "web",
  "app": "revenue-brains",
  "timestamp": "2026-05-06T06:00:00.000Z",
  "uptimeSeconds": 12,
  "checks": {
    "process": "ok"
  }
}
```

This route does not require Postgres, Qdrant, OpenAI, or the Python agent to be available.

### `POST /api/chat/messages`

Accepts multipart form data from the chat composer.

Fields:

- `conversationId`: optional existing conversation ID.
- `content`: optional chat message text.
- `userInstructions`: optional processing instruction text.
- `files`: zero or more attached files.

The route creates or updates a conversation, stores the user chat message, saves attached files under ignored local upload storage, stores document metadata and processing jobs in Postgres, calls Python `POST /documents/process` once per document, and stores an assistant status reply.

Phase 3 returns handoff/job status only. It does not parse document text, extract fields, create embeddings, or use Qdrant.

### `GET /api/chat/:conversationId`

Returns one conversation with ordered messages, attached documents, and processing jobs.

### `GET /api/jobs/:jobId`

Returns one processing job with its document metadata.

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

Current status: implemented as a Phase 3 accepted stub that validates the request body and returns `202`.

Request shape:

```json
{
  "conversationId": "conv_123",
  "messageId": "msg_123",
  "documentId": "doc_123",
  "workspaceId": "workspace_123",
  "fileStorageKey": "uploads/documents/doc_123.pdf",
  "checksum": "sha256:placeholder",
  "originalFilename": "invoice.pdf",
  "contentType": "application/pdf",
  "userInstructions": "Extract invoice fields.",
  "processingOptions": {}
}
```

Current accepted-stub response:

```json
{
  "status": "accepted",
  "endpoint": "/documents/process",
  "documentId": "doc_123",
  "processingImplemented": false,
  "message": "Document processing was accepted for a future extraction phase."
}
```

Future processing response should include detected document type, extracted fields, validation status, confidence, source references, extracted facts, summary, Qdrant vector references, chat reply content, and structured errors when processing fails.

### `POST /qa/plan`

Current status: implemented as a placeholder that validates the request body and returns `501`.

Request shape:

```json
{
  "workspaceId": "workspace_123",
  "conversationId": "conv_123",
  "question": "Which invoices are overdue?",
  "filters": {}
}
```

Current placeholder response:

```json
{
  "status": "not_implemented",
  "endpoint": "/qa/plan",
  "message": "Q&A retrieval planning is intentionally not implemented yet."
}
```

Future response should identify whether exact Postgres evidence, Qdrant semantic evidence, or both are needed.

### `POST /qa/answer`

Current status: implemented as a placeholder that validates the request body and returns `501`.

Request shape:

```json
{
  "workspaceId": "workspace_123",
  "conversationId": "conv_123",
  "question": "What does the renewal clause say?",
  "postgresEvidence": [],
  "qdrantContext": []
}
```

Current placeholder response:

```json
{
  "status": "not_implemented",
  "endpoint": "/qa/answer",
  "message": "Q&A answer generation is intentionally not implemented yet."
}
```

Future response should return an answer with citations where possible and should say when there is not enough evidence.

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

## MVP Q&A Flow

For semantic-only chat questions, TypeScript can call Python with the question, conversation context, and filters, and Python can retrieve from Qdrant and answer.

For exact-record or hybrid questions:

1. TypeScript sends the question, conversation context, and filters to Python.
2. Python returns a typed retrieval plan when exact Postgres evidence is needed.
3. TypeScript executes the plan through Prisma.
4. TypeScript sends structured evidence back to Python.
5. Python combines structured evidence with Qdrant evidence when needed and returns the cited answer.
