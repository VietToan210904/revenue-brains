# Scaffold Plan

## Purpose

This document describes the real Phase 2 scaffold. It is not a Phase 3 or Phase 4 implementation plan. The repository has since moved beyond this scaffold; use `docs/roadmap.md` for current milestone status.

Phase 2 creates a runnable web scaffold, a runnable agent scaffold, and DB-only local infrastructure. It must not add upload handling, extraction, RAG behavior, auth, webhook sync, MCP tooling, or connector features.

## Implemented Structure

```txt
apps/
  web/                  Next.js App Router scaffold, status page, and web health route
services/
  agent/                FastAPI scaffold, placeholder agent routes, uv.lock, and Python tests
docs/
  api/                  HTTP contracts between TypeScript and Python
docker-compose.yml      local Postgres and Qdrant infrastructure only
.env.example            checked-in non-secret local environment template
package.json            root npm workspace scripts for the web app
package-lock.json       npm lockfile
```

Future structure remains:

```txt
services/
  mcp-server/           later TypeScript/Node MCP server, not Phase 2
packages/
  shared/               optional shared API schemas or generated types
tests/
  integration/          cross-service integration tests and safe synthetic fixtures
assets/                 prompts, examples, safe sample documents, static assets
config/                 checked-in non-secret config templates
```

Use this structure instead of generic `frontend/` and `backend/` directories. The Next.js app has backend responsibilities, and the Python service is a separate intelligence service.

## Tooling

Implemented:

- TypeScript app: Next.js, React, TypeScript, npm scripts, ESLint.
- Python service: FastAPI, uv, pytest, Ruff, and tracked `services/agent/uv.lock`.
- Databases: Postgres and Qdrant through DB-only Docker Compose.
- API contracts: documented in `docs/api/README.md`.

Not implemented in Phase 2:

- Prisma package/schema/migrations.
- OpenAPI generation or shared generated schemas.
- Docker Compose containers for web or agent.

If a different package manager or service runner is selected later, update `README.md`, `AGENTS.md`, and `docs/development-setup.md` in the same change.

## Local Ports

Default local ports:

- Next.js app: `3000`
- Python agent service: `8000`
- Postgres: `5432`
- Qdrant HTTP: `6333`
- Qdrant gRPC: `6334`

If any port changes, document it in `README.md`, `docs/development-setup.md`, and `.env.example`.

## Docker Compose Scope

Phase 2 Docker Compose defines only:

- `postgres`: local structured database.
- `qdrant`: local vector database.

Compose should not define `web` or `agent` services in Phase 2. The web app runs locally with `npm run dev`, and the Python agent service runs locally with `python -m uv run uvicorn app.main:app --reload --reload-exclude .venv --port 8000`.

Web and agent Compose services are deferred to a later full orchestration milestone if the project decides it needs one.

The local upload path is `./uploads`, controlled by `UPLOAD_STORAGE_PATH`, and ignored by Git. Phase 2 Compose does not mount this path into web or agent containers because those containers are intentionally not part of the Phase 2 Compose file.

The MVP file handoff contract remains storage-key based. Later chat ingestion phases should store chat attachments and send Python a file storage key plus user instructions, not raw file bytes.

## Environment Variables

The scaffold supports these placeholders:

```txt
APP_ENV=development
PYTHON_AGENT_URL=http://localhost:8000
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
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

Only placeholder values belong in committed files. Real values should stay in ignored local env files.

## Health Checks

Implemented:

- `GET /api/health` in the Next.js app.
- `GET /health` in the Python agent service.
- Postgres Docker health check in Compose.

Not implemented:

- Web or agent Docker health checks, because Phase 2 has no web or agent Compose services.
- Qdrant Docker health check.

Health endpoints prove the service process is running. They do not require OpenAI, Postgres migrations, chat attachments, or Qdrant collections to exist.

## API Contract Placeholders

Implemented in code:

- `GET /api/health`
- `GET /health`
- `POST /documents/process`
- `POST /qa/plan`
- `POST /qa/answer`

Implemented in later phases, but not part of the Phase 2 scaffold:

- `POST /api/chat/messages`
- `GET /api/chat/:conversationId`
- `GET /api/jobs/:jobId`

The contracts preserve the ownership model:

- TypeScript owns future Postgres reads and writes through Prisma.
- Python owns parsing, validation, Qdrant writes, Qdrant retrieval, and answer generation.
- Python does not connect directly to Postgres in the MVP.

## Commands

Root npm commands:

```bash
npm ci
npm run dev
npm test
npm run lint
npm run build
```

Python service commands from `services/agent`:

```bash
python -m uv sync
python -m uv run uvicorn app.main:app --reload --reload-exclude .venv --port 8000
python -m uv run pytest
python -m uv run ruff check
python -m uv run ruff format --check
```

Infrastructure commands from the root:

```bash
docker compose up -d postgres qdrant
docker compose config
docker compose down
```

## Phase 2 Status

Done:

- The web app scaffold exists and can start locally after `npm ci`.
- The Python agent service scaffold exists and can start locally after `python -m uv sync`.
- `services/agent/uv.lock` is tracked.
- Postgres and Qdrant are configured through DB-only Docker Compose.
- Private attachment storage is represented by an ignored local upload path.
- Health checks exist for the web app and agent service.
- `.env.example` contains local placeholders.
- `README.md` and `docs/development-setup.md` list the real commands.
- `docs/api/` documents the current placeholder contracts.
- No secrets, private documents, generated caches, or raw customer data are committed.

Remaining scaffold gaps:

- Add Prisma package/schema/migrations before implementing Postgres-backed chat ingestion.
- Add real TypeScript tests when web behavior goes beyond the placeholder page and health route.
- Add web/agent Compose containers only in a later full orchestration milestone, not Phase 2.

During Phase 2, do not start Phase 3 behavior until scaffold gaps are intentionally accepted or addressed.
