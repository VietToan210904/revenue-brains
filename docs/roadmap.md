# Roadmap

## Summary

Revenue Brains should be built in focused milestones. The goal is to avoid building every feature at once while still keeping the final architecture clear.

## Phase 1: Documentation Foundation

Status: complete.

Goals:

- clarify product identity
- document the architecture
- define agent responsibilities
- define initial document type field contracts, file handoff, and job states
- define the step-by-step roadmap
- document planned local setup
- align README, AGENTS, and product spec

No application code is created in this phase.

## Phase 2: Project Scaffold

Goals:

- create the Next.js TypeScript app
- create the Python FastAPI service
- add initial HTTP API contract docs under `docs/api/` or shared schemas under `packages/shared/`
- add DB-only Docker Compose for local Postgres and Qdrant
- add Postgres and Qdrant local configuration
- add local private attachment/upload storage or an object-storage-compatible development service
- update environment templates
- add baseline lint, test, and build commands

Done means the web app and Python service can start locally with npm and uv, Postgres and Qdrant are configured through DB-only Compose, and health checks pass.

Deferred from Phase 2:

- Prisma schema and migrations
- web and agent Docker Compose services
- chat ingestion, upload handling, extraction, Qdrant ingestion, RAG, auth, webhook sync, MCP, and connector behavior

## Phase 3: Chat Ingestion Pipeline

Status: complete.

Goals:

- implement the agent chat interface with file attachments and instruction text
- store original chat attachments outside Git
- store conversation, message, document metadata, storage keys, checksums, user instructions, and attachment audit fields in Postgres
- create processing jobs
- enforce private attachment handling and avoid raw document content in logs
- show agent replies, document list, and job status
- send processing requests from TypeScript to Python with conversation/message IDs and user instructions

Done means an employee can attach a supported text-based file to a chat message, include instructions, and see an agent reply plus a tracked processing job.

The Phase 3 implementation used a Python accepted stub for `/documents/process`. It proved chat attachments, private upload storage, document/job rows, and the web-to-Python storage-key handoff.

## Phase 4: Classification And Extraction

Status: complete.

Goals:

- parse text from chat-attached files
- classify document type
- extract common fields
- extract type-specific fields for revenue and finance documents
- enforce required field contracts per document type
- let the agent assess validation, confidence, review status, and automation safety
- preserve source references for important extracted values
- save structured results into Postgres

Done means chat-attached sample documents produce visible extracted records with confidence scores and agent chat replies.

The Phase 4 implementation parses TXT, Markdown, text-based PDF, and DOCX files; classifies documents; extracts structured fields; returns agent-owned validation/confidence assessment, review reasons, and source references; persists `ExtractedRecord`, `ExtractedField`, and `SourceReference` rows through Prisma; and updates chat/status UI with extraction status.

## Phase 5: LangGraph Qdrant Ingestion And RAG

Status: current implementation.

Goals:

- refactor Python orchestration into LangGraph ingestion and Q&A graphs
- use LangChain structured output for extraction
- chunk parsed document text
- embed chunks with OpenAI embeddings
- store vectors and metadata in Qdrant through LangChain Qdrant integration
- link Qdrant vectors back to Postgres documents and records with `VectorReference`
- implement semantic retrieval and cited Q&A answers

Done means chat-attached documents become searchable vector memory, and employees can ask text-only chat questions that route to Postgres, Qdrant, or both.

The current implementation keeps Python as the owner of Qdrant writes/retrieval and TypeScript as the owner of Postgres reads/writes.

## Phase 6: Hybrid Q&A

Status: initial implementation included in Phase 5; future refinements remain.

Goals:

- improve retrieval planning quality
- add richer citation display and Q&A history views
- expand exact Postgres evidence planning beyond the current recent-record evidence set
- add better empty-memory and unavailable-Qdrant handling
- add integration tests across the web app, Python service, Postgres, and Qdrant

Done means employees can reliably ask questions in chat and receive answers backed by structured records or document citations across larger workspaces.

## Phase 7: Webhook Sync

Goals:

- add generic webhook configuration
- send high-confidence extracted records to a webhook
- block external sync for low-confidence records
- track sync attempts, failures, and retries

Done means Revenue Brains can push trusted extracted data to another system without a vendor-specific integration.

## Phase 8: Authentication And Privacy Hardening

Goals:

- add single-company authentication
- harden the private chat attachment handling introduced in earlier phases
- verify raw document content is still excluded from logs
- expand audit metadata
- protect dashboard routes

Done means the MVP has route-level protection and stronger privacy controls for real internal testing. Basic private file handling, source references, and raw-content logging restrictions must already be enforced during chat ingestion and processing phases.

## Phase 9: MCP Agent Tool Server

Goals:

- add an MCP server that exposes controlled tools to the Python agent
- implement the MCP server as a TypeScript/Node service
- configure the Python agent service as an MCP client
- expose read-only tools for document metadata, extracted records, processing jobs, and approved reference data
- route exact-record MCP tools through TypeScript-owned Postgres APIs or shared TypeScript data-access code
- keep semantic retrieval and answer generation inside the Python agent/Q&A flow
- enforce workspace scoping, authorization, and audit logging

Done means the Python agent can use safe MCP tools without receiving raw database credentials or bypassing the app's Postgres, Qdrant, auth, or audit boundaries.

## Future Integrations

Add only after the core loop works:

- write-capable MCP tools
- exposing MCP tools to external AI clients
- email ingestion
- Google Drive ingestion
- CRM sync
- ERP sync
- accounting sync
- admin-defined schemas
- richer analytics dashboards
- multi-company SaaS tenancy
- production compliance controls
