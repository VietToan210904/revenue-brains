# Product Spec

## Product Summary

Revenue Brains is an AI-native document automation and company brain platform. It helps employees send chat messages with company documents attached, give natural-language instructions, automatically extract useful data, save exact records into Postgres, ingest searchable memory into Qdrant, and ask reliable business questions later.

The product is designed for step-by-step implementation. The first version should prove the document automation loop before adding many integrations or advanced enterprise features.

## Problem

Companies store important business information in messy documents: invoices, contracts, purchase orders, receipts, policies, internal guides, reports, and other files. Employees often need to manually read those documents, find useful fields, copy values into databases, and answer repeated questions from the same material.

This creates several problems:

- manual data entry is slow and error-prone
- important facts are trapped inside files
- revenue and finance records are hard to query exactly
- company knowledge is hard to search semantically
- employees repeat extraction, lookup, and summarization work

## Target Users

The first users are employees who handle operational company information:

- RevOps teams
- finance teams
- sales operations teams
- operations teams
- employees who need answers from general company knowledge documents

The initial product should feel especially useful for revenue and finance workflows, while still supporting general company documents for knowledge retrieval.

## MVP Scope

The MVP should support:

- an agent chat where employees attach documents and write processing instructions
- document processing job tracking
- document classification
- common metadata extraction for all documents
- type-specific extraction for revenue and finance documents
- AI-native confidence, validation, and review assessment
- structured record storage in Postgres
- document chunk and extracted-fact ingestion into Qdrant
- hybrid Q&A over Postgres and Qdrant
- chat replies with processing status, summaries, confidence, and links to records
- dashboard/status views for conversations, processing jobs, extracted records, confidence, source references, and Q&A history
- generic webhook sync after the core chat-ingestion-to-Q&A loop is working

The MVP should be automatic by default, but it must block external sync for low-confidence or incomplete results.

## Supported Attachment Formats

The first parser scope should be intentionally narrow:

- text-based PDF files
- DOCX documents
- plain text or Markdown files

Image-only PDFs, scanned receipts, PNG/JPEG uploads, OCR, CSV/XLSX extraction, a separate dashboard upload button, and email or Drive imports should wait until the text-based chat attachment pipeline is working. Receipt and expense documents are still in scope when they are attached as text-based PDFs or other supported text formats.

## Document Categories

The first supported categories are:

- invoice
- contract or order form
- purchase order
- receipt or expense
- general company knowledge document
- unknown document

Every document should receive common fields:

- title
- document type
- source filename
- detected entities
- important dates
- summary
- key facts
- tags
- confidence score

Known revenue and finance documents should also receive type-specific fields such as vendor, customer, invoice number, purchase order number, amount, currency, due date, contract value, renewal date, and payment terms where applicable.

## Document Field Contracts

Every document type should include source references for important extracted values. The agent should decide whether missing or uncertain fields lower confidence, require review, or make the result unusable.

| Document type | Required common fields | Required type-specific fields | Optional when present |
| --- | --- | --- | --- |
| invoice | title, document type, source filename, summary, confidence, source references | vendor, invoice number, invoice date, total amount, currency | customer, due date, payment terms, tax, line items, purchase order number |
| contract or order form | title, document type, source filename, summary, confidence, source references | primary parties, effective date or signature date, agreement summary | contract value, renewal date, term length, payment terms, termination terms, order form number |
| purchase order | title, document type, source filename, summary, confidence, source references | purchase order number, buyer, supplier, issue date, total amount, currency | delivery date, payment terms, line items, shipping address |
| receipt or expense | title, document type, source filename, summary, confidence, source references | merchant or vendor, transaction date, total amount, currency | tax, payment method, expense category, line items |
| general company knowledge document | title, document type, source filename, summary, confidence, source references | key facts, tags | important dates, detected entities, policy owner, related teams |
| unknown document | title, document type, source filename, summary, confidence, source references | key facts, tags | important dates, detected entities |

Unknown documents should receive common metadata and safe summarization only. They should not receive type-specific revenue or finance extraction unless the classifier reclassifies them into a supported type.

## Core Workflows

### Chat Document Ingestion

