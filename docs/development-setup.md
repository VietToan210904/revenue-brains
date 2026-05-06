# Development Setup

## Summary

Revenue Brains is not scaffolded yet. This document defines the intended development setup so future implementation steps have a clear target.

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

## Environment Variables

Template variables currently listed in `.env.example`:

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

Real values should live in ignored local environment files such as `.env.local`. Only placeholder templates should be committed.

## Future Docker Compose Plan

The scaffold milestone should add Docker Compose services for:

- `app`: Next.js application
- `agent`: Python FastAPI service
- `postgres`: structured database
- `qdrant`: vector database

The scaffold should also add a named attachment/upload volume or ignored local upload directory mounted into `app` and `agent`. `uploads` should not be treated as a separate service unless the project later chooses an object-storage-compatible service.

The local setup should let a builder start the system with one documented command once scaffolded.

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

This setup is planned, not implemented. The current repository contains documentation only.
