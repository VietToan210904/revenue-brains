import asyncio
import os
import threading
from typing import Any

from app.schemas import AgentAttachmentPayload

MCP_EXACT_RECORD_TOOLS = {
    "get_workspace_summary",
    "search_documents",
    "get_document_metadata",
    "get_processing_job",
    "search_extracted_records",
    "get_extracted_record",
    "get_agent_run",
    "get_vector_references",
    "list_webhook_sync_attempts",
}


def is_mcp_client_enabled() -> bool:
    return os.getenv("MCP_CLIENT_ENABLED", "false").lower() in {"1", "true", "yes", "on"}


def default_mcp_tool_names() -> list[str]:
    return sorted(MCP_EXACT_RECORD_TOOLS)


def list_mcp_tools() -> list[dict[str, Any]]:
    if not is_mcp_client_enabled():
        return []

    try:
        return run_async(_list_mcp_tools_async())
    except Exception:
        return []


def plan_mcp_tool_calls(
    *,
    workspace_id: str,
    intent: str,
    question: str,
    attachments: list[AgentAttachmentPayload],
    agent_run_id: str,
) -> list[dict[str, Any]]:
    if not is_mcp_client_enabled():
        return []

    available_tools = {
        tool["name"] for tool in list_mcp_tools() if isinstance(tool.get("name"), str)
    }
    if not available_tools:
        available_tools = set(default_mcp_tool_names())

    planned: list[dict[str, Any]] = []

    def add_tool(tool_name: str, arguments: dict[str, Any], reason: str) -> None:
        if tool_name not in available_tools:
            return
        planned.append(
            {
                "tool": tool_name,
                "arguments": arguments,
                "reason": reason,
            }
        )

    if intent in {"answer_question", "ingest_and_answer"}:
        add_tool(
            "search_extracted_records",
            {
                "workspaceId": workspace_id,
                "query": question,
                "limit": 5,
            },
            "Q&A needs exact structured records from Postgres.",
        )

    for attachment in attachments[:3]:
        add_tool(
            "get_document_metadata",
            {
                "workspaceId": workspace_id,
                "documentId": attachment.document_id,
            },
            "The agent should inspect attached document metadata through MCP.",
        )

    if intent in {"answer_question", "ingest_and_answer"} and "webhook" in question.lower():
        add_tool(
            "list_webhook_sync_attempts",
            {
                "workspaceId": workspace_id,
                "limit": 5,
            },
            "The question appears to ask about webhook sync state.",
        )

    if agent_run_id:
        add_tool(
            "get_agent_run",
            {
                "workspaceId": workspace_id,
                "agentRunId": agent_run_id,
            },
            "The agent can inspect the current run state through MCP.",
        )

    return planned


