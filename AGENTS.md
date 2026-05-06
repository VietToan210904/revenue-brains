# Repository Guidelines

## Project Structure & Module Organization

This repository is the home for Revenue Brains, an AI-native document automation and company brain platform. It currently contains the Phase 3 chat ingestion pipeline.

Keep contributor-facing documentation at the repository root. Use a monorepo layout that keeps the TypeScript product app and Python agent service separate:

- `apps/web/` for the Next.js chat workspace, dashboard/status views, APIs, Prisma schema, and TypeScript app tests.
- `services/agent/` for the Python FastAPI service, accepted/placeholder intelligence-service routes, and Python agent tests.
- `services/mcp-server/` for a future TypeScript/Node MCP server that exposes controlled tools to the Python agent. Do not add this in Phase 2.
- `packages/shared/` for optional shared API schemas or generated types.
- `docs/api/` for future HTTP API contracts between the TypeScript app and Python service.
- `tests/integration/` for cross-service tests and safe synthetic fixtures.
- `assets/` for static files, prompts, examples, or safe sample documents.
- `config/` for checked-in, non-secret configuration templates.
- `docs/` for product, architecture, agent, roadmap, and setup documentation.

Keep generated outputs, local caches, uploaded files, and credentials out of the repository. Track `services/agent/uv.lock` because the Python agent is a uv project.

## Product Intent

Revenue Brains should help employees turn company documents into structured, actionable data and searchable company knowledge.

The core workflow is:

1. Send a chat message with company documents attached and optional instructions.
2. Classify the document type.
3. Extract common and type-specific fields.
4. Validate the result and assign confidence.
5. Save exact structured data to Postgres.
6. Ingest chunks and extracted facts into Qdrant.
7. Reply in chat with status, summary, confidence, and citations where possible.

This is an AI-native automation system, not only a RAG chat app. RAG is one major capability, but structured data automation is also central.

## TypeScript and Python Responsibilities

Use TypeScript for the product surface:

- Next.js chat workspace, dashboard/status views, and user interface.
- Chat message, attachment, and dashboard APIs.
- Authentication and workspace behavior.
- Postgres persistence through Prisma.
- Webhook sync and operational status views.
- UI tests and app-level tests.

Use Python for the intelligence layer:

- Document parsing and text preparation.
- Classification.
- Information extraction.
- Validation and confidence scoring.
- Embeddings and Qdrant ingestion.
- RAG retrieval and answer orchestration.
- Agent-specific tests and fixtures.

Keep the boundary explicit. TypeScript should call the Python agent service through documented HTTP APIs rather than duplicating agent logic in the web app. TypeScript owns Postgres reads and writes through Prisma; Python should not connect directly to Postgres in the MVP. When the service is scaffolded, keep request and response contracts in `docs/api/` or generated shared schemas under `packages/shared/`.

MCP is a future agent tool layer, not the MVP service boundary. If MCP is added later, the Python agent should act as an MCP client and call controlled tools exposed by a TypeScript/Node `services/mcp-server/`. Exact-record tools should call TypeScript-owned APIs or shared TypeScript data-access code. MCP should not hand raw database credentials to the Python agent or bypass auth, workspace scoping, Postgres ownership, Qdrant ownership, confidence gates, or audit logging.

## Postgres and Qdrant Rules

Postgres and Qdrant must not be treated as interchangeable.

- Postgres is the source of truth for exact business records, document metadata, processing jobs, extracted fields, validation results, users, and sync attempts.
- Qdrant is the vector memory for semantic retrieval over document chunks, extracted facts, summaries, and source metadata.
- Exact questions such as invoice totals, dates, vendors, renewal dates, and record status should use Postgres.
- Semantic questions such as policy meaning, contract clauses, and general document context should use Qdrant retrieval.
- Hybrid Q&A may use both Postgres and Qdrant in one answer.

Do not design the MVP as Qdrant-only when exact records or reporting are required.

## Document Automation Rules

Start with documents attached directly inside the agent chat. Do not add a separate dashboard upload button, email, Drive, CRM, ERP, or accounting connectors until the chat ingestion pipeline works.

The first file formats are text-based PDFs, DOCX, plain text, and Markdown. Defer scanned image OCR, PNG/JPEG uploads, CSV/XLSX extraction, and connector imports until the text-based chat attachment pipeline works.

The MVP document scope is:

- invoices
- contracts and order forms
- purchase orders
- receipts and expenses
- general company knowledge documents
- unknown documents

