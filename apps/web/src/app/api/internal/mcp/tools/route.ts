import { jsonError } from "@/lib/api";
import {
  executeMcpTool,
  isMcpInternalRequestAuthorized,
  McpToolError
} from "@/lib/mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isMcpInternalRequestAuthorized(request)) {
    return jsonError("Unauthorized MCP internal tool request.", 401);
  }

  try {
    const body = (await request.json()) as {
      tool?: unknown;
      args?: unknown;
    };
    if (typeof body.tool !== "string") {
      return jsonError("MCP tool name is required.", 400);
    }
    if (body.args !== undefined && (typeof body.args !== "object" || body.args === null)) {
      return jsonError("MCP tool args must be an object.", 400);
    }

    const result = await executeMcpTool(
      body.tool,
      (body.args ?? {}) as Record<string, unknown>
    );

    return Response.json({
      ok: true,
      tool: body.tool,
      result
    });
  } catch (error) {
    if (error instanceof McpToolError) {
      return jsonError(error.message, error.statusCode);
    }

    const message =
      error instanceof Error ? error.message : "MCP internal tool request failed.";
    return jsonError(message, 500);
  }
}
