# Agent Design

## Summary

Revenue Brains now uses a Python-owned autonomous agent team plus lower-level controlled tools:

- a Manager Agent that receives the chat goal, creates a plan, delegates work, and decides when the run is complete
- an Intake Agent that inspects attachment metadata, instructions, and parsing needs
- an Extraction Agent that turns chat-attached documents into structured records and summaries
- a Validation/Critic Agent that checks evidence support, confidence, review need, and automation safety from agent outputs
- a Memory Agent that stores and retrieves Qdrant semantic memory
- a Q&A Agent that answers employee questions using TypeScript-supplied Postgres evidence and Python-owned Qdrant retrieval
- a Response Agent that writes the final employee-facing reply from verified outputs only

These responsibilities live in the Python agent service. The TypeScript app starts async runs, receives callbacks, and persists the returned outputs.

The Python service does not connect directly to Postgres in the MVP. The TypeScript app owns exact Postgres reads and writes through Prisma.

## Autonomous Team Responsibilities

The autonomous team should:

- receive every normal chat request from the TypeScript app through `POST /agent/runs/start`
- inspect the user message, optional instructions, attachment metadata, and recent Postgres evidence
- decide whether the request needs document ingestion, Q&A, both, clarification, or a safe unsupported response
- delegate work across Manager, Intake, Extraction, Validation/Critic, Memory, Q&A, and Response agents
- call the ingestion graph and Q&A graph as controlled tools
- emit progress events for a visible agent activity timeline
- return a final reply, artifacts, citations, and automation decision through callback APIs
- avoid connecting directly to Postgres or receiving raw database credentials

The old `POST /agent/respond` supervisor remains as a compatibility endpoint. Phase 7 uses the async run endpoint as the primary chat path.

The Response Agent must not discover new facts. It only communicates verified extraction results, Q&A answers, citations, limitations, review status, and next steps from other agents.

## Ingestion Agent Responsibilities

The ingestion agent should:

- receive a document processing request from the TypeScript app
- extract readable text from the chat-attached file
- classify the document type
- extract common document metadata
- extract type-specific fields for known revenue and finance documents
- use employee instructions to guide extraction focus, tags, and processing context
- assess extracted values, evidence quality, and review requirements
- assign document-level and field-level confidence as an agent decision
- produce normalized records for Postgres
- produce chunks, extracted facts, and summaries for Qdrant
- return errors in a structured format when processing fails

The ingestion agent is implemented as a controlled LangGraph workflow. It is deterministic around output shape even when the AI model response is uncertain.

The current implementation parses and extracts synchronously, chunks parsed text, embeds chunks with OpenAI embeddings, writes vector memory to Qdrant, and returns structured payloads plus vector references to TypeScript for Postgres persistence.

## Classification And Extraction Flow

```txt
Manager-selected document ingestion task
  -> chat-attached document + instructions
  -> parse text
  -> detect language and basic metadata
  -> classify document type
  -> choose extraction schema
  -> extract common fields
  -> extract type-specific fields
  -> validate output
  -> score confidence
  -> chunk text
  -> embed chunks
  -> upsert vectors into Qdrant
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

The document field expectations in `docs/product-spec.md` are business guidance for the agent, not deterministic gates in Python. The agent should decide whether missing or uncertain fields lower confidence, require review, or make the result unusable.

## Supported Input Formats

The MVP parser should support text-based PDFs, DOCX, plain text, and Markdown. Image-only PDFs, scanned images, OCR, CSV/XLSX extraction, connector imports, and a separate dashboard upload button should be deferred until the text-based chat attachment pipeline works end to end.

## Validation And Confidence

The agent should assess:

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

The ingestion graph is AI-native: the agent returns an `agentAssessment` that decides extraction status, validation status, confidence, review requirement, review reasons, missing fields, uncertain fields, and automation safety. Python code validates the response shape and safe error behavior, but it should not cap confidence or apply deterministic business thresholds.

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

For normal chat work, the TypeScript app should send the Python autonomous team a request containing:

- agent run ID
- conversation ID
- message ID
- workspace or organization ID
- user message
- user instructions from the chat message
- attachment metadata with document IDs, private storage keys, checksums, filenames, and content types
- recent TypeScript-owned Postgres evidence when available
- callback base URL and callback secret configured in the environment
- optional processing options

The lower-level document ingestion tool still receives a single-document processing request from the autonomous team or the compatibility supervisor.

## Expected Processing Output

The Python autonomous team should emit and return:

- detected intent
- tool actions taken
- ordered agent steps
- run artifacts
- automation decision
- extractions when document ingestion ran
- Q&A answer when the Q&A tool ran
- final chat reply
- limitations, citations, and structured errors where applicable

The ingestion tool should return:

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

The current ingestion graph returns extraction fields, `agentAssessment`, validation details derived from that assessment, confidence, source references, Qdrant vector references, and chat reply.

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
