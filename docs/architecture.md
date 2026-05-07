# Architecture

## Summary

Revenue Brains uses a hybrid TypeScript and Python architecture.

TypeScript owns the product application: chat workspace, dashboard/status views, API routes, persistence, authentication, job status, exact Postgres reads and writes, and sync workflows. Python owns the intelligence layer: document parsing, classification, extraction, validation, embeddings, Qdrant access, retrieval planning, and answer generation.

Postgres and Qdrant serve different purposes. Postgres stores exact structured records. Qdrant stores vector memory for semantic retrieval.

The current implementation is a local Phase 7.1 MVP. Phase 5 proved chat ingestion, extraction, vector memory, basic hybrid Q&A, practical citations, and dependency-aware health checks. Phase 6 added a supervisor agent that decides which controlled tools to use for each chat request. Phase 7 added async autonomous agent runs with a Manager, Intake, Extraction, Validation/Critic, Memory, Q&A, and Response agent team. Phase 7.1 stabilizes run final states, safe callbacks, test coverage, and the visible activity timeline. It is not production-ready.

## System Diagram

```txt
Employee
   |
   | sends chat message with attachments / asks question
   v
Next.js chat workspace, dashboard views, and TypeScript API
   |-- Prisma exact records, jobs, audit state --> Postgres
   |
   |-- HTTP async agent run start --> Python FastAPI agent service
                                      |
                                      |-- autonomous multi-agent team plans, delegates, critiques, remembers, answers
                                      |
                                      |-- Qdrant client for embeddings and retrieval --> Qdrant
   ^
   |-- internal progress/completion/failure callbacks from Python
```

## Next.js App Role

The Next.js app should handle:

- agent chat UI
- dashboard/status views
- chat message and attachment handling
- original file storage handoff
- processing job creation and status display
- async `AgentRun`, `AgentStep`, and `AgentArtifact` persistence
- authenticated single-company workspace behavior
- Postgres access through Prisma
- calls to the Python agent service
- webhook sync for high-confidence records once the deferred webhook milestone exists
- Q&A user experience
- dependency-aware health reporting for local Postgres, Python agent, Qdrant, and configured Qdrant collection

The TypeScript app should not duplicate the Python agent logic. It should call the agent service through explicit APIs.

The TypeScript app should own all Postgres reads and writes for the MVP: conversations, chat messages, attachment metadata, document metadata, jobs, extracted records, validation results, Qdrant vector references, webhook attempts, Q&A sessions, and user-facing status. The Python service should return typed payloads that the TypeScript app persists.

## Python Agent Service Role

The Python FastAPI service should handle:

- document text extraction and normalization
- Manager intent decisions, multi-agent delegation, and controlled tool orchestration
- autonomous multi-agent planning, delegation, critique, retry limits, and response composition
- document classification
- schema-guided information extraction
- AI-native confidence, validation, and review assessment
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
  -> create AgentRun and pending assistant message
  -> call Python autonomous team over HTTP with message, attachment metadata, storage keys, callback URL, and user instructions
  -> Manager Agent chooses document ingestion, Q&A, both, clarification, or unsupported response
  -> Python emits agent step events to TypeScript internal callback endpoints
  -> ingestion graph parses text
  -> ingestion graph classifies document
  -> ingestion graph extracts fields guided by instructions
  -> ingestion graph validates and scores confidence with source references
  -> save records in Postgres
  -> embed chunks and facts in Qdrant
  -> store Qdrant vector references in Postgres
  -> create an agent chat reply with summary, status, confidence, and record links
  -> mark job complete or failed
  -> later webhook milestone may sync high-confidence records
```

The current implementation follows this flow with a LangGraph autonomous team over LangGraph ingestion and Q&A graphs. Phase 7.1 also ensures completed, review-needed, and failed runs settle into clear persisted states. Webhook sync remains deferred.

## Autonomous Agent Run Flow

```txt
POST /api/chat/messages
  -> TypeScript stores user message, documents, jobs, pending assistant message, and AgentRun
  -> Python POST /agent/runs/start returns 202 accepted
  -> Manager Agent plans intent and delegates
  -> Intake Agent inspects attachment metadata
  -> Extraction Agent calls the ingestion graph when needed
  -> Validation/Critic Agent checks quality and review need from agent outputs
  -> Memory Agent confirms vector memory references from Qdrant ingestion
  -> Q&A Agent answers when the request asks a question
  -> Response Agent writes the final employee-facing message from verified outputs only
  -> Python calls TypeScript events/complete/fail callbacks
  -> UI polls GET /api/agent-runs/:runId and shows the timeline
```

The Response Agent is deliberately separate from the Q&A Agent. It should not discover new facts; it communicates verified extraction, Q&A, citation, limitation, and review outputs.

## File Handoff Contract

For the MVP, the TypeScript app should store the chat message and original attachment first, then send the Python service a `fileStorageKey`, not raw file bytes. In local development, that key should resolve against an ignored private upload path shared by the local web and agent processes. Later deployments can map the same contract to object-storage-compatible storage.

The processing request should include conversation ID, message ID, document ID, workspace ID, file storage key, original filename, content type, checksum, user instructions, and optional processing options. This keeps attachment limits, retry behavior, and audit metadata under the TypeScript app while letting Python read the file for parsing.

## Hybrid Q&A Flow

```txt
Chat question
  -> TypeScript app receives message and conversation context
  -> TypeScript sends recent Postgres evidence to the Python autonomous team
  -> Manager Agent chooses the Q&A tool
  -> Python LangGraph Q&A planner returns a retrieval plan
  -> TypeScript queries Postgres through Prisma for exact facts when needed
  -> TypeScript sends structured Postgres evidence to Python when needed
  -> Python queries Qdrant for semantic context when needed
  -> Python combines retrieved evidence and generates answer
  -> return practical citations and source references
```

Examples:

- "Which invoices are due this month?" should use Postgres.
- "What does the refund policy say?" should use Qdrant.
- "Which contract mentions annual renewal and what is its renewal date?" may use both.

Python should not generate SQL or read Postgres directly in the MVP. Any Postgres-backed evidence passed to Python should be typed business data with record IDs and source references, not raw database access. The current TypeScript route passes recent extracted records as structured evidence for Postgres or hybrid plans.

Current Q&A citations identify source type, document title or source ID, a short snippet, retrieval mode, confidence, and limitations where available. Audit-grade citation navigation is deferred.

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

## AI-Native Automation Gates

Automation is automatic by default, but unsafe writes should be gated by the agent assessment.

- The Python agent returns `agentAssessment` with extraction status, validation status, confidence, review requirement, review reasons, missing fields, uncertain fields, and automation decision.
- TypeScript persists the agent's decision directly: `extracted` records are saved as extracted, `needs_review` records remain reviewable, and processing errors are marked failed.
- Code validates technical shape, enums, and safe storage behavior, but it should not apply fixed business thresholds or cap confidence for unknown document types.
- Failed processing preserves the error, allows retry, and does not sync.

This keeps employees from manually filling fields during the normal workflow while leaving business judgment with the agent and protecting future external systems from records the agent marks reviewable.
