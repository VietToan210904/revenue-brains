import { jsonError } from "@/lib/api";
import {
  failAgentRun,
  isAgentCallbackAuthorized,
  type AgentRunFailPayload
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
  const payload = (await request.json()) as AgentRunFailPayload;

  if (!payload.errorMessage) {
    return jsonError("Agent failure payload is missing errorMessage.", 400);
  }

  const result = await failAgentRun(runId, payload);
  return Response.json(result);
}
