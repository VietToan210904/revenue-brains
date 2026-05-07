import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeAgentRun: vi.fn(),
  isAgentCallbackAuthorized: vi.fn()
}));

vi.mock("@/lib/agent-run-persistence", () => ({
  completeAgentRun: mocks.completeAgentRun,
  isAgentCallbackAuthorized: mocks.isAgentCallbackAuthorized
}));

import { POST } from "@/app/api/internal/agent-runs/[runId]/complete/route";

function makeContext(runId = "run_123") {
  return {
    params: Promise.resolve({ runId })
  };
}

describe("POST /api/internal/agent-runs/:runId/complete", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects callbacks without the agent secret", async () => {
    mocks.isAgentCallbackAuthorized.mockReturnValue(false);

    const response = await POST(
      new Request("http://localhost/api/internal/agent-runs/run_123/complete", {
        method: "POST",
        body: JSON.stringify({})
      }),
      makeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized agent callback.");
    expect(mocks.completeAgentRun).not.toHaveBeenCalled();
  });

  it("rejects incomplete completion payloads", async () => {
    mocks.isAgentCallbackAuthorized.mockReturnValue(true);

    const response = await POST(
      new Request("http://localhost/api/internal/agent-runs/run_123/complete", {
        method: "POST",
        body: JSON.stringify({ status: "completed" })
      }),
      makeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Agent completion payload is missing required fields.");
    expect(mocks.completeAgentRun).not.toHaveBeenCalled();
  });

  it("persists successful agent completion callbacks", async () => {
    mocks.isAgentCallbackAuthorized.mockReturnValue(true);
    mocks.completeAgentRun.mockResolvedValue({
      run: { id: "run_123", status: "COMPLETED" },
      assistantMessage: { id: "msg_assistant", content: "Done." }
    });

    const payload = {
      status: "completed",
      intent: "answer_question",
      automationDecision: "safe_to_save",
      reply: "Done.",
      toolActions: [],
      extractions: []
    };
    const response = await POST(
      new Request("http://localhost/api/internal/agent-runs/run_123/complete", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
      makeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.run.status).toBe("COMPLETED");
    expect(mocks.completeAgentRun).toHaveBeenCalledWith("run_123", payload);
  });
});
