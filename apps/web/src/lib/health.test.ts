import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw
  }
}));

vi.mock("@/lib/local-env", () => ({
  loadLocalEnv: vi.fn()
}));

import { collectHealth } from "@/lib/health";

describe("collectHealth", () => {
  beforeEach(() => {
    vi.stubEnv("PYTHON_AGENT_URL", "http://agent.local");
    vi.stubEnv("QDRANT_URL", "http://qdrant.local");
    vi.stubEnv("QDRANT_COLLECTION", "revenue_brains_documents");
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        const target = String(url);

        if (target === "http://agent.local/health") {
          return Promise.resolve(Response.json({ status: "ok" }));
        }

        if (target === "http://qdrant.local") {
          return Promise.resolve(Response.json({ status: "ok" }));
        }

        if (target === "http://qdrant.local/collections/revenue_brains_documents") {
          return Promise.resolve(Response.json({ result: { status: "green" } }));
        }

        return Promise.resolve(Response.json({ error: "unexpected" }, { status: 404 }));
      })
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reports ok when web dependencies are healthy", async () => {
    const health = await collectHealth();

    expect(health.status).toBe("ok");
    expect(health.checks.postgres.status).toBe("ok");
    expect(health.checks.agent.status).toBe("ok");
    expect(health.checks.qdrant.status).toBe("ok");
    expect(health.checks.qdrantCollection.status).toBe("ok");
  });

  it("reports degraded when dependencies are unavailable", async () => {
    mocks.queryRaw.mockRejectedValue(new Error("database unavailable"));
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        const target = String(url);

        if (target.endsWith("/health")) {
          return Promise.reject(new Error("agent unavailable"));
        }

        if (target.includes("/collections/")) {
          return Promise.resolve(Response.json({ error: "missing" }, { status: 404 }));
        }

        return Promise.resolve(Response.json({ error: "offline" }, { status: 503 }));
      })
    );

    const health = await collectHealth();

    expect(health.status).toBe("degraded");
    expect(health.checks.postgres.status).toBe("error");
    expect(health.checks.agent.status).toBe("error");
    expect(health.checks.qdrant.status).toBe("error");
    expect(health.checks.qdrantCollection.status).toBe("degraded");
  });
});
