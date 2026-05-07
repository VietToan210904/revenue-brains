import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { type Request, type Response } from "express";
import express from "express";

import { isAuthorizedHeader } from "./auth.js";
import { mcpPort } from "./config.js";
import { createRevenueBrainsMcpServer } from "./server.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const transports: Record<string, StreamableHTTPServerTransport> = {};

function requireBearerToken(req: Request, res: Response) {
  if (isAuthorizedHeader(req.headers.authorization)) {
    return true;
  }

  res.status(401).json({
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message: "Unauthorized MCP request."
    },
    id: null
  });
  return false;
}

app.get("/health", (_req, res) => {
  res.json({
    service: "revenue-brains-mcp-server",
    status: "ok"
  });
});

app.post("/mcp", async (req: Request, res: Response) => {
  if (!requireBearerToken(req, res)) {
    return;
  }

  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (initializedSessionId) => {
          transports[initializedSessionId] = transport;
        }
      });
      transport.onclose = () => {
        const closedSessionId = transport.sessionId;
        if (closedSessionId) {
          delete transports[closedSessionId];
        }
      };

      const server = createRevenueBrainsMcpServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad request: initialize first or provide a valid MCP session ID."
        },
        id: null
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Revenue Brains MCP HTTP request failed.", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal MCP server error."
        },
        id: null
      });
    }
  }
});

app.get("/mcp", async (req: Request, res: Response) => {
  if (!requireBearerToken(req, res)) {
    return;
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports[sessionId] : null;
  if (!transport) {
    res.status(400).send("Invalid or missing MCP session ID.");
    return;
  }

  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req: Request, res: Response) => {
  if (!requireBearerToken(req, res)) {
    return;
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports[sessionId] : null;
  if (!transport) {
    res.status(400).send("Invalid or missing MCP session ID.");
    return;
  }

  await transport.handleRequest(req, res);
});

const server = app.listen(mcpPort(), () => {
  console.log(`Revenue Brains MCP server listening at http://localhost:${mcpPort()}/mcp`);
});

process.on("SIGINT", async () => {
  for (const transport of Object.values(transports)) {
    await transport.close();
  }
  server.close(() => process.exit(0));
});
