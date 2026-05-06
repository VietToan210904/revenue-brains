# Revenue Brains Agent Service

Python FastAPI service for the Revenue Brains intelligence layer.

## Commands

```bash
python -m uv sync
python -m uv run uvicorn app.main:app --reload --reload-exclude .venv --port 8000
python -m uv run pytest
python -m uv run ruff check
python -m uv run ruff format
```

The service exposes process health, LangGraph document ingestion at
`POST /documents/process`, and LangGraph Q&A routes at `POST /qa/plan` and
`POST /qa/answer`.

Supported inputs are TXT, Markdown, text-based PDF, and DOCX files resolved
from `UPLOAD_STORAGE_PATH`. Live extraction uses LangChain structured output
with `OPENAI_API_KEY` and optional `OPENAI_MODEL` configuration. Vector
ingestion uses `OPENAI_EMBEDDING_MODEL`, `QDRANT_URL`, and
`QDRANT_COLLECTION`.

Automated tests use deterministic mocked extraction/vector behavior and do not
call OpenAI or Qdrant. Postgres access is intentionally not implemented in this
service; the TypeScript app owns Postgres reads and writes.
