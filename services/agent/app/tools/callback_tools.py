import json
import os
import urllib.error
import urllib.request
from typing import Any

from app.errors import DocumentProcessingError


def callback_secret() -> str:
    return os.getenv("AGENT_CALLBACK_SECRET", "change-me-agent-callback-secret")


def post_agent_callback(
    *,
    callback_base_url: str,
    agent_run_id: str,
    endpoint: str,
    payload: dict[str, Any],
) -> None:
    url = (
        f"{callback_base_url.rstrip('/')}/api/internal/agent-runs/"
        f"{agent_run_id}/{endpoint.lstrip('/')}"
    )
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "content-type": "application/json",
            "x-agent-callback-secret": callback_secret(),
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
            if response.status >= 400:
                raise DocumentProcessingError(
                    "agent_callback_failed",
                    "Agent callback was rejected by the web service.",
                    status_code=502,
                    details={"callbackStatusCode": response.status},
                )
    except urllib.error.HTTPError as exc:
        raise DocumentProcessingError(
            "agent_callback_failed",
            "Agent callback was rejected by the web service.",
            status_code=502,
            details={"callbackStatusCode": exc.code},
        ) from exc
    except urllib.error.URLError as exc:
        raise DocumentProcessingError(
            "agent_callback_unreachable",
            "Agent callback web service could not be reached.",
            status_code=503,
        ) from exc


def emit_agent_step(
    *,
    callback_base_url: str,
    agent_run_id: str,
    sequence: int,
    agent_name: str,
    action: str,
    status: str,
    input_summary: str | None = None,
    output_summary: str | None = None,
    confidence: float | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    payload: dict[str, Any] = {
        "sequence": sequence,
        "agentName": agent_name,
        "action": action,
        "status": status,
        "inputSummary": input_summary,
        "outputSummary": output_summary,
        "confidence": confidence,
        "metadata": metadata or {},
    }
    post_agent_callback(
        callback_base_url=callback_base_url,
        agent_run_id=agent_run_id,
        endpoint="events",
        payload=payload,
    )


def complete_agent_run_callback(
    *,
    callback_base_url: str,
    agent_run_id: str,
    payload: dict[str, Any],
) -> None:
    post_agent_callback(
        callback_base_url=callback_base_url,
        agent_run_id=agent_run_id,
        endpoint="complete",
        payload=payload,
    )


def fail_agent_run_callback(
    *,
    callback_base_url: str,
    agent_run_id: str,
    error_message: str,
    agent_name: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    post_agent_callback(
        callback_base_url=callback_base_url,
        agent_run_id=agent_run_id,
        endpoint="fail",
        payload={
            "errorMessage": error_message,
            "agentName": agent_name,
            "metadata": metadata or {},
        },
    )
