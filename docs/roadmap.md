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

Status: complete as the stabilized local workflow foundation.

Goals:

- refactor Python orchestration into LangGraph ingestion and Q&A graphs
- use LangChain structured output for extraction
- chunk parsed document text
- embed chunks with OpenAI embeddings
- store vectors and metadata in Qdrant through LangChain Qdrant integration
- link Qdrant vectors back to Postgres documents and records with `VectorReference`
- implement semantic retrieval and cited Q&A answers

Done means chat-attached documents become searchable vector memory, and employees can ask text-only chat questions that route to Postgres, Qdrant, or both.

The current implementation keeps Python as the owner of Qdrant writes/retrieval and TypeScript as the owner of Postgres reads/writes. It also includes dependency-aware web health checks, practical Q&A citation display, and route-level tests with mocked Python responses.

This phase is still local MVP work. Auth, OCR, CSV/XLSX extraction, webhook sync, connector ingestion, MCP tooling, tenant isolation, and production deployment are deferred.

## Phase 6: Agentic Supervisor And Tool-Based Automation

Status: complete as the compatibility supervisor layer.

Goals:

- add a Python LangGraph supervisor agent above the existing ingestion and Q&A graphs
- route every chat request through a single supervisor endpoint
- let the supervisor decide whether to process documents, answer questions, do both, ask for clarification, or return unsupported safely
- expose controlled tool-action traces for the UI
- keep TypeScript as the only owner of Postgres reads and writes
- keep Python as the owner of agent reasoning, Qdrant writes/retrieval, and answer generation

Done means the system is no longer only a fixed workflow branch in the web app. The Python supervisor coordinates the existing workflows as tools and returns the final chat reply, automation decision, tool actions, extractions, and Q&A answer when available.

Deferred Phase 6 refinements now move into Phase 7+ stabilization:

- improve retrieval planning quality
- add audit-grade citation navigation and Q&A history views
- expand exact Postgres evidence planning beyond the current recent-record evidence set
- add better empty-memory and unavailable-Qdrant handling
- add integration tests across the web app, Python service, Postgres, and Qdrant

## Phase 7: Autonomous Multi-Agent Document Team

Status: complete as the async agent-run foundation.

Goals:

- add async `AgentRun`, `AgentStep`, and `AgentArtifact` persistence
- start autonomous runs through Python `POST /agent/runs/start`
- add internal TypeScript callback endpoints for progress, completion, and failure
- build a Python LangGraph team with Manager, Intake, Extraction, Validation/Critic, Memory, Q&A, and Response agents
- keep ingestion and Q&A graphs as controlled tools used by the team
- show a pending assistant message immediately and update a live agent activity timeline
- keep TypeScript as the owner of Postgres writes and Python as the owner of agent reasoning and Qdrant access

Done means employees experience a team of agents working asynchronously: the Manager plans, agents do their work, callbacks persist progress, and the UI can poll the run timeline until the final Response Agent reply appears.

Deferred from Phase 7 and completed later in Phase 10:

- MCP tool layer

Still deferred from Phase 7:

- arbitrary external tools
- shell access
- connector sync
- production queues/workers
- auth, tenant isolation, OCR, CSV/XLSX, and webhook sync

## Phase 7.1: Stabilization And Run Reliability

Status: complete.

Goals:

- harden async agent runs so every run ends as `COMPLETED`, `NEEDS_REVIEW`, or `FAILED`
- keep `POST /agent/runs/start` as the primary Python entrypoint
- ensure Python failures call the TypeScript fail callback with safe error text
- prevent late progress callbacks from reopening finished runs
- show full agent activity, final automation decision, limitations, citations, and review reasons without dumping raw payloads
- add safe synthetic fixtures and route-level tests for success, review, clarification, unsupported, and failure paths
- document the current local MVP limitations before Phase 8 webhook sync

Done means the autonomous local MVP is easier to debug and review: chat requests create runs, callbacks persist ordered steps, failures become visible final states, extracted/vector/Q&A artifacts are shown safely, and automated tests cover the public MVP contract.

Deferred from Phase 7.1:

- webhook sync
- auth and tenant isolation
- OCR and CSV/XLSX extraction
- MCP and external connectors
- production queues/workers and deployment hardening

## Phase 8: Webhook Sync

Status: complete.

Goals:

- add generic webhook configuration
- send high-confidence extracted records to a webhook
- block external sync for low-confidence records
- track sync attempts, failures, and retries

Done means Revenue Brains can push trusted extracted data to another system without a vendor-specific integration.

The local MVP uses env-only configuration with `WEBHOOK_URL` and `WEBHOOK_SECRET`. It records `WebhookSyncAttempt` rows for eligible deliveries, skips when the URL is blank, signs outgoing JSON, and does not fail the agent run when delivery fails.

Deferred from Phase 8:

- webhook settings UI
- retry queue and backoff worker
- per-workspace webhook management
- auth-gated webhook administration

## Phase 9: Authentication And Privacy Hardening

Goals:

- add single-company authentication
- harden the private chat attachment handling introduced in earlier phases
- verify raw document content is still excluded from logs
- expand audit metadata
- protect dashboard routes

Done means the MVP has route-level protection and stronger privacy controls for real internal testing. Basic private file handling, source references, and raw-content logging restrictions must already be enforced during chat ingestion and processing phases.

## Phase 10: MCP Agent Tool Server

Status: complete. Revenue Brains is now Local MVP Done, not production-ready.

Goals:

- add an MCP server that exposes controlled tools to the Python agent and local MCP clients
- implement the MCP server as a TypeScript/Node service
- configure the Python agent service as an MCP client
- expose read-only tools for document metadata, extracted records, processing jobs, and approved reference data
- load the MCP tool list inside the Python autonomous team
- let the MCP Tool Agent choose relevant exact-record tools from run intent, attachments, question text, and run context
- log each MCP tool call as an `AgentStep` with safe arguments, status, and output summary
- pass successful MCP tool results to Q&A and Response agents as verified evidence
- route exact-record MCP tools through TypeScript-owned Postgres APIs or shared TypeScript data-access code
- keep semantic retrieval and answer generation inside the Python agent/Q&A flow
- enforce workspace scoping, authorization, and audit logging

Done means the Python agent and local external MCP clients can use safe Revenue Brains tools without receiving raw database credentials or bypassing the app's Postgres, Qdrant, confidence, or audit boundaries. After this phase, the core local MVP is complete; future work should be bug fixes, polish, production hardening, or optional integrations.

## Future Integrations

Add only after the core loop works:

- arbitrary write-capable MCP tools
- production external MCP client access with full user auth
- email ingestion
- Google Drive ingestion
- CRM sync
- ERP sync
- accounting sync
- admin-defined schemas
- richer analytics dashboards
- multi-company SaaS tenancy
- production compliance controls
