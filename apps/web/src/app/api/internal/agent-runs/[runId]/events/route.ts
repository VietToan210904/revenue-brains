import { jsonError } from "@/lib/api";
import {
  isAgentCallbackAuthorized,
  persistAgentRunEvent,
  type AgentStepEventPayload
} from "@/lib/agent-run-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    runId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  if (!isAgentCallbackAuthorized(request)) {
    return jsonError("Unauthorized agent callback.", 401);
  }

  const { runId } = await context.params;
  const payload = (await request.json()) as AgentStepEventPayload;

  if (!payload.agentName || !payload.action || !payload.status) {
    return jsonError("Agent event is missing agentName, action, or status.", 400);
  }

  const result = await persistAgentRunEvent(runId, payload);
  return Response.json(result, { status: 201 });
}
