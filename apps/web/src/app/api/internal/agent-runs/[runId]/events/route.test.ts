import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAgentCallbackAuthorized: vi.fn(),
  persistAgentRunEvent: vi.fn()
}));

vi.mock("@/lib/agent-run-persistence", () => ({
  isAgentCallbackAuthorized: mocks.isAgentCallbackAuthorized,
  persistAgentRunEvent: mocks.persistAgentRunEvent
}));

import { POST } from "@/app/api/internal/agent-runs/[runId]/events/route";

function makeContext(runId = "run_123") {
  return {
    params: Promise.resolve({ runId })
  };
}

describe("POST /api/internal/agent-runs/:runId/events", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects callbacks without the agent secret", async () => {
    mocks.isAgentCallbackAuthorized.mockReturnValue(false);

    const response = await POST(
      new Request("http://localhost/api/internal/agent-runs/run_123/events", {
        method: "POST",
        body: JSON.stringify({
          agentName: "Manager Agent",
          action: "plan",
          status: "completed"
        })
      }),
      makeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized agent callback.");
    expect(mocks.persistAgentRunEvent).not.toHaveBeenCalled();
  });

  it("persists ordered agent step events", async () => {
    mocks.isAgentCallbackAuthorized.mockReturnValue(true);
    mocks.persistAgentRunEvent.mockResolvedValue({
      run: { id: "run_123", status: "RUNNING" },
      step: { id: "step_1", agentName: "Manager Agent" }
    });

    const payload = {
      sequence: 1,
      agentName: "Manager Agent",
      action: "plan_and_delegate",
      status: "completed",
      outputSummary: "Intent: ingest_documents."
    };
    const response = await POST(
      new Request("http://localhost/api/internal/agent-runs/run_123/events", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
      makeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.step.agentName).toBe("Manager Agent");
    expect(mocks.persistAgentRunEvent).toHaveBeenCalledWith("run_123", payload);
  });
});
