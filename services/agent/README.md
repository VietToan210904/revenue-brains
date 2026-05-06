# Revenue Brains Agent Service

Python FastAPI scaffold for the Revenue Brains intelligence layer.

## Commands

```bash
uv sync
uv run uvicorn app.main:app --reload --port 8000
uv run pytest
uv run ruff check
uv run ruff format
```

The Phase 2 scaffold exposes process health and placeholder API routes only.
Document parsing, extraction, embeddings, Qdrant logic, and Postgres access are
intentionally not implemented here.
