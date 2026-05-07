# MCP Strategy

## Purpose

Revenue Brains uses Model Context Protocol (MCP) so the Python agent and local MCP clients can call controlled tools through a standard tool interface.

In this project, the primary MCP use case is:

```txt
Python agent service as MCP client
  -> calls Revenue Brains MCP server tools
  -> tools read approved external systems, internal APIs, or business databases
  -> MCP Tool Agent logs each tool call
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

The first implementation is broad but controlled. Most tools are read-only. Write tools are limited to safe actions that reuse existing product flows: trigger eligible webhook sync and request document reprocessing. Do not add raw SQL, shell, raw file access, or arbitrary write tools.

## Placement

Use a dedicated TypeScript/Node service:

```txt
services/
  mcp-server/           TypeScript/Node MCP server exposing controlled tools for the Python agent and local MCP clients
```

The Python agent service acts as an MCP client when it needs tool access. The MCP server is TypeScript/Node so it can reuse TypeScript-owned API contracts, authorization helpers, workspace scoping, and Prisma-backed access patterns without giving the Python agent raw database credentials.

In the autonomous team, the MCP Tool Agent is responsible for discovering available MCP tools, choosing relevant business tools, calling them, and turning successful results into exact evidence for Q&A. The Q&A and Response agents should answer from those verified tool results rather than inventing facts.

## Agent Tool Choice Flow

The local MVP tool-choice path is:

1. Python starts an autonomous run through `POST /agent/runs/start`.
2. The Manager Agent determines the run intent and whether exact company data may help.
3. The MCP Tool Agent loads the MCP tool list from `services/mcp-server/`.
4. The MCP Tool Agent chooses relevant controlled tools from the intent, attachments, question text, and run context.
5. Each MCP call is emitted as an `AgentStep` with safe arguments, status, and a short output summary.
6. Successful tool results become exact evidence for the Q&A Agent.
7. The Response Agent writes the final employee-facing reply from verified extraction, Qdrant, and MCP tool outputs only.

This is agent tool use through a controlled allowlist, not unrestricted tool access. The agent cannot execute raw SQL, shell commands, raw file reads, or arbitrary external actions through MCP.

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

The local MVP tool set:

- `get_workspace_summary`
- `search_documents`
- `get_document_metadata`
- `get_processing_job`
- `search_extracted_records`
- `get_extracted_record`
- `get_agent_run`
- `get_vector_references`
- `list_webhook_sync_attempts`
- `trigger_webhook_sync`
- `request_document_reprocess`

Later tools:

- `search_external_crm`
- `search_external_accounting`
- `search_external_drive`
- review approval tools
- connector-specific write tools

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

A Revenue Brains MCP server can be used by local external MCP clients with bearer-token auth. The primary product reason is still to give the Revenue Brains Python agent controlled tool access.

If external AI clients are supported later, they should use the same scoped tools and must not bypass authentication, workspace scoping, confidence gates, or audit logging.

## Roadmap Position

MCP is Phase 10 and completes the local MVP tool layer. The completed local MVP order is:

1. Scaffold the web app and Python agent service.
2. Implement chat ingestion, extraction, Postgres persistence, and Qdrant ingestion.
3. Implement hybrid Q&A.
4. Add the async autonomous agent team and visible run timeline.
5. Add webhook sync for trusted extractions.
6. Add a controlled MCP server plus Python MCP Tool Agent for agent/client tools.

After Phase 10, future work should be production auth, external connectors, broader write tools, audit-grade review flows, and deployment hardening.
