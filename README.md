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
3. The TypeScript app calls the Python agent service over HTTP with document IDs, file storage keys, conversation/message IDs, and user instructions.
4. The Python agent service parses the documents.
5. The agent classifies each document type.
6. The agent extracts common metadata and type-specific fields, guided by the employee's instructions.
7. The agent validates the extraction, assigns confidence, and returns source references.
8. The TypeScript app saves exact structured records into Postgres.
9. The Python service embeds document chunks and extracted facts into Qdrant.
10. The TypeScript app stores Qdrant vector references and processing status in Postgres.
11. The agent replies in chat with status, summary, confidence, and links to records/job details.
12. Employees can continue asking questions in the same chat using a hybrid Q&A agent.

Low-confidence results are still saved internally for visibility and review, but external sync is blocked until the result is trusted.

## Source Documents And Audit Trail

Chat-attached files are private source artifacts, not generated repo assets. When the application is scaffolded, original documents should live in an app-managed upload volume or ignored local upload directory outside Git. Later deployments can map the same storage-key contract to object-storage-compatible storage. Postgres should store the conversation/message record, document record, storage key, checksum, original filename, content type, attachment metadata, processing status, user instructions, and audit fields.

Extracted fields, chunks, facts, and Q&A citations must reference the source document. Source references should preserve enough location data to audit an answer or extraction later, such as page number, text span, bounding box when available, chunk ID, and related Postgres record ID. Qdrant should store semantic chunks and metadata, but it should not become the only place where source identity, exact records, or audit state live.

For the MVP, TypeScript should hand Python a storage key rather than raw file bytes. Local development should resolve that key against an ignored private upload path shared by the local web and agent processes; later deployments can map the same contract to object storage.

## Service Boundary

Revenue Brains is planned as a monorepo with a clear TypeScript/Python split:

- **TypeScript / Next.js app:** owns agent chat UI, chat message and attachment APIs, file storage handoff, dashboard/status views, auth, workspace behavior, Postgres writes through Prisma, processing job status, webhook sync, and user-facing Q&A routes.
- **Python / FastAPI agent service:** owns parsing, classification, extraction, AI-native validation/confidence assessment, embeddings, Qdrant ingestion, retrieval planning, and answer generation.

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
- **Agent framework:** LangGraph for controlled agent workflows, LangChain for structured model calls, embeddings, and Qdrant integration
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

This repository currently contains the LangGraph agent and RAG milestone. It includes a Next.js chat workspace, Prisma schema and migrations for conversations/messages/documents/jobs, generic extracted records/fields/source references, Qdrant vector references, multipart chat intake APIs, private local attachment storage, and a Python FastAPI agent service.

The Python service now uses LangGraph for ingestion and Q&A workflows, LangChain for structured extraction and OpenAI embeddings, and Qdrant for vector memory. Chat-attached TXT/MD/text-based PDF/DOCX files are parsed, extracted, assessed by the agent, chunked, embedded, stored in Qdrant, linked back into Postgres, and displayed in the workspace. Text-only chat questions route through a Q&A planner that can use Postgres evidence, Qdrant retrieval, or both.

It does not yet contain auth, webhook sync, MCP tooling, connector imports, OCR, CSV/XLSX extraction, or production workflows.

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
- Web health: `http://localhost:3000/api/health`
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

Live extraction and RAG require `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL`, `QDRANT_URL`, and `QDRANT_COLLECTION` from `.env`. If a key was exposed in terminal/chat output, rotate it in the OpenAI dashboard and replace the local `.env` value. Automated Python tests use deterministic mocked model/vector behavior and do not call OpenAI or Qdrant.

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
