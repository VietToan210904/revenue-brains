# Architecture

## Summary

Revenue Brains uses a hybrid TypeScript and Python architecture.

TypeScript owns the product application: chat workspace, dashboard/status views, API routes, persistence, authentication, job status, exact Postgres reads and writes, and sync workflows. Python owns the intelligence layer: document parsing, classification, extraction, validation, embeddings, Qdrant access, retrieval planning, and answer generation.

Postgres and Qdrant serve different purposes. Postgres stores exact structured records. Qdrant stores vector memory for semantic retrieval.

## System Diagram

```txt
Employee
   |
   | sends chat message with attachments / asks question
   v
Next.js chat workspace, dashboard views, and TypeScript API
   |-- Prisma exact records, jobs, audit state --> Postgres
   |
   |-- HTTP processing, retrieval planning, answers --> Python FastAPI agent service
                                                            |
                                                            |-- Qdrant client for embeddings and retrieval --> Qdrant
```

## Next.js App Role

The Next.js app should handle:

- agent chat UI
- dashboard/status views
- chat message and attachment handling
- original file storage handoff
- processing job creation and status display
- authenticated single-company workspace behavior
- Postgres access through Prisma
- calls to the Python agent service
- webhook sync for high-confidence records once the deferred webhook milestone exists
- Q&A user experience

The TypeScript app should not duplicate the Python agent logic. It should call the agent service through explicit APIs.

The TypeScript app should own all Postgres reads and writes for the MVP: conversations, chat messages, attachment metadata, document metadata, jobs, extracted records, validation results, Qdrant vector references, webhook attempts, Q&A sessions, and user-facing status. The Python service should return typed payloads that the TypeScript app persists.

## Python Agent Service Role

The Python FastAPI service should handle:

- document text extraction and normalization
- document classification
- schema-guided information extraction
- confidence scoring
- validation of extracted values
- document chunking
- embedding generation
- Qdrant ingestion
- retrieval planning for Q&A
- final answer generation with source references
- chat reply generation for processing outcomes and Q&A

The Python service should return structured outputs that the TypeScript app can validate and persist.

The Python service should own Qdrant writes for chunks, extracted facts, summaries, embeddings, and retrieval metadata. It should return vector IDs and source references so Postgres records can point back to the semantic memory.

The Python service should not connect directly to Postgres in the MVP. For Q&A, it should receive structured Postgres evidence from the TypeScript app or return a typed retrieval plan that the TypeScript app executes through Prisma.

## Postgres Role

Postgres is the source of truth for exact structured data.

Store these in Postgres:

- users and workspace data
- conversations and chat messages
- chat-attached document metadata
- original file storage keys, checksums, filenames, content types, user instructions, and attachment audit fields
- processing jobs and statuses
- extracted records
- extracted fields and confidence
- validation results
- Qdrant vector IDs and chunk metadata
- webhook sync attempts
- Q&A sessions and messages

Use Postgres for exact queries such as invoice totals, due dates, vendors, contract renewal dates, record status, and processing history.

## Qdrant Role

Qdrant is the vector memory for RAG retrieval.

Store these in Qdrant:

- document text chunks
- concise extracted facts
- summaries
- embeddings
- document IDs
- chunk IDs
- source metadata
- references back to Postgres records

Use Qdrant for semantic retrieval, not as the only database for business records.

Qdrant metadata should be enough to find the related source document and Postgres record, but source identity and audit state should remain durable in Postgres.

## Future MCP Agent Tool Server

Revenue Brains can add a TypeScript/Node MCP server after the core MVP and privacy hardening are working. The primary MCP use case is letting the Python agent act as an MCP client and call controlled tools for document metadata, extracted-record lookup, processing job status, approved reference data, and later external systems.

The TypeScript/Node MCP server should follow the existing ownership model. Exact-record tools should call TypeScript-owned APIs or shared TypeScript data-access code for Prisma-backed Postgres reads. Semantic retrieval and answer generation should remain inside the Python agent/Q&A flow. MCP should not pass raw database credentials to the Python agent or bypass authentication, workspace scoping, confidence gates, or audit logging.

## Chat Document Ingestion Flow

```txt
Chat message with attachments
  -> store chat message and original files outside Git
  -> create document rows with storage keys, checksums, and user instructions
  -> create processing job
  -> call Python agent over HTTP with conversation ID, message ID, document ID, storage key, and user instructions
  -> parse text
  -> classify document
  -> extract fields guided by instructions
  -> validate and score confidence with source references
  -> save records in Postgres
  -> embed chunks and facts in Qdrant
  -> store Qdrant vector references in Postgres
  -> create an agent chat reply with summary, status, confidence, and record links
  -> mark job complete or failed
  -> later webhook milestone may sync high-confidence records
```

## File Handoff Contract

For the MVP, the TypeScript app should store the chat message and original attachment first, then send the Python service a `fileStorageKey`, not raw file bytes. In local development, that key should resolve against an ignored private upload path shared by the local web and agent processes. Later deployments can map the same contract to object-storage-compatible storage.

The processing request should include conversation ID, message ID, document ID, workspace ID, file storage key, original filename, content type, checksum, user instructions, and optional processing options. This keeps attachment limits, retry behavior, and audit metadata under the TypeScript app while letting Python read the file for parsing.

## Hybrid Q&A Flow

```txt
Chat question
  -> TypeScript app receives message and conversation context
  -> Python returns retrieval plan or answers semantic-only questions
  -> TypeScript queries Postgres through Prisma for exact facts when needed
  -> Python queries Qdrant for semantic context when needed
  -> TypeScript sends structured Postgres evidence to Python when needed
  -> Python combines retrieved evidence and generates answer
  -> return citations and source references
```

Examples:

- "Which invoices are due this month?" should use Postgres.
- "What does the refund policy say?" should use Qdrant.
- "Which contract mentions annual renewal and what is its renewal date?" may use both.

Python should not generate SQL or read Postgres directly in the MVP. Any Postgres-backed evidence passed to Python should be typed business data with record IDs and source references, not raw database access.

## Processing Job States

Allowed processing states should be explicit:

- `attached`: chat message, file, and document metadata are stored, but processing has not started.
- `queued`: a processing job exists and is waiting to run.
- `processing`: the Python agent is parsing, classifying, extracting, validating, or embedding.
- `extracted`: structured extraction was returned and saved, but Qdrant ingestion is not complete.
- `completed`: Postgres save and Qdrant ingestion both succeeded.
- `needs_review`: processing completed with medium or low confidence, missing evidence, or validation warnings.
- `partial_failed`: one durable output succeeded and another failed, such as Postgres records saved but Qdrant ingestion failed.
- `failed`: no usable processing result was produced.
- `retrying`: a failed or partial job is being retried.

Retries should preserve the previous error, attempt count, timestamps, and last successful stage. Partial success should not erase saved records or vector references unless a later retry replaces them deliberately.

## Confidence-Gated Automation

Automation is automatic by default, but unsafe writes should be gated.

- High-confidence extraction: score `>= 0.85`, required fields present, validation passes, important fields have source references, save to Postgres, and allow webhook sync only after the generic webhook milestone exists.
- Medium-confidence extraction: score `>= 0.60` and `< 0.85` or minor validation gaps, save internally, show status, and block webhook sync.
- Low-confidence extraction: score `< 0.60`, unsupported values, missing critical fields, or severe validation failures, save internally with warnings or failed status, and block webhook sync.
- Failed processing: preserve the error, allow retry, and do not sync.

This keeps employees from manually filling fields during the normal workflow while protecting external systems from bad data.
