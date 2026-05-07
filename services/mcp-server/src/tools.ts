import * as z from "zod/v4";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { callInternalTool } from "./internal-client.js";

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  inputSchema: Record<string, z.ZodType>;
};

const workspaceId = z.string().optional().describe("Revenue Brains workspace ID. Defaults to the local default workspace when omitted.");
const limit = z.number().int().min(1).max(25).optional().describe("Maximum number of records to return. Max 25.");

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "get_workspace_summary",
    title: "Get Workspace Summary",
    description: "Return safe counts and summary metadata for the current Revenue Brains workspace.",
    readOnly: true,
    inputSchema: {
      workspaceId
    }
  },
  {
    name: "search_documents",
    title: "Search Documents",
    description: "Search document metadata by filename, type, status, or recent creation time.",
    readOnly: true,
    inputSchema: {
      workspaceId,
      query: z.string().optional(),
      documentType: z.string().optional(),
      status: z.string().optional(),
      limit
    }
  },
  {
    name: "get_document_metadata",
    title: "Get Document Metadata",
    description: "Return one document's metadata, processing jobs, extraction summary, source references, and vector references.",
    readOnly: true,
    inputSchema: {
      workspaceId,
      documentId: z.string()
    }
  },
  {
    name: "get_processing_job",
    title: "Get Processing Job",
    description: "Return a processing job by job ID or latest job for a document.",
    readOnly: true,
    inputSchema: {
      workspaceId,
      jobId: z.string().optional(),
      documentId: z.string().optional()
    }
  },
  {
    name: "search_extracted_records",
    title: "Search Extracted Records",
    description: "Search exact extracted records and their normalized fields without exposing raw document text.",
    readOnly: true,
    inputSchema: {
      workspaceId,
      query: z.string().optional(),
      documentType: z.string().optional(),
      validationStatus: z.string().optional(),
      limit
    }
  },
  {
    name: "get_extracted_record",
    title: "Get Extracted Record",
    description: "Return an extracted record by record ID or document ID with fields, citations, and vector references.",
    readOnly: true,
    inputSchema: {
      workspaceId,
      recordId: z.string().optional(),
      documentId: z.string().optional()
    }
  },
  {
    name: "get_agent_run",
    title: "Get Agent Run",
    description: "Return an agent run timeline, safe artifacts, final reply, and automation decision.",
    readOnly: true,
    inputSchema: {
      workspaceId,
      agentRunId: z.string()
    }
  },
  {
    name: "get_vector_references",
    title: "Get Vector References",
    description: "Return Postgres references to Qdrant vector memory for a document or extracted record.",
    readOnly: true,
    inputSchema: {
      workspaceId,
      documentId: z.string().optional(),
      extractedRecordId: z.string().optional(),
      limit
    }
  },
  {
    name: "list_webhook_sync_attempts",
    title: "List Webhook Sync Attempts",
    description: "Return recent webhook delivery attempts and safe delivery status details.",
    readOnly: true,
    inputSchema: {
      workspaceId,
      documentId: z.string().optional(),
      extractedRecordId: z.string().optional(),
      status: z.string().optional(),
      limit
    }
  },
  {
    name: "trigger_webhook_sync",
    title: "Trigger Webhook Sync",
    description: "Trigger the existing safe webhook sync path for one eligible trusted extracted record.",
    readOnly: false,
    inputSchema: {
      workspaceId,
      extractedRecordId: z.string(),
      agentRunId: z.string().optional()
    }
  },
  {
    name: "request_document_reprocess",
    title: "Request Document Reprocess",
    description: "Create a new normal agent run that reprocesses an existing document storage key.",
    readOnly: false,
    inputSchema: {
      workspaceId,
      documentId: z.string(),
      reason: z.string().min(1).max(500)
    }
  }
];

export function registerRevenueBrainsTools(server: McpServer) {
  for (const tool of toolDefinitions) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: false,
          openWorldHint: false
        }
      },
      async (args) => {
        const response = await callInternalTool(tool.name, args as Record<string, unknown>);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response.result, null, 2)
            }
          ],
          structuredContent: toStructuredContent(response.result)
        };
      }
    );
  }
}

function toStructuredContent(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return { value };
}
