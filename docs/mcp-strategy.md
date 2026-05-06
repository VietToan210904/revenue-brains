# MCP Strategy

## Purpose

Revenue Brains can use Model Context Protocol (MCP) so the Python agent can call controlled tools through a standard tool interface.

In this project, the primary MCP use case is:

```txt
Python agent service as MCP client
  -> calls Revenue Brains MCP server tools
  -> tools read approved external systems, internal APIs, or business databases
  -> agent uses tool results during extraction, validation, and Q&A
```

MCP is not a replacement for Postgres, Qdrant, the dashboard, or the TypeScript-to-Python HTTP API. It is a tool layer for the agent.

## Recommended Role

Use MCP to expose tools the agent may need, such as:

- lookup exact extracted records
- check processing job status
- search approved document metadata
- fetch approved structured business facts
- call external systems later, such as CRM, ERP, accounting, Drive, or email tools
- validate extracted values against approved reference data

For the first implementation, keep MCP read-only. Write tools can come later after auth, audit logging, and review workflows are mature.

## Placement

Use a dedicated TypeScript/Node service:

```txt
services/
  mcp-server/           TypeScript/Node MCP server exposing controlled tools for the Python agent
```

The Python agent service should act as an MCP client when it needs tool access. The MCP server should be TypeScript/Node so it can reuse TypeScript-owned API contracts, authorization helpers, workspace scoping, and Prisma-backed access patterns without giving the Python agent raw database credentials.

## Ownership Model

MCP should preserve the existing architecture:

- TypeScript still owns Postgres reads and writes through Prisma.
- Python still owns parsing, extraction, validation, embeddings, Qdrant ingestion, Qdrant retrieval, and answer generation.
- The TypeScript/Node MCP server can expose exact-record tools by calling TypeScript-owned APIs or shared TypeScript data-access code.
- The MCP server should not give the Python agent raw database credentials by default.
- Tools that need semantic retrieval should call the existing Python/Q&A flow or a controlled retrieval API instead of bypassing Qdrant ownership.

This means the agent can use tools without directly coupling itself to every database or integration.

## Internal Databases And External Databases

There are two kinds of tool targets:

- **Internal Revenue Brains data:** Postgres records, job state, document metadata, source references, and sync status.
- **External systems:** future CRM, ERP, accounting, Google Drive, email, or customer-specific databases.

For internal Postgres access, prefer MCP tools that call TypeScript-owned APIs. This keeps Prisma models, workspace filtering, authorization, and audit behavior in one place.

For external databases or systems, MCP tools should be explicit, scoped, and read-only first. Do not add broad SQL execution tools or generic unrestricted connector tools in the MVP.

## Initial MCP Tool Surface

Start with a small read-only tool set:

- `get_document_metadata`: return document metadata, type, status, and source references.
- `get_processing_job`: return processing state, attempts, errors, and last successful stage.
- `search_extracted_records`: search structured records using approved filters.
- `get_extracted_record`: return extracted fields, confidence, validation status, and citations.
- `lookup_reference_data`: check approved reference data for validation when configured.

Later tools:

- `search_external_crm`
- `search_external_accounting`
- `search_external_drive`
- `retry_processing_job`
- `mark_record_reviewed`
- `trigger_webhook_sync`

Write tools should require authorization, audit logging, and explicit confirmation behavior where appropriate.

## Security Rules

- Enforce workspace boundaries for every MCP tool call.
- Do not expose raw chat-attached document content by default.
- Do not expose unrestricted SQL tools.
- Do not pass raw database credentials to the Python agent.
- Return source references and snippets only when the caller is authorized.
- Preserve audit logs for write tools.
- Never expose secrets, private storage paths, raw embeddings, or customer credentials.

## Relationship To External AI Clients

A Revenue Brains MCP server could later be exposed to external AI clients, but that is secondary. The first MCP reason is to give the Revenue Brains agent controlled tool access.

If external AI clients are supported later, they should use the same scoped tools and must not bypass authentication, workspace scoping, confidence gates, or audit logging.

## Roadmap Position

MCP can be added after the core agent API exists. The safest order is:

1. Scaffold the web app and Python agent service.
2. Implement chat ingestion, extraction, Postgres persistence, and Qdrant ingestion.
3. Implement hybrid Q&A.
4. Add auth and privacy hardening.
5. Add a read-only MCP server for agent tools.
6. Add write tools and external connectors only after audit and review flows are ready.
