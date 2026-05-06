import { jsonError } from "@/lib/api";
import {
  completeAgentRun,
  isAgentCallbackAuthorized,
  type AgentRunCompletePayload
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
  const payload = (await request.json()) as AgentRunCompletePayload;

  if (!payload.status || !payload.intent || !payload.automationDecision || !payload.reply) {
    return jsonError("Agent completion payload is missing required fields.", 400);
  }

  const result = await completeAgentRun(runId, payload);
  return Response.json(result);
}
