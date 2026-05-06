# Revenue Brains Agent Service

Python FastAPI service for the Revenue Brains intelligence layer.

## Commands

```bash
uv sync
uv run uvicorn app.main:app --reload --port 8000
uv run pytest
uv run ruff check
uv run ruff format
```

The Phase 3 service exposes process health, placeholder Q&A routes, and an
accepted-stub document handoff route at `POST /documents/process`.

Document parsing, extraction, embeddings, Qdrant logic, and Postgres access are
intentionally not implemented here yet.
