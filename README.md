# Revenue Brains

Revenue Brains is an AI-native document automation and company brain platform. Employees send chat messages with company documents attached, add natural-language instructions, and the system classifies, extracts, validates, saves exact records into Postgres, stores searchable memory in Qdrant, and powers reliable business Q&A.

The first goal is not to build every integration at once. The project moves step by step through scaffold, chat ingestion, extraction, RAG, and dashboard/status milestones without pulling later behavior into earlier phases.

## Product Positioning

Revenue Brains turns messy company documents into two useful assets:

- **Structured business data:** exact fields and records saved in Postgres for reliable filtering, reporting, and workflow automation.
- **Searchable company memory:** document chunks, extracted facts, summaries, and embeddings saved in Qdrant for retrieval-augmented generation.

This makes the product more than a passive chat-with-documents tool. The chat is the command surface, while the product is still an automation system that reduces manual data entry and gives employees a RAG-powered company knowledge assistant.

## MVP Document Scope

The first implementation starts with files attached directly inside the agent chat. Email, Drive, CRM, ERP, accounting integrations, and a separate dashboard upload button should wait until the chat ingestion pipeline works end to end.

The MVP document categories are:

- invoices
- contracts and order forms
- purchase orders
- receipts and expenses
- general company knowledge documents
- unknown documents

Every chat-attached document should receive common metadata: title, detected type, original filename, important dates, entities, summary, key facts, tags, confidence, source references, and the user instructions that guided processing. Known revenue and finance documents should also receive type-specific fields such as invoice number, vendor, customer, purchase order number, amount, currency, due date, contract value, renewal date, and payment terms where applicable.

The initial file formats are text-based PDFs, DOCX, plain text, and Markdown. OCR for scanned documents or images, CSV/XLSX extraction, and connector imports should wait until the text-based chat attachment pipeline works.

## MVP Workflow

1. An employee sends a chat message with one or more documents attached and optional instructions.
2. The TypeScript app stores the chat message, original files, document metadata, and processing jobs.
3. The TypeScript app creates an async `AgentRun`, a pending assistant message, and calls the Python autonomous team with storage keys, attachment metadata, recent Postgres evidence, callback details, and user instructions.
4. The Manager Agent plans the run and delegates work to the Intake, Extraction, Validation/Critic, Memory, Q&A, and Response agents.
5. Python emits progress events back to TypeScript callback endpoints, and TypeScript persists each step for the activity timeline.
6. When document processing is needed, the ingestion graph parses the documents, classifies each document type, extracts structured fields, validates evidence, and stores vector memory in Qdrant.
7. The Validation/Critic Agent decides whether the output is safe to save automatically or needs review.
8. The TypeScript app saves exact structured records, Qdrant vector references, run artifacts, processing status, and the final assistant reply into Postgres.
9. Employees can continue asking questions in the same chat, and the multi-agent team can use Postgres evidence, Qdrant memory, or both.

Low-confidence results are still saved internally for visibility and review, but external sync is blocked until the result is trusted.

## Source Documents And Audit Trail

Chat-attached files are private source artifacts, not generated repo assets. When the application is scaffolded, original documents should live in an app-managed upload volume or ignored local upload directory outside Git. Later deployments can map the same storage-key contract to object-storage-compatible storage. Postgres should store the conversation/message record, document record, storage key, checksum, original filename, content type, attachment metadata, processing status, user instructions, and audit fields.

Extracted fields, chunks, facts, and Q&A citations must reference the source document. Source references should preserve enough location data to audit an answer or extraction later, such as page number, text span, bounding box when available, chunk ID, and related Postgres record ID. Qdrant should store semantic chunks and metadata, but it should not become the only place where source identity, exact records, or audit state live.

For the MVP, TypeScript should hand Python a storage key rather than raw file bytes. Local development should resolve that key against an ignored private upload path shared by the local web and agent processes; later deployments can map the same contract to object storage.

## Service Boundary

Revenue Brains is planned as a monorepo with a clear TypeScript/Python split:

- **TypeScript / Next.js app:** owns agent chat UI, chat message and attachment APIs, file storage handoff, dashboard/status views, auth, workspace behavior, Postgres writes through Prisma, processing job status, webhook sync, and user-facing Q&A routes.
- **Python / FastAPI agent service:** owns autonomous multi-agent planning, delegation, retry/critique loops, parsing, classification, extraction, AI-native validation/confidence assessment, embeddings, Qdrant ingestion, retrieval planning, answer generation, and final response composition from verified outputs.

