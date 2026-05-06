import { prisma } from "@/lib/db";
import { loadLocalEnv } from "@/lib/local-env";

export type HealthStatus = "ok" | "degraded" | "error";

export type HealthCheck = {
  status: HealthStatus;
  message: string;
  durationMs?: number;
};

export type HealthResponse = {
  status: HealthStatus;
  service: "web";
  app: "revenue-brains";
  timestamp: string;
  uptimeSeconds: number;
  checks: {
    process: HealthCheck;
    postgres: HealthCheck;
    agent: HealthCheck;
    qdrant: HealthCheck;
    qdrantCollection: HealthCheck;
  };
};

const defaultAgentUrl = "http://localhost:8000";
const defaultQdrantUrl = "http://localhost:6333";
const defaultQdrantCollection = "revenue_brains_documents";

function durationSince(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function checkFromError(error: unknown, fallbackMessage: string, startedAt: number): HealthCheck {
  const message = error instanceof Error && error.message ? error.message : fallbackMessage;

  return {
    status: "error",
    message,
    durationMs: durationSince(startedAt)
  };
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

async function checkPostgres(): Promise<HealthCheck> {
  const startedAt = performance.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: "ok",
      message: "Postgres query succeeded.",
      durationMs: durationSince(startedAt)
    };
  } catch (error) {
    return checkFromError(error, "Postgres query failed.", startedAt);
  }
}

async function checkAgent(agentUrl: string): Promise<HealthCheck> {
  const startedAt = performance.now();

  try {
    const response = await fetch(`${normalizeBaseUrl(agentUrl)}/health`, {
      signal: AbortSignal.timeout(3_000)
    });

    return {
      status: response.ok ? "ok" : "error",
      message: response.ok
        ? "Python agent health check succeeded."
        : `Python agent returned HTTP ${response.status}.`,
      durationMs: durationSince(startedAt)
    };
  } catch (error) {
    return checkFromError(error, "Python agent health check failed.", startedAt);
  }
}

async function checkQdrant(qdrantUrl: string): Promise<HealthCheck> {
  const startedAt = performance.now();

  try {
    const response = await fetch(normalizeBaseUrl(qdrantUrl), {
      signal: AbortSignal.timeout(3_000)
    });

    return {
      status: response.ok ? "ok" : "error",
      message: response.ok
        ? "Qdrant service is reachable."
        : `Qdrant returned HTTP ${response.status}.`,
      durationMs: durationSince(startedAt)
    };
  } catch (error) {
    return checkFromError(error, "Qdrant service check failed.", startedAt);
  }
}

async function checkQdrantCollection(
  qdrantUrl: string,
  collectionName: string
): Promise<HealthCheck> {
  const startedAt = performance.now();

  try {
    const response = await fetch(
      `${normalizeBaseUrl(qdrantUrl)}/collections/${encodeURIComponent(collectionName)}`,
      {
        signal: AbortSignal.timeout(3_000)
      }
    );

    if (response.ok) {
      return {
        status: "ok",
        message: `Qdrant collection '${collectionName}' exists.`,
        durationMs: durationSince(startedAt)
      };
    }

    return {
      status: "degraded",
      message: `Qdrant collection '${collectionName}' is not ready; HTTP ${response.status}.`,
      durationMs: durationSince(startedAt)
    };
  } catch (error) {
    return checkFromError(error, "Qdrant collection check failed.", startedAt);
  }
}

function overallStatus(checks: HealthResponse["checks"]): HealthStatus {
  const dependencyStatuses = Object.values(checks).map((check) => check.status);

  if (dependencyStatuses.every((status) => status === "ok")) {
    return "ok";
  }

  return "degraded";
}

export async function collectHealth(): Promise<HealthResponse> {
  loadLocalEnv();

  const agentUrl = process.env.PYTHON_AGENT_URL ?? defaultAgentUrl;
  const qdrantUrl = process.env.QDRANT_URL ?? defaultQdrantUrl;
  const qdrantCollection = process.env.QDRANT_COLLECTION ?? defaultQdrantCollection;

  const [postgres, agent, qdrant, qdrantCollectionCheck] = await Promise.all([
    checkPostgres(),
    checkAgent(agentUrl),
    checkQdrant(qdrantUrl),
    checkQdrantCollection(qdrantUrl, qdrantCollection)
  ]);
  const checks = {
    process: {
      status: "ok",
      message: "Web process is running."
    },
    postgres,
    agent,
    qdrant,
    qdrantCollection: qdrantCollectionCheck
  } satisfies HealthResponse["checks"];

  return {
    status: overallStatus(checks),
    service: "web",
    app: "revenue-brains",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks
  };
}
