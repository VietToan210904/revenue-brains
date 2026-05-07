import { loadLocalEnv } from "./local-env.js";

loadLocalEnv();

export function mcpServerToken() {
  return process.env.MCP_SERVER_TOKEN ?? "change-me-local-mcp-token";
}

export function mcpInternalApiToken() {
  return process.env.MCP_INTERNAL_API_TOKEN ?? "change-me-internal-mcp-token";
}

export function webAppUrl() {
  return process.env.MCP_WEB_APP_URL ?? process.env.AGENT_CALLBACK_BASE_URL ?? "http://localhost:3000";
}

export function mcpPort() {
  const parsed = Number.parseInt(process.env.MCP_PORT ?? "8787", 10);
  return Number.isFinite(parsed) ? parsed : 8787;
}

export function requestTimeoutMs() {
  const parsed = Number.parseInt(process.env.MCP_REQUEST_TIMEOUT_MS ?? "8000", 10);
  return Number.isFinite(parsed) ? parsed : 8000;
}