The boundary should be documented HTTP APIs, not duplicated logic. The TypeScript app should send processing requests containing conversation ID, message ID, document ID, workspace ID, file storage key, checksum, filename, content type, user instructions, and processing options. The Python service should return typed extraction results, agent assessment decisions, validation details, confidence scores, source references, Qdrant vector IDs, chat reply content, and structured errors.

Postgres reads and writes should be owned by the TypeScript app through Prisma. Python should not connect directly to Postgres in the MVP; for Q&A it should receive structured Postgres evidence from TypeScript or return a typed retrieval plan for TypeScript to execute. Qdrant reads and writes should be owned by the Python agent service, with vector references returned to the TypeScript app so they can be linked back to Postgres records and jobs.

## AI-Native Confidence And Review

Confidence should be operational, not just decorative. The ingestion agent decides document confidence, field confidence, validation status, review requirements, and automation safety in an `agentAssessment` payload. Code validates the response shape and safe storage contract, but it does not cap confidence or apply business thresholds such as forcing unknown documents into review.

Field-level confidence should be stored alongside document-level confidence. When the agent flags review reasons, missing fields, or uncertain fields, those reasons should remain visible in the chat/status workspace and should block future external sync until the record is trusted.

## Hybrid Q&A Rules

The Q&A path should choose the data source based on the question:

- Exact record questions, such as invoice totals, due dates, vendors, renewal dates, processing status, or sync status, should use Postgres.
- Semantic questions, such as policy meaning, contract clause interpretation, or general document context, should use Qdrant retrieval.
- Mixed questions should use both Postgres records and Qdrant evidence.

The TypeScript app should perform Postgres reads for exact records. The Python service should perform Qdrant retrieval and final answer generation from typed evidence.

Answers should include citations whenever they rely on document content. If the system cannot find enough evidence, it should say so rather than inventing an answer.

## Webhook Sync Scope

Generic webhook sync is part of the MVP direction, but it should come after the core chat ingestion, extraction, storage, and Q&A loop works. When added, webhook sync should send trusted structured records with document metadata, source references, confidence, and validation status.

The TypeScript app should own webhook configuration, delivery attempts, retry state, failure messages, and dashboard visibility. Low-confidence, medium-confidence, incomplete, or failed results must not be sent externally.

## Planned Tech Stack

- **Dashboard and product backend:** Next.js, React, TypeScript
- **Agent and RAG service:** Python, FastAPI, uv
- **Agent framework:** LangGraph for the autonomous multi-agent team and controlled ingestion/Q&A graphs; LangChain for structured model calls, embeddings, and Qdrant integration
- **Future agent tool layer:** TypeScript/Node MCP server for controlled agent tools after the core MVP is working
- **Structured database:** Postgres
- **Vector database:** Qdrant
- **Database access:** Prisma for the TypeScript app
- **AI provider:** OpenAI API
- **Local development:** DB-only Docker Compose for Postgres and Qdrant; web and agent run locally with npm and uv
- **Testing:** TypeScript tests for app logic and Python tests for agent logic

## Architecture Overview

```txt
Employee chat message + document attachments
      |
      v
Next.js chat workspace, dashboard views, and API
      |-- Prisma records, jobs, vector refs --> Postgres
      |
      |-- HTTP processing, retrieval planning, answers --> Python FastAPI agent service
                                                               |
                                                               |-- classify, extract, validate, embed, retrieve --> Qdrant
```

Postgres and Qdrant have different jobs. Postgres is the source of truth for exact extracted records. Qdrant is the semantic retrieval layer for RAG.

## Repository Status

This repository currently contains the local Phase 7 autonomous multi-agent milestone on top of the stabilized Phase 5 LangGraph/RAG foundation and Phase 6 supervisor layer. It includes a Next.js chat workspace, Prisma schema and migrations for conversations/messages/documents/jobs/agent runs/agent steps/agent artifacts, generic extracted records/fields/source references, Qdrant vector references, multipart chat intake APIs, private local attachment storage, dependency-aware health checks, and a Python FastAPI agent service.

