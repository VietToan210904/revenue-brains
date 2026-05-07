import { afterEach, describe, expect, it, vi } from "vitest";

import { isAuthorizedHeader } from "./auth.js";

describe("MCP bearer token auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the configured bearer token", () => {
    vi.stubEnv("MCP_SERVER_TOKEN", "local-token");

    expect(isAuthorizedHeader("Bearer local-token")).toBe(true);
  });

  it("rejects missing or invalid tokens", () => {
    vi.stubEnv("MCP_SERVER_TOKEN", "local-token");

    expect(isAuthorizedHeader(undefined)).toBe(false);
    expect(isAuthorizedHeader("Bearer nope")).toBe(false);
  });
});
