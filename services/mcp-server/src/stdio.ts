import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createRevenueBrainsMcpServer } from "./server.js";

async function main() {
  const server = createRevenueBrainsMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Revenue Brains MCP stdio server failed.", error);
  process.exit(1);
});