The Python service now uses LangGraph for an autonomous document team plus lower-level ingestion and Q&A workflows, LangChain for structured extraction and OpenAI embeddings, and Qdrant for vector memory. Chat-attached TXT/MD/text-based PDF/DOCX files are parsed, extracted, assessed by agents, chunked, embedded, stored in Qdrant, linked back into Postgres, and displayed in the workspace. Chat messages create async agent runs, the Python team emits callback events, and the UI shows a multi-agent activity timeline while the run completes.

This is still a local MVP prototype, not production software. It does not yet contain auth, webhook sync, MCP tooling, connector imports, OCR, CSV/XLSX extraction, production deployment workflows, or tenant isolation.

Planned top-level structure:

```txt
apps/
  web/              Next.js chat workspace, dashboard/status views, API routes, and TypeScript app tests
services/
  agent/            Python FastAPI service, agent modules, and Python tests
  mcp-server/       future TypeScript/Node MCP server exposing controlled tools to the Python agent
packages/
  shared/           optional shared API schemas and generated types
tests/
  integration/      cross-service tests and safe synthetic fixtures
assets/             static assets, prompts, examples, and safe sample documents
config/             checked-in, non-secret configuration templates
docs/               product, architecture, agent, roadmap, and setup documentation
  api/              future HTTP API contracts between TypeScript and Python
```

Generated outputs, caches, secrets, and private company documents must stay out of the repository.

## Local Infrastructure

Copy the environment template and create the ignored upload directory:

```powershell
Copy-Item .env.example .env
New-Item -ItemType Directory -Force uploads
```

Start only Postgres and Qdrant with Docker Compose:

```bash
docker compose up -d postgres qdrant
```

Default local endpoints:

- Web app: `http://localhost:3000`
- Web health: `http://localhost:3000/api/health` with Postgres, agent, Qdrant, and collection checks
- Python agent service: `http://localhost:8000`
- Python agent health: `http://localhost:8000/health`
- Postgres: `localhost:5432`
- Qdrant HTTP: `http://localhost:6333`
- Qdrant gRPC: `localhost:6334`
- Private local uploads: `./uploads`

Stop the infrastructure with:

```bash
docker compose down
```

Use `docker compose down -v` only when you intentionally want to delete local Postgres and Qdrant data volumes.

## Development Commands

Install and run the web app from the repository root:

```bash
npm ci
npm run dev
```

Verify the web app:

```bash
npm run db:generate
npm run db:migrate
npm test
npm run lint
npm run build
```

Prisma commands from the repository root:

```bash
npm run db:generate
npm run db:migrate
npm run db:studio
```

Run the Python agent service from `services/agent`:

```bash
python -m uv sync
python -m uv run uvicorn app.main:app --reload --reload-exclude .venv --port 8000
```

Live extraction and RAG require `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL`, `QDRANT_URL`, and `QDRANT_COLLECTION` from `.env`. If a key was exposed in terminal/chat output, rotate it in the OpenAI dashboard and replace the local `.env` value. Automated Python tests use deterministic mocked model/vector behavior and do not call OpenAI or Qdrant. Web tests mock Python agent calls and validate the chat/Q&A persistence boundary without using private documents.

Async autonomous runs also require `AGENT_CALLBACK_BASE_URL` and `AGENT_CALLBACK_SECRET` in local `.env` so Python can send progress, completion, and failure callbacks to the TypeScript app. The default local callback base URL is `http://localhost:3000`.

Verify the Python agent service from `services/agent`:

```bash
python -m uv run pytest
python -m uv run ruff check
python -m uv run ruff format --check
```

Web and agent Docker Compose services are intentionally deferred to later full orchestration work. Phase 2 Compose runs Postgres and Qdrant only.

Do not commit real API keys, database credentials, customer documents, or private company data.

## Documentation

Recommended reading order:

- [Product spec](docs/product-spec.md): authoritative scope, users, document categories, workflows, and success criteria.
- [Architecture](docs/architecture.md): authoritative system responsibilities, storage roles, and Q&A routing.
- [Agent design](docs/agent-design.md): Python ingestion and Q&A agent inputs, outputs, validation, and guardrails.
- [API contracts](docs/api/README.md): planned HTTP boundary between TypeScript and Python.
- [MCP strategy](docs/mcp-strategy.md): future agent tool server boundaries and safe MCP surface.
- [Roadmap](docs/roadmap.md): milestone order and what should wait.
- [Scaffold plan](docs/scaffold-plan.md): Phase 2 target structure, services, ports, commands, and done checklist.
- [Development setup](docs/development-setup.md): planned local services, environment variables, and future commands.
