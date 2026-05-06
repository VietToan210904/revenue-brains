# API Contracts

This directory is the future home for HTTP contracts between the TypeScript app and Python agent service. The scaffold milestone should turn these notes into OpenAPI specs, typed schemas, or generated shared types.

The endpoint names below are the initial contracts for the scaffold and early MVP. They may later move into OpenAPI files or generated shared schemas, but implementation should not invent different names without updating this document and the scaffold plan.

## Ownership

- TypeScript owns Postgres reads and writes through Prisma.
- Python owns parsing, extraction, validation, Qdrant writes, Qdrant retrieval, and final answer generation.
- Python should not connect directly to Postgres in the MVP.
- Q&A flows that need exact records should use typed retrieval plans and structured Postgres evidence passed through the TypeScript app.
- Chat message and attachment APIs are the primary MVP ingestion interface. A separate dashboard upload endpoint should not be added before the chat ingestion flow works.

## Initial Endpoints

### Web App

- `GET /api/health`: returns web app process health and, once services exist, lightweight connectivity status for Postgres and the Python agent.
- `POST /api/chat/messages`: accepts message text plus zero or more file attachments. Creates or updates a conversation, stores attachments privately, creates document records and processing jobs for attached files, and returns the user message plus initial agent/job status. Text-only messages can route to Q&A once the Q&A milestone is available.
- `GET /api/chat/:conversationId`: returns conversation messages, agent replies, attached documents, extracted-record links, and processing status.
- `GET /api/jobs/:jobId`: returns processing status for a job started from a chat attachment.

### Python Agent Service

- `GET /health`: returns Python agent process health.
- `POST /documents/process`: processes one stored chat attachment using a storage key plus user instructions and returns extraction, confidence, validation, source references, chat reply content, and Qdrant vector references when ingestion is available.
- `POST /qa/plan`: accepts a user question and returns whether exact Postgres evidence, Qdrant semantic evidence, or both are needed.
- `POST /qa/answer`: accepts a user question plus structured Postgres evidence and/or Qdrant context, then returns an answer with citations where possible.

## MVP Processing Request

The TypeScript app should send Python:

- `conversationId`
- `messageId`
- `documentId`
- `workspaceId`
- `fileStorageKey`
- `checksum`
- `originalFilename`
- `contentType`
- `userInstructions`
- optional processing options

The MVP should pass a storage key and user instructions, not raw file bytes. Local development should resolve the key against a private upload volume shared by both services.

## MVP Processing Response

Python should return:

- detected document type
- common fields
- supported type-specific fields
- validation status
- document-level and field-level confidence
- source references
- extracted facts and summary
- Qdrant vector references after Python-owned ingestion
- chat reply content for the employee
- structured errors when processing fails

## MVP Q&A Flow

For semantic-only chat questions, TypeScript can call Python with the question, conversation context, and filters, and Python can retrieve from Qdrant and answer.

For exact-record or hybrid questions:

1. TypeScript sends the question, conversation context, and filters to Python.
2. Python returns a typed retrieval plan when exact Postgres evidence is needed.
3. TypeScript executes the plan through Prisma.
4. TypeScript sends structured evidence back to Python.
5. Python combines structured evidence with Qdrant evidence when needed and returns the cited answer.
