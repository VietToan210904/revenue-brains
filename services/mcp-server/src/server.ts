import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerRevenueBrainsTools } from "./tools.js";

export function createRevenueBrainsMcpServer() {
  const server = new McpServer({
    name: "revenue-brains",
    version: "0.1.0"
  });

  registerRevenueBrainsTools(server);

  return server;
}
