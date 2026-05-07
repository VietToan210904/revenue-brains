import { mcpInternalApiToken, requestTimeoutMs, webAppUrl } from "./config.js";

export type InternalToolResult = {
  ok: true;
  tool: string;
  result: unknown;
};

export async function callInternalTool(tool: string, args: Record<string, unknown>) {
  const endpoint = `${webAppUrl().replace(/\/$/, "")}/api/internal/mcp/tools`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mcp-internal-token": mcpInternalApiToken()
    },
    body: JSON.stringify({ tool, args }),
    signal: AbortSignal.timeout(requestTimeoutMs())
  });
  const text = await response.text();
  const body = text ? parseJson(text) : null;

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Internal MCP tool API returned HTTP ${response.status}.`;
    throw new Error(message);
  }

  return body as InternalToolResult;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