1. Employee sends a chat message with one or more documents attached and optional instructions.
2. The app stores the chat message, original files outside Git, document metadata in Postgres, and processing jobs.
3. The TypeScript app calls the Python agent service over HTTP with conversation/message IDs, document IDs, file storage keys, and user instructions.
4. The Python agent parses the document text.
5. The agent classifies the document type.
6. The agent extracts common and type-specific fields, guided by the employee's instructions.
7. The agent validates the extraction, assigns confidence, and returns source references.
8. The app saves exact structured records to Postgres.
9. The agent stores document chunks, extracted facts, summaries, and embeddings in Qdrant.
10. The app links Qdrant vector references back to Postgres documents and records.
11. The agent replies in chat with status, summary, confidence, and links to records or job details.
12. High-confidence records can later be sent to a generic webhook.
13. Low-confidence records remain internal and are not externally synced.

Original chat attachments should be stored in an app-managed upload volume or ignored local upload directory, not committed to the repository. Later deployments can map the same storage-key contract to object-storage-compatible storage. Extracted fields, chunks, facts, chat replies, and Q&A citations should preserve source references such as page number, text span, bounding box when available, chunk ID, and related Postgres record ID.

For the MVP contract, TypeScript should send Python a file storage key and user instructions rather than raw file bytes. Local development should resolve that key against an ignored private upload path shared by the local web and agent processes; later deployments can map the same storage-key contract to object storage.

### Hybrid Q&A

1. Employee asks a business question in the chat.
2. The system determines whether the question needs exact records, semantic document context, or both.
3. The TypeScript app uses Postgres through Prisma for exact facts and structured filters.
4. The Python service uses Qdrant for semantic retrieval over document chunks and extracted facts.
5. For hybrid answers, TypeScript passes structured Postgres evidence to Python.
6. The answering agent returns a response with source citations where possible.

Exact record questions should use Postgres, semantic document-context questions should use Qdrant, and mixed questions should use both. Answers that rely on document content should include citations whenever possible and should state when there is not enough evidence.

Python should not connect directly to Postgres in the MVP. It can return a typed retrieval plan for exact records, and the TypeScript app should execute that plan through Prisma.

## Processing Job States

Allowed job states should be explicit:

- `attached`: chat message, file, and metadata are stored, but no processing job has started.
- `queued`: a processing job is waiting to run.
- `processing`: parsing, classification, extraction, validation, or embedding is active.
- `extracted`: structured extraction was saved, but Qdrant ingestion is not complete.
- `completed`: Postgres save and Qdrant ingestion both succeeded.
- `needs_review`: processing finished with medium or low confidence, missing evidence, or validation warnings.
- `partial_failed`: one durable output succeeded while another failed.
- `failed`: no usable processing result was produced.
- `retrying`: a failed or partial job is being retried.

Retry attempts should preserve the previous error, attempt count, timestamps, and last successful stage. Partial failures should remain visible in the dashboard and should not trigger external sync.

## AI-Native Confidence Gates

The first implementation should let the extraction agent decide confidence, validation status, review requirements, and automation safety. The agent should return an explicit assessment with document confidence, field confidence, review reasons, missing fields, uncertain fields, and whether the record is safe to save as extracted or should remain reviewable.

Code should validate the technical shape of that assessment, but it should not apply fixed business thresholds or cap unknown document confidence. Records marked reviewable by the agent should be saved internally for visibility and should not be externally synced.

## Success Criteria

The first successful demo should show:

- an employee sending a chat message with at least one sample document attached and processing instructions
- the document moving through processing states
- classification and extracted fields appearing in chat and dashboard/status views
- structured data saved in Postgres
- document chunks or extracted facts saved in Qdrant
- a cited answer produced by the Q&A agent
- low-confidence behavior clearly represented

## Out Of Scope For MVP

Do not build these in the first implementation:

- multi-company SaaS tenancy
- billing
- complex role-based permissions
- email ingestion
- Google Drive ingestion
- CRM, ERP, or accounting connectors
- MCP agent tool server, write-capable MCP tools, or broad external AI tool access
- vendor-specific sync
- advanced analytics dashboards
- admin-defined custom extraction schemas
- production compliance workflows

These can be added after the end-to-end chat ingestion, extraction, storage, and Q&A loop works.
