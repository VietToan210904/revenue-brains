import { collectHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const health = await collectHealth();

  return Response.json(health, {
    status: health.status === "ok" ? 200 : 503
  });
}
