import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectHealth: vi.fn()
}));

vi.mock("@/lib/health", () => ({
  collectHealth: mocks.collectHealth
}));

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 503 when dependency checks are degraded", async () => {
    mocks.collectHealth.mockResolvedValue({
      status: "degraded",
      service: "web",
      app: "revenue-brains",
      timestamp: "2026-05-06T00:00:00.000Z",
      uptimeSeconds: 1,
      checks: {
        process: { status: "ok", message: "Web process is running." },
        postgres: { status: "error", message: "Postgres query failed." },
        agent: { status: "ok", message: "Python agent health check succeeded." },
        qdrant: { status: "ok", message: "Qdrant service is reachable." },
        qdrantCollection: { status: "ok", message: "Qdrant collection exists." }
      }
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.postgres.status).toBe("error");
  });
});
