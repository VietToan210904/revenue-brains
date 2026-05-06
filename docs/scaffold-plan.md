# Scaffold Plan

## Purpose

This document defines the target for the Phase 2 scaffold. It is not production runtime documentation. It is the checklist future implementation work should satisfy before moving on to chat ingestion, extraction, Qdrant ingestion, and Q&A features.

## Target Structure

```txt
apps/
  web/                  Next.js app, agent chat UI, dashboard/status views, TypeScript API routes
services/
  agent/                Python FastAPI service for parsing, extraction, Qdrant, and Q&A
  mcp-server/           future TypeScript/Node MCP server for Python agent tools, not required for Phase 2
packages/
  shared/               optional shared API schemas or generated types
tests/
  integration/          cross-service integration tests and safe synthetic fixtures
assets/                 prompts, examples, safe sample documents, static assets
config/                 checked-in non-secret config templates
docs/
  api/                  HTTP contracts between TypeScript and Python
```

Use this structure instead of generic `frontend/` and `backend/` directories. The Next.js app has backend responsibilities, and the Python service is a separate intelligence service.

Do not implement `services/mcp-server/` during Phase 2 unless the project explicitly changes scope. It is reserved for a later MCP milestone where the Python agent becomes an MCP client. When implemented, `services/mcp-server/` should be TypeScript/Node so it can preserve TypeScript-owned Postgres access, authorization, workspace scoping, and shared API/schema contracts.

## Initial Tooling Choices

- TypeScript app: Next.js, React, TypeScript, npm scripts.
- Python service: FastAPI with `uv` for dependency management, pytest for tests, Ruff for linting/formatting, and a documented local server command.
- Databases: Postgres for exact records, Qdrant for vector memory.
- Local orchestration: Docker Compose.
- API contracts: start in `docs/api/`, then move to OpenAPI or generated shared schemas when endpoints stabilize.

If a different package manager is selected during scaffold, update `README.md`, `AGENTS.md`, and `docs/development-setup.md` in the same change.

## Local Ports

Default local ports:

- Next.js app: `3000`
- Python agent service: `8000`
- Postgres: `5432`
- Qdrant: `6333`

If any port changes, document it in `docs/development-setup.md` and `.env.example`.

## Required Services

Docker Compose should define:

- `web`: Next.js application.
- `agent`: Python FastAPI service.
- `postgres`: Postgres database.
- `qdrant`: Qdrant vector database.

Docker Compose should also define a named attachment/upload volume, or mount an ignored local upload directory, into both `web` and `agent`. `uploads` is a storage mount, not a separate runtime service. Object-storage-compatible storage can replace the same storage-key contract in later deployments, but it is not required for the Phase 2 scaffold.

The MVP file handoff contract is storage-key based. The TypeScript app stores chat attachments and sends Python a file storage key plus user instructions, not raw file bytes.

## Environment Variables

Scaffold should support these placeholders:

```txt
DATABASE_URL=
OPENAI_API_KEY=
QDRANT_URL=
QDRANT_API_KEY=
PYTHON_AGENT_URL=
UPLOAD_STORAGE_PATH=
WEBHOOK_URL=
WEBHOOK_SECRET=
APP_ENV=development
```

Only placeholder values belong in committed files. Real values should stay in ignored local env files.

## Health Checks

The scaffold should include:

- `GET /api/health` in the Next.js app.
- `GET /health` in the Python agent service.
- Docker Compose health checks for Postgres and Qdrant when practical.

Health endpoints should prove the service process is running. They should not require OpenAI, Postgres migrations, chat attachments, or Qdrant collections to exist.

## Initial API Contract Placeholders

Use the endpoint contracts documented in `docs/api/README.md` before implementation details drift:

- `GET /api/health`
- `POST /api/chat/messages`
- `GET /api/chat/:conversationId`
- `GET /api/jobs/:jobId`
- `GET /health`
- `POST /documents/process`
- `POST /qa/plan`
- `POST /qa/answer`

The contracts should preserve the current ownership model:

- TypeScript owns Postgres reads and writes through Prisma.
- Python owns parsing, validation, Qdrant writes, Qdrant retrieval, and answer generation.
- Python does not connect directly to Postgres in the MVP.

## Expected Commands

Root-level scripts should eventually expose:

```bash
npm run dev
npm test
npm run lint
npm run build
```

The Python service should expose documented `uv` commands:

```bash
uv sync
uv run uvicorn app.main:app --reload --port 8000
uv run pytest
uv run ruff check
uv run ruff format
```

## Done Checklist

Phase 2 is done when:

- The directories above exist.
- The web app starts locally.
- The Python agent service starts locally.
- Postgres and Qdrant start through Docker Compose.
- A private attachment/upload volume or ignored local upload path exists outside Git and is mounted into `web` and `agent`.
- Health checks pass for the web app and agent service.
- `.env.example` contains all required placeholders.
- `README.md` and `docs/development-setup.md` list the real commands.
- `docs/api/` contains initial request and response contract placeholders.
- No secrets, private documents, generated caches, or raw customer data are committed.
