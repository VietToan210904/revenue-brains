# Development Setup

## Summary

Revenue Brains currently has the Phase 3 chat ingestion pipeline:

- Next.js chat workspace in `apps/web`.
- Prisma schema and migration for Postgres-backed chat intake records.
- Multipart chat intake APIs for messages, attachments, documents, and jobs.
- Python FastAPI agent service in `services/agent`.
- Python `POST /documents/process` accepted stub for Phase 3 handoff.
- DB-only Docker Compose infrastructure for local Postgres and Qdrant.
- Ignored private local upload storage at `./uploads`.

Phase 2 Docker Compose intentionally runs only Postgres and Qdrant. The web and agent services run locally with `npm` and `uv`. Web/agent Compose services are deferred to later full orchestration work.

The current implementation proves chat ingestion and agent handoff only. Extraction, Qdrant ingestion, RAG answering, auth, webhook sync, and MCP tooling are not implemented yet.

## Required Tooling

- Node.js `>=20.18.0`
- npm
- Python `>=3.11`
- uv
- Docker Desktop or compatible Docker Compose runtime

## Environment Variables

Template variables currently listed in `.env.example`:

```txt
APP_ENV=development
PYTHON_AGENT_URL=http://localhost:8000
OPENAI_API_KEY=
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=revenue_brains
POSTGRES_USER=revenue_brains
POSTGRES_PASSWORD=change-me-local-only
DATABASE_URL=postgresql://revenue_brains:change-me-local-only@localhost:5432/revenue_brains
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
QDRANT_HTTP_PORT=6333
QDRANT_GRPC_PORT=6334
UPLOAD_STORAGE_PATH=./uploads
WEBHOOK_URL=
WEBHOOK_SECRET=
```

Real values should live in ignored local environment files such as `.env` or `.env.local`. Docker Compose reads `.env` automatically when present. Only placeholder templates should be committed.

## First-Time Setup

Create local environment and upload storage files:

```powershell
Copy-Item .env.example .env
New-Item -ItemType Directory -Force uploads
```

Install web dependencies from the repository root:

```bash
npm ci
```

Generate the Prisma client and apply the local migration after Postgres is running:

```bash
npm run db:generate
npm run db:migrate
```

Install Python agent dependencies from `services/agent`:

```bash
uv sync
```

`services/agent/uv.lock` is tracked and should be updated when agent dependencies change.

## Running Services

Start the web app from the repository root:

```bash
npm run dev
```

Start the Python agent service from `services/agent`:

```bash
uv run uvicorn app.main:app --reload --port 8000
```

Start local data services from the repository root:

```bash
docker compose up -d postgres qdrant
```

Current local endpoints:

- Web app: `http://localhost:3000`
- Web health: `http://localhost:3000/api/health`
- Python agent service: `http://localhost:8000`
- Python agent health: `http://localhost:8000/health`
- Postgres: `localhost:5432`
- Qdrant HTTP: `http://localhost:6333`
- Qdrant gRPC: `localhost:6334`
- Local uploads: `./uploads`

## Verification

Web checks from the repository root:

```bash
npm run db:generate
npm test
npm run lint
npm run build
```

Python checks from `services/agent`:

```bash
uv run pytest
uv run ruff check
uv run ruff format --check
```

Infrastructure checks from the repository root:

```bash
docker compose config
docker compose ps
```

Stop infrastructure while preserving named volumes:

```bash
docker compose down
```

Remove local database volumes only when intentionally wiping local data:

```bash
docker compose down -v
```

## Docker Compose Scope

The current `docker-compose.yml` defines only:

- `postgres`
- `qdrant`

It remains DB-only in Phase 3. Do not add `web` or `agent` Compose services until a later full local orchestration milestone.

`UPLOAD_STORAGE_PATH=./uploads` establishes the local private storage path. The web app writes attachments there and sends storage keys to the local Python process.

## Current Implementation Status

Implemented:

- Next.js App Router chat workspace.
- Web health endpoint at `GET /api/health`.
- Chat message endpoint at `POST /api/chat/messages`.
- Conversation read endpoint at `GET /api/chat/:conversationId`.
- Processing job read endpoint at `GET /api/jobs/:jobId`.
- Prisma schema and migration for workspace, conversation, message, document, and processing job records.
- FastAPI app scaffold.
- Agent health endpoint at `GET /health`.
- Accepted-stub document handoff endpoint at `POST /documents/process`.
- Placeholder Q&A contracts.
- Python tests for the agent health, accepted document handoff, and placeholder Q&A routes.
- Local Postgres and Qdrant Compose infrastructure.
- Environment template aligned with local ports.

Not implemented yet:

- Actual document parsing, classification, extraction, validation, embeddings, Qdrant ingestion, or answer generation.
- Web/agent Compose containers.
- Auth, webhook sync, MCP server, OCR, CSV/XLSX extraction, connector imports, or production deployment.

## Local Development Assumptions

- Development starts locally before cloud deployment.
- Docker Compose is used for local data services only in Phase 3.
- Original chat attachments are private and live in ignored local storage.
- Sample fixtures must be synthetic and safe to commit.
- Real company documents must not be committed.
- Raw document content should not be logged.
- The first local version can use a single-company workspace model.
