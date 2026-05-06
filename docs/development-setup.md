# Development Setup

## Summary

Revenue Brains currently has Phase 2 local infrastructure for Postgres, Qdrant, and private local upload storage. The Next.js web app and Python agent service are still planned and are not implemented in this infrastructure-only scaffold.

## Expected Stack

- Next.js, React, and TypeScript for the chat workspace, dashboard/status views, and product backend
- Python and FastAPI for the agent and RAG service
- Postgres for structured data
- Qdrant for vector memory
- Prisma for TypeScript database access
- OpenAI API for classification, extraction, embeddings, and answering
- Docker Compose for local services
- uv for Python agent dependency management and commands

## Required Services

The local development environment should eventually run:

- Next.js app
- Python FastAPI agent service
- Postgres database
- Qdrant vector database

Original chat attachments should live outside Git. The MVP local contract should use an app-managed private upload volume, or an ignored local upload directory, mounted into both the Next.js app and Python agent service. Later deployments can map the same file storage key contract to object-storage-compatible storage. Optional later services may include a background worker, object storage, or a webhook test receiver.

The current `docker-compose.yml` starts only the infrastructure services:

- `postgres` on host port `5432`
- `qdrant` on host port `6333` for HTTP and `6334` for gRPC

The current local upload path is `./uploads`, controlled by `UPLOAD_STORAGE_PATH` and ignored by Git. The Compose file defines the future upload bind mount shape, but it does not start web or agent containers yet.

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

## Local Infrastructure Commands

Create local environment and upload storage files:

```powershell
Copy-Item .env.example .env
New-Item -ItemType Directory -Force uploads
```

Start the local infrastructure:

```bash
docker compose up -d postgres qdrant
```

Check service state:

```bash
docker compose ps
```

Stop services while keeping named database volumes:

```bash
docker compose down
```

Remove local database volumes only when you intentionally want to wipe local data:

```bash
docker compose down -v
```

The future full scaffold should add Docker Compose services for:

- `web`: Next.js application
- `agent`: Python FastAPI service

The upload path should then be mounted into both `web` and `agent`. `uploads` should not be treated as a separate service unless the project later chooses an object-storage-compatible service.

## Future Commands

No package manager or scripts exist yet. Once implementation begins, use project scripts such as:

```bash
npm run dev
npm test
npm run lint
npm run build
```

The Python service should use `uv` and expose documented commands such as:

```bash
uv sync
uv run uvicorn app.main:app --reload --port 8000
uv run pytest
uv run ruff check
uv run ruff format
```

If Python tooling changes later, update `README.md`, `AGENTS.md`, `docs/scaffold-plan.md`, and this file in the same change.

## Local Development Assumptions

- Development starts locally before cloud deployment.
- Docker Compose is preferred for repeatable service setup.
- Sample fixtures must be synthetic and safe to commit.
- Real company documents must not be committed.
- Raw document content should not be logged.
- The first local version can use a single-company workspace model.

## Setup Status

Implemented:

- Docker Compose services for local Postgres and Qdrant.
- Named Docker volumes for Postgres and Qdrant data.
- Ignored local upload directory contract through `UPLOAD_STORAGE_PATH=./uploads`.
- Environment template values aligned with the local infrastructure ports.

Not implemented yet:

- Next.js app service.
- Python FastAPI agent service.
- Health endpoints for app or agent.
- Chat ingestion, extraction, Qdrant ingestion, RAG, auth, MCP, or external sync.