def execute_mcp_tool_plan(planned_calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for planned_call in planned_calls:
        tool_name = str(planned_call.get("tool", ""))
        arguments = planned_call.get("arguments")
        if not tool_name or not isinstance(arguments, dict):
            continue

        result = call_mcp_tool(tool_name, arguments)
        results.append(
            {
                "tool": tool_name,
                "arguments": safe_mcp_arguments(arguments),
                "reason": planned_call.get("reason"),
                "status": "completed" if result is not None else "failed",
                "result": result,
                "summary": summarize_mcp_result(tool_name, result),
            }
        )

    return results


def mcp_results_to_postgres_evidence(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    for result in results:
        if result.get("status") != "completed":
            continue

        payload = result.get("result")
        if not isinstance(payload, dict):
            continue

        tool_name = str(result.get("tool", "mcp_tool"))
        records = payload.get("records")
        if isinstance(records, list):
            evidence.extend(
                {
                    "source": "mcp",
                    "tool": tool_name,
                    **record,
                }
                for record in records
                if isinstance(record, dict)
            )
            continue

        for key in ("record", "document", "job", "agentRun", "vectorReferences", "attempts"):
            value = payload.get(key)
            if value:
                evidence.append(
                    {
                        "source": "mcp",
                        "tool": tool_name,
                        key: value,
                    }
                )

    return evidence


def get_mcp_postgres_evidence(workspace_id: str, question: str) -> list[dict[str, Any]]:
    planned_calls = plan_mcp_tool_calls(
        workspace_id=workspace_id,
        intent="answer_question",
        question=question,
        attachments=[],
        agent_run_id="",
    )
    return mcp_results_to_postgres_evidence(execute_mcp_tool_plan(planned_calls))


def safe_mcp_arguments(arguments: dict[str, Any]) -> dict[str, Any]:
    safe: dict[str, Any] = {}
    for key, value in arguments.items():
        if key.lower() in {"password", "secret", "token", "apikey", "api_key"}:
            safe[key] = "[redacted]"
        else:
            safe[key] = value
    return safe


def summarize_mcp_result(tool_name: str, result: dict[str, Any] | None) -> str:
    if result is None:
        return f"{tool_name} did not return usable MCP evidence."

    if "records" in result and isinstance(result["records"], list):
        return f"{tool_name} returned {len(result['records'])} extracted record(s)."
    if "documents" in result and isinstance(result["documents"], list):
        return f"{tool_name} returned {len(result['documents'])} document(s)."
    if "attempts" in result and isinstance(result["attempts"], list):
        return f"{tool_name} returned {len(result['attempts'])} webhook attempt(s)."
    if "vectorReferences" in result and isinstance(result["vectorReferences"], list):
        return f"{tool_name} returned {len(result['vectorReferences'])} vector reference(s)."

    return f"{tool_name} returned structured MCP evidence."


def call_mcp_tool(tool_name: str, arguments: dict[str, Any]) -> dict[str, Any] | None:
    if not is_mcp_client_enabled():
        return None

    try:
        return run_async(_call_mcp_tool_async(tool_name, arguments))
    except Exception:
        return None


async def _call_mcp_tool_async(tool_name: str, arguments: dict[str, Any]) -> dict[str, Any] | None:
    import httpx
    from mcp import ClientSession, types
    from mcp.client.streamable_http import streamable_http_client

    mcp_server_url = os.getenv("MCP_SERVER_URL", "http://localhost:8787/mcp")
    mcp_server_token = os.getenv("MCP_SERVER_TOKEN", "change-me-local-mcp-token")
    timeout_ms = int(os.getenv("MCP_REQUEST_TIMEOUT_MS", "8000"))

    async with httpx.AsyncClient(
        headers={"Authorization": f"Bearer {mcp_server_token}"},
        timeout=timeout_ms / 1000,
    ) as http_client:
        async with streamable_http_client(
            mcp_server_url,
            http_client=http_client,
        ) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                result = await session.call_tool(tool_name, arguments=arguments)
                structured_content = getattr(result, "structuredContent", None) or getattr(
                    result,
                    "structured_content",
                    None,
                )
                if isinstance(structured_content, dict):
                    return structured_content

                for content in result.content:
                    if isinstance(content, types.TextContent):
                        return {"text": content.text}

    return None


async def _list_mcp_tools_async() -> list[dict[str, Any]]:
    import httpx
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    mcp_server_url = os.getenv("MCP_SERVER_URL", "http://localhost:8787/mcp")
    mcp_server_token = os.getenv("MCP_SERVER_TOKEN", "change-me-local-mcp-token")
    timeout_ms = int(os.getenv("MCP_REQUEST_TIMEOUT_MS", "8000"))

    async with httpx.AsyncClient(
        headers={"Authorization": f"Bearer {mcp_server_token}"},
        timeout=timeout_ms / 1000,
    ) as http_client:
        async with streamable_http_client(
            mcp_server_url,
            http_client=http_client,
        ) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                result = await session.list_tools()
                return [
                    {
                        "name": tool.name,
                        "description": tool.description,
                    }
                    for tool in result.tools
                ]


def run_async(coro):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    result: dict[str, Any] | list[dict[str, Any]] | None = None
    error: BaseException | None = None

    def runner() -> None:
        nonlocal result, error
        try:
            result = asyncio.run(coro)
        except BaseException as exc:  # noqa: BLE001
            error = exc

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    thread.join()

    if error:
        raise error
    return result