All chat-attached documents should receive common metadata such as title, type, dates, entities, summary, key facts, tags, confidence, source references, and the user instructions that guided processing. Known revenue and finance documents should also receive type-specific fields.

Unknown documents are in scope as safe fallbacks. They should receive common metadata, summary, key facts, tags, source references, and confidence, but they should not force type-specific revenue or finance extraction unless reclassified into a supported type.

For MVP processing, TypeScript stores the chat message and file attachment, then sends Python a file storage key rather than raw file bytes. Local development uses an ignored private upload path. DB-only Docker Compose does not mount this path into web or agent containers because those containers are deferred.

Automation should be automatic by default, with validation gates:

- High-confidence results can be saved and, once the generic webhook milestone exists, synced.
- Low-confidence results should be saved internally but blocked from external sync.
- The system should preserve enough error and confidence information for later review and retry.

## Build, Test, and Development Commands

Docker Compose is configured only for local Postgres and Qdrant infrastructure:

- `docker compose up -d postgres qdrant`: start local infrastructure services.
- `docker compose down`: stop local infrastructure services while preserving named data volumes.

Web app commands from the repository root:

- `npm ci`: install locked web dependencies.
- `npm run dev`: start the local Next.js development server.
- `npm run db:generate`: generate the Prisma client.
- `npm run db:migrate`: apply local Prisma migrations.
- `npm run db:studio`: inspect local Prisma data.
- `npm test`: run the current web verification script.
- `npm run lint`: run formatting and static checks.
- `npm run build`: create a production build or distributable artifact.

Python agent commands from `services/agent/`:

- `uv sync`: install Python agent dependencies.
- `uv run uvicorn app.main:app --reload --port 8000`: start the FastAPI service locally.
- `uv run pytest`: run Python agent tests.
- `uv run ruff check`: run Python linting.
- `uv run ruff format --check`: check Python formatting.

Use the project’s configured scripts rather than ad hoc commands when available.

## Coding Style & Naming Conventions

Follow the style enforced by the chosen formatter or linter once one is introduced. Until then, prefer small modules, clear names, and consistent indentation within each file. Use `camelCase` for JavaScript/TypeScript variables and functions, `PascalCase` for classes and React components, and `kebab-case` for file and directory names unless a framework requires otherwise.

Prefer explicit schemas and typed interfaces for extracted data, API payloads, and persistence boundaries. Avoid loose JSON blobs for records that need exact querying unless the blob is paired with normalized fields.

## Testing Guidelines

Add tests alongside any substantive behavior. Keep TypeScript tests near `apps/web/` app code, Python tests near `services/agent/` agent code, and cross-service tests under `tests/integration/`. Test names should describe behavior, not implementation details. Include fixtures for document-processing flows under `tests/integration/fixtures/` or service-specific fixture directories, and avoid committing sensitive or customer data.

Expected future coverage:

- TypeScript tests for chat message/attachment APIs, persistence, webhook sync, and dashboard/status behavior.
- Python tests for classification, extraction validation, confidence scoring, embeddings, and RAG answering.
- Integration tests for chat attachment to processing to Postgres save to Qdrant ingestion.
- Failure tests for unsupported documents, malformed extraction, low confidence, Qdrant failure, and webhook failure.

## Commit & Pull Request Guidelines

The current Git history only contains `Initial commit`, so no detailed convention is established. Use concise, imperative commit messages such as `Add document routing tests` or `Refine extraction schema`. Pull requests should include a short summary, testing performed, linked issues when relevant, and screenshots or sample outputs for user-facing changes.

## Security & Configuration Tips

Never commit API keys, database credentials, private documents, or customer data. Store local secrets in ignored environment files such as `.env.local`, and commit only templates such as `.env.example` with placeholder values.

For document-processing features:

- Avoid logging raw document content.
- Use safe synthetic fixtures in tests.
- Treat chat-attached documents as private by default.
- Keep source references and audit metadata for extracted fields.
- Do not add real company documents to `assets/`, `tests/integration/fixtures/`, service-specific fixture directories, or any committed path.

## What Not To Build Yet

Until the end-to-end MVP pipeline is working, avoid:

- multi-tenant SaaS billing
- advanced role-based permissions
- email, Google Drive, CRM, ERP, or accounting integrations
- MCP write tools or broad external tool access before auth and audit logging are ready
- production compliance workflows
- complex admin schema builders
- large analytics dashboards
- vendor-specific external sync

Prefer small, verifiable milestones that keep the product direction clear.
