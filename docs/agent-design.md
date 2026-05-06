# Agent Design

## Summary

Revenue Brains uses two agent responsibilities:

- an ingestion agent that turns chat-attached documents and employee instructions into structured records and vector memory
- a Q&A agent that answers employee questions using TypeScript-supplied Postgres evidence and Python-owned Qdrant retrieval

Both responsibilities live in the Python agent service. The TypeScript app calls the service and persists the returned outputs.

The Python service does not connect directly to Postgres in the MVP. The TypeScript app owns exact Postgres reads and writes through Prisma.

## Ingestion Agent Responsibilities

The ingestion agent should:

- receive a document processing request from the TypeScript app
- extract readable text from the chat-attached file
- classify the document type
- extract common document metadata
- extract type-specific fields for known revenue and finance documents
- use employee instructions to guide extraction focus, tags, and processing context
- validate required fields and formats
- assign document-level and field-level confidence
- produce normalized records for Postgres
- produce chunks, extracted facts, and summaries for Qdrant
- return errors in a structured format when processing fails

The ingestion agent should be deterministic around output shape even when the AI model response is uncertain.

## Classification And Extraction Flow

```txt
Chat-attached document + instructions
  -> parse text
  -> detect language and basic metadata
  -> classify document type
  -> choose extraction schema
  -> extract common fields
  -> extract type-specific fields
  -> validate output
  -> score confidence
  -> prepare storage payloads
```

Supported MVP types:

- invoice
- contract or order form
- purchase order
- receipt or expense
- general company knowledge document
- unknown document

Common extraction should run for every document. Type-specific extraction should run only when the document type is known and has a supported schema.

The authoritative per-type required fields are in `docs/product-spec.md`. Missing required fields should lower confidence and may produce `needs_review` or `failed` status depending on severity.

## Supported Input Formats

The MVP parser should support text-based PDFs, DOCX, plain text, and Markdown. Image-only PDFs, scanned images, OCR, CSV/XLSX extraction, connector imports, and a separate dashboard upload button should be deferred until the text-based chat attachment pipeline works end to end.

## Validation And Confidence

The agent should validate:

- required fields for the detected document type
- date formats
- currency formats
- numeric amount formats
- entity names where available
- source references for important extracted values
- whether the extracted value is supported by the source text

Confidence should be represented at two levels:

- document-level confidence for the overall extraction
- field-level confidence for important extracted values

The first implementation can use simple thresholds:

- high confidence: score `>= 0.85`, required fields present, validation passes, important fields have source references, eligible for automatic sync only after the generic webhook milestone exists
- medium confidence: score `>= 0.60` and `< 0.85` or minor validation gaps, saved internally, visible in dashboard, not externally synced
- low confidence: score `< 0.60`, unsupported values, missing critical fields, or severe validation failures, saved internally with warning or marked failed depending on severity

## RAG Answering Agent Responsibilities

The Q&A agent should:

- receive an employee question
- decide whether the question needs exact structured data, semantic context, or both
- return a typed request for exact structured records when Postgres evidence is needed
- receive exact Postgres evidence from the TypeScript app after it is fetched through Prisma
- query Qdrant for relevant chunks and extracted facts when needed
- combine retrieved evidence
- generate a concise answer
- include source document references where possible
- state when the available data is insufficient

The answering agent should not invent facts that are not supported by TypeScript-supplied Postgres records or retrieved document context.

## Expected Processing Input

The TypeScript app should send the Python agent a request containing:

- conversation ID
- message ID
- document ID
- original file storage key in the private upload store
- checksum recorded by the TypeScript app
- original filename
- content type
- workspace or organization ID
- user instructions from the chat message
- optional processing options

## Expected Processing Output

The Python agent should return:

- document type
- common fields
- type-specific fields
- extracted facts
- summary
- confidence scores
- validation status
- source references
- chunks prepared for embedding
- Qdrant vector references after Python-owned ingestion
- chat reply content for the employee
- structured errors if processing fails

## Expected Q&A Input

The TypeScript app should send:

- user question
- conversation context when relevant
- workspace or organization ID
- optional filters such as document type, date range, or document IDs
- structured Postgres evidence when exact records are needed

For exact-record or hybrid questions, the MVP should use a two-step exchange:

1. TypeScript sends the question, conversation context, and filters to Python.
2. Python returns a typed retrieval plan when exact records are needed.
3. TypeScript executes that plan through Prisma and sends the resulting structured records back to Python.
4. Python combines the structured records with Qdrant evidence when needed and returns the answer.

## Expected Q&A Output

The Python agent should return:

- answer text
- citations
- retrieved Postgres record references supplied by TypeScript
- retrieved Qdrant chunk references
- confidence or evidence quality
- any limitations or missing data notes

## Guardrails

- Do not log raw document content.
- Do not use private real documents as fixtures.
- Keep output schemas explicit.
- Keep enough source references to audit important extracted fields.
- Prefer failing safely over syncing uncertain business data.
