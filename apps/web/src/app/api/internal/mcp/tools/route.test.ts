import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeMcpTool: vi.fn(),
  isMcpInternalRequestAuthorized: vi.fn()
}));

vi.mock("@/lib/mcp-tools", () => ({
  executeMcpTool: mocks.executeMcpTool,
  isMcpInternalRequestAuthorized: mocks.isMcpInternalRequestAuthorized,
  McpToolError: class McpToolError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  }
}));

import { POST } from "@/app/api/internal/mcp/tools/route";
import { McpToolError } from "@/lib/mcp-tools";

describe("POST /api/internal/mcp/tools", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests without the internal MCP token", async () => {
    mocks.isMcpInternalRequestAuthorized.mockReturnValue(false);

    const response = await POST(
      new Request("http://localhost/api/internal/mcp/tools", {
        method: "POST",
        body: JSON.stringify({ tool: "get_workspace_summary", args: {} })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized MCP internal tool request.");
    expect(mocks.executeMcpTool).not.toHaveBeenCalled();
  });

  it("executes authorized tool requests", async () => {
    mocks.isMcpInternalRequestAuthorized.mockReturnValue(true);
    mocks.executeMcpTool.mockResolvedValue({
      workspace: { id: "workspace_123" }
    });

    const response = await POST(
      new Request("http://localhost/api/internal/mcp/tools", {
        method: "POST",
        body: JSON.stringify({ tool: "get_workspace_summary", args: {} })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      tool: "get_workspace_summary",
      result: {
        workspace: { id: "workspace_123" }
      }
    });
    expect(mocks.executeMcpTool).toHaveBeenCalledWith("get_workspace_summary", {});
  });

  it("returns safe tool errors", async () => {
    mocks.isMcpInternalRequestAuthorized.mockReturnValue(true);
    mocks.executeMcpTool.mockRejectedValue(new McpToolError("No raw SQL tools.", 400));

    const response = await POST(
      new Request("http://localhost/api/internal/mcp/tools", {
        method: "POST",
        body: JSON.stringify({ tool: "raw_sql", args: {} })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("No raw SQL tools.");
  });
});
