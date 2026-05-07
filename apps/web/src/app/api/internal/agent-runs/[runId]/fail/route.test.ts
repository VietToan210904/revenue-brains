import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  failAgentRun: vi.fn(),
  isAgentCallbackAuthorized: vi.fn()
}));

vi.mock("@/lib/agent-run-persistence", () => ({
  failAgentRun: mocks.failAgentRun,
  isAgentCallbackAuthorized: mocks.isAgentCallbackAuthorized
}));

import { POST } from "@/app/api/internal/agent-runs/[runId]/fail/route";

function makeContext(runId = "run_123") {
  return {
    params: Promise.resolve({ runId })
  };
}

describe("POST /api/internal/agent-runs/:runId/fail", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects callbacks without the agent secret", async () => {
    mocks.isAgentCallbackAuthorized.mockReturnValue(false);

    const response = await POST(
      new Request("http://localhost/api/internal/agent-runs/run_123/fail", {
        method: "POST",
        body: JSON.stringify({ errorMessage: "Failed safely." })
      }),
      makeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized agent callback.");
    expect(mocks.failAgentRun).not.toHaveBeenCalled();
  });

  it("rejects payloads without safe error text", async () => {
    mocks.isAgentCallbackAuthorized.mockReturnValue(true);

    const response = await POST(
      new Request("http://localhost/api/internal/agent-runs/run_123/fail", {
        method: "POST",
        body: JSON.stringify({})
      }),
      makeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Agent failure payload is missing errorMessage.");
    expect(mocks.failAgentRun).not.toHaveBeenCalled();
  });

  it("persists failed agent run callbacks", async () => {
    mocks.isAgentCallbackAuthorized.mockReturnValue(true);
    mocks.failAgentRun.mockResolvedValue({
      run: { id: "run_123", status: "FAILED" },
      assistantMessage: { id: "msg_assistant", content: "Failed safely." }
    });

    const payload = {
      errorMessage: "Failed safely.",
      agentName: "Autonomous Agent Team",
      metadata: { code: "missing_file" }
    };
    const response = await POST(
      new Request("http://localhost/api/internal/agent-runs/run_123/fail", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
      makeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.run.status).toBe("FAILED");
    expect(mocks.failAgentRun).toHaveBeenCalledWith("run_123", payload);
  });
});
