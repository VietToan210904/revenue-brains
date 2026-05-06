# Roadmap

## Summary

Revenue Brains should be built in focused milestones. The goal is to avoid building every feature at once while still keeping the final architecture clear.

## Phase 1: Documentation Foundation

Status: current milestone.

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
- add Docker Compose for local services
- add Postgres and Qdrant local configuration
- add local private attachment/upload storage or an object-storage-compatible development service
- add Prisma
- update environment templates
- add baseline lint, test, and build commands

Done means the app and Python service can start locally and health checks pass.

## Phase 3: Chat Ingestion Pipeline

Goals:

- implement the agent chat interface with file attachments and instruction text
- store original chat attachments outside Git
- store conversation, message, document metadata, storage keys, checksums, user instructions, and attachment audit fields in Postgres
- create processing jobs
- enforce private attachment handling and avoid raw document content in logs
- show agent replies, document list, and job status
- send processing requests from TypeScript to Python with conversation/message IDs and user instructions

Done means an employee can attach a supported text-based file to a chat message, include instructions, and see an agent reply plus a tracked processing job.

## Phase 4: Classification And Extraction

Goals:

- parse text from chat-attached files
- classify document type
- extract common fields
- extract type-specific fields for revenue and finance documents
- enforce required field contracts per document type
- validate fields and confidence
- preserve source references for important extracted values
- save structured results into Postgres

Done means chat-attached sample documents produce visible extracted records with confidence scores and agent chat replies.

## Phase 5: Qdrant Ingestion And RAG

Goals:

- chunk document text
- embed chunks and extracted facts
- store vectors and metadata in Qdrant
- link Qdrant vectors back to Postgres documents and records
- implement basic semantic retrieval

Done means chat-attached documents become searchable vector memory.

## Phase 6: Hybrid Q&A

Goals:

- support chat-only questions without attachments
- route exact questions to TypeScript-owned Postgres reads when appropriate
- route semantic questions to Python-owned Qdrant retrieval when appropriate
- combine evidence into cited answers
- show source references in chat and dashboard/status views

Done means employees can ask questions in chat and receive answers backed by structured records or document citations.

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
