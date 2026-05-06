import os
from typing import Any, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from openai import (
    APIConnectionError,
    APIStatusError,
    AuthenticationError,
    BadRequestError,
    RateLimitError,
)
from pydantic import BaseModel, ConfigDict, Field

from app.agents.ingestion_graph import run_ingestion_graph
from app.agents.qa_graph import run_qa_answer_graph, run_qa_plan_graph
from app.errors import DocumentProcessingError
from app.schemas import (
    AgentRespondRequest,
    AgentRespondResponse,
    DocumentProcessRequest,
    DocumentProcessResponse,
    QaAnswerRequest,
    QaAnswerResponse,
    QaPlanRequest,
    SupervisorToolActionPayload,
)

SUPERVISOR_PLAN_SCHEMA: dict[str, Any] = {
    "title": "SupervisorPlan",
    "description": "Agent supervisor decision for a Revenue Brains chat request.",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "intent",
        "question",
        "reasoning",
        "clarificationQuestion",
        "unsupportedReason",
    ],
    "properties": {
        "intent": {
            "type": "string",
            "enum": [
                "ingest_documents",
                "answer_question",
                "ingest_and_answer",
                "clarify",
                "unsupported",
            ],
        },
        "question": {"type": ["string", "null"]},
        "reasoning": {"type": "string"},
        "clarificationQuestion": {"type": ["string", "null"]},
        "unsupportedReason": {"type": ["string", "null"]},
    },
}


class SupervisorPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    intent: str
    question: str | None = None
    reasoning: str
    clarification_question: str | None = Field(default=None, alias="clarificationQuestion")
    unsupported_reason: str | None = Field(default=None, alias="unsupportedReason")


class SupervisorState(TypedDict, total=False):
    request: AgentRespondRequest
    plan: SupervisorPlan
    tool_actions: list[SupervisorToolActionPayload]
    extractions: list[DocumentProcessResponse]
    qa_answer: QaAnswerResponse
    response: AgentRespondResponse


def get_supervisor_model() -> ChatOpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise DocumentProcessingError(
            "model_not_configured",
            "OPENAI_API_KEY is required for supervisor planning.",
            status_code=503,
        )

    return ChatOpenAI(
        api_key=api_key,
        model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        temperature=0,
    )


def plan_with_model(request: AgentRespondRequest) -> SupervisorPlan:
    attachment_filenames = [item.original_filename for item in request.attachments]
    planner = get_supervisor_model().with_structured_output(
        SUPERVISOR_PLAN_SCHEMA,
        method="json_schema",
        strict=True,
    )
    result = invoke_supervisor_model_safely(
        planner,
        [
            SystemMessage(
                content=(
                    "You are the Revenue Brains supervisor agent. Decide which controlled "
                    "tools are needed for the employee request. Use ingest_documents when "
                    "attachments only need processing. Use answer_question for text-only "
                    "company-memory questions. Use ingest_and_answer when attachments and the "
                    "message ask for an answer about the attached document. Use clarify only "
                    "when the request is too ambiguous to act safely. Use unsupported for "
                    "requests outside the MVP such as OCR, CSV/XLSX, email imports, webhooks, "
                    "MCP, external connector sync, auth, billing, or production deployment."
                )
            ),
            HumanMessage(
                content=(
                    f"Workspace ID: {request.workspace_id}\n"
                    f"Conversation ID: {request.conversation_id}\n"
                    f"User message: {request.user_message}\n"
                    f"User instructions: {request.user_instructions or 'none'}\n"
                    f"Attachment count: {len(request.attachments)}\n"
                    f"Attachment filenames: {attachment_filenames}\n"
                    f"Postgres evidence count: {len(request.postgres_evidence)}"
                )
            ),
        ],
    )
    return result if isinstance(result, SupervisorPlan) else SupervisorPlan.model_validate(result)


def invoke_supervisor_model_safely(model: Any, messages: list[Any]) -> Any:
    try:
        return model.invoke(messages)
    except BadRequestError as exc:
        raise supervisor_error(
            "supervisor_model_request_failed",
            "Supervisor model request failed: structured schema rejected.",
            502,
            exc,
        ) from exc
    except AuthenticationError as exc:
        raise supervisor_error(
            "supervisor_model_auth_failed",
            "Supervisor model authentication failed. Check OPENAI_API_KEY.",
            503,
            exc,
        ) from exc
    except RateLimitError as exc:
        raise supervisor_error(
            "supervisor_model_rate_limited",
            "Supervisor model request was rate limited.",
            429,
            exc,
        ) from exc
    except APIConnectionError as exc:
        raise supervisor_error(
            "supervisor_model_connection_failed",
            "Supervisor model could not be reached.",
            503,
            exc,
        ) from exc
    except APIStatusError as exc:
        raise supervisor_error(
            "supervisor_model_provider_failed",
            "Supervisor model provider returned an error.",
            502,
            exc,
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise supervisor_error(
            "supervisor_model_failed",
            "Supervisor model failed unexpectedly.",
            502,
            exc,
        ) from exc


def supervisor_error(
    code: str,
    message: str,
    status_code: int,
    exc: Exception,
) -> DocumentProcessingError:
    provider_status_code = getattr(exc, "status_code", None)
    details: dict[str, Any] = {}
    if provider_status_code is not None:
        details["providerStatusCode"] = provider_status_code
    return DocumentProcessingError(code, message, status_code=status_code, details=details)


def plan_with_heuristics(request: AgentRespondRequest) -> SupervisorPlan:
    message = request.user_message.strip()
    lower_message = message.lower()
    has_attachments = bool(request.attachments)
    unsupported_terms = [
        "ocr",
        "scan",
        "scanned",
        "csv",
        "xlsx",
        "spreadsheet",
        "google drive",
        "gmail",
        "email import",
        "webhook",
        "sync to",
        "mcp",
        "authentication",
        "billing",
    ]

    if any(term in lower_message for term in unsupported_terms):
        return SupervisorPlan(
            intent="unsupported",
            question=None,
            reasoning="The request asks for behavior outside the current MVP tool surface.",
            clarificationQuestion=None,
            unsupportedReason="That automation is outside the current local MVP scope.",
        )

    if not has_attachments and len(message.split()) <= 2:
        return SupervisorPlan(
            intent="clarify",
            question=None,
            reasoning="The request is too short to determine an action safely.",
            clarificationQuestion="What would you like me to find or process?",
            unsupportedReason=None,
        )

    if has_attachments and looks_like_question(message):
        return SupervisorPlan(
            intent="ingest_and_answer",
            question=message,
            reasoning="The request includes attachments and asks for an answer.",
            clarificationQuestion=None,
            unsupportedReason=None,
        )

    if has_attachments:
        return SupervisorPlan(
            intent="ingest_documents",
            question=None,
            reasoning="The request includes attachments that should be processed.",
            clarificationQuestion=None,
            unsupportedReason=None,
        )

    return SupervisorPlan(
        intent="answer_question",
        question=message,
        reasoning="The request is a text-only company-memory question.",
        clarificationQuestion=None,
        unsupportedReason=None,
    )


def looks_like_question(message: str) -> bool:
    lower_message = message.lower().strip()
    question_terms = [
        "?",
        "what",
        "when",
        "where",
        "who",
        "which",
        "why",
        "how",
        "tell me",
        "find",
        "summarize",
    ]
    return any(term in lower_message for term in question_terms)


def should_use_heuristic_supervisor(request: AgentRespondRequest) -> bool:
    mode = str(request.processing_options.get("supervisorMode", "")).lower()
    return mode == "heuristic"


def plan_request_node(state: SupervisorState) -> SupervisorState:
    request = state["request"]
    plan = (
        plan_with_heuristics(request)
        if should_use_heuristic_supervisor(request)
        else plan_with_model(request)
    )
    return {
        "plan": plan,
        "tool_actions": [
            SupervisorToolActionPayload(
                tool="supervisor_planner",
                status="completed",
                summary=plan.reasoning,
            )
        ],
    }


def run_ingestion_tools_node(state: SupervisorState) -> SupervisorState:
    request = state["request"]
    plan = state["plan"]
    actions = list(state.get("tool_actions", []))

    if plan.intent not in {"ingest_documents", "ingest_and_answer"}:
        return {"extractions": [], "tool_actions": actions}

    extractions = []
    for attachment in request.attachments:
        extraction = run_ingestion_graph(
            DocumentProcessRequest(
                conversationId=request.conversation_id,
                messageId=request.message_id,
                documentId=attachment.document_id,
                workspaceId=request.workspace_id,
                fileStorageKey=attachment.file_storage_key,
                checksum=attachment.checksum,
                originalFilename=attachment.original_filename,
                contentType=attachment.content_type,
                userInstructions=request.user_instructions,
                processingOptions=request.processing_options,
            )
        )
        extractions.append(extraction)

    actions.append(
        SupervisorToolActionPayload(
            tool="document_ingestion",
            status="completed",
            summary=f"Processed {len(extractions)} attached document(s).",
        )
    )
    return {"extractions": extractions, "tool_actions": actions}


def run_qa_tools_node(state: SupervisorState) -> SupervisorState:
    request = state["request"]
    plan = state["plan"]
    actions = list(state.get("tool_actions", []))
    extractions = state.get("extractions", [])

    if plan.intent not in {"answer_question", "ingest_and_answer"}:
        return {"tool_actions": actions}

    question = plan.question or request.user_message
    qa_plan = run_qa_plan_graph(
        QaPlanRequest(
            workspaceId=request.workspace_id,
            conversationId=request.conversation_id,
            question=question,
            filters={},
        )
    )
    actions.append(
        SupervisorToolActionPayload(
            tool="qa_plan",
            status="completed",
            summary=f"Planned {qa_plan.retrieval_mode} retrieval.",
        )
    )

    postgres_evidence = [
        *request.postgres_evidence,
        *[extraction.model_dump(by_alias=True) for extraction in extractions],
    ]
    answer = run_qa_answer_graph(
        QaAnswerRequest(
            workspaceId=request.workspace_id,
            conversationId=request.conversation_id,
            question=question,
            retrievalMode=qa_plan.retrieval_mode,
            postgresEvidence=postgres_evidence,
            qdrantContext=[],
        )
    )
    actions.append(
        SupervisorToolActionPayload(
            tool="qa_answer",
            status="completed",
            summary="Generated an answer from available company evidence.",
        )
    )
    return {"qa_answer": answer, "tool_actions": actions}


def finalize_response_node(state: SupervisorState) -> SupervisorState:
    request = state["request"]
    plan = state["plan"]
    actions = list(state.get("tool_actions", []))
    extractions = state.get("extractions", [])
    qa_answer = state.get("qa_answer")

    if plan.intent == "clarify":
        reply = plan.clarification_question or "Can you clarify what you want me to do?"
        actions.append(
            SupervisorToolActionPayload(
                tool="clarification",
                status="completed",
                summary=reply,
            )
        )
        return {
            "response": AgentRespondResponse(
                status="needs_clarification",
                intent="clarify",
                toolActions=actions,
                extractions=[],
                qaAnswer=None,
                automationDecision="needs_clarification",
                reply=reply,
            )
        }

    if plan.intent == "unsupported":
        reply = plan.unsupported_reason or "That request is outside the current MVP scope."
        actions.append(
            SupervisorToolActionPayload(
                tool="unsupported",
                status="completed",
                summary=reply,
            )
        )
        return {
            "response": AgentRespondResponse(
                status="unsupported",
                intent="unsupported",
                toolActions=actions,
                extractions=[],
                qaAnswer=None,
                automationDecision="unsupported",
                reply=reply,
            )
        }

    automation_decision = decide_automation(extractions)
    reply = build_reply(plan.intent, extractions, qa_answer, request.user_message)
    return {
        "response": AgentRespondResponse(
            status="completed",
            intent=plan.intent,
            toolActions=actions,
            extractions=extractions,
            qaAnswer=qa_answer,
            automationDecision=automation_decision,
            reply=reply,
        )
    }


def decide_automation(extractions: list[DocumentProcessResponse]) -> str:
    if not extractions:
        return "safe_to_save"
    needs_review = any(
        extraction.agent_assessment.automation_decision == "save_for_review"
        for extraction in extractions
    )
    if needs_review:
        return "save_for_review"
    return "safe_to_save"


def build_reply(
    intent: str,
    extractions: list[DocumentProcessResponse],
    qa_answer: QaAnswerResponse | None,
    user_message: str,
) -> str:
    if intent == "answer_question" and qa_answer:
        return qa_answer.answer

    if intent == "ingest_and_answer" and qa_answer:
        prefix = extraction_summary(extractions)
        return f"{prefix}\n\n{qa_answer.answer}" if prefix else qa_answer.answer

    if extractions:
        return "\n\n".join(extraction.chat_reply for extraction in extractions)

    return f"I reviewed your request: {user_message}"


def extraction_summary(extractions: list[DocumentProcessResponse]) -> str:
    if not extractions:
        return ""
    if len(extractions) == 1:
        extraction = extractions[0]
        return (
            f"Processed {extraction.title} as {extraction.document_type} "
            f"with {round(extraction.document_confidence * 100)}% confidence."
        )
    return f"Processed {len(extractions)} attached documents."


def build_supervisor_graph():
    graph = StateGraph(SupervisorState)
    graph.add_node("plan_request", plan_request_node)
    graph.add_node("run_ingestion_tools", run_ingestion_tools_node)
    graph.add_node("run_qa_tools", run_qa_tools_node)
    graph.add_node("finalize_response", finalize_response_node)

    graph.add_edge(START, "plan_request")
    graph.add_edge("plan_request", "run_ingestion_tools")
    graph.add_edge("run_ingestion_tools", "run_qa_tools")
    graph.add_edge("run_qa_tools", "finalize_response")
    graph.add_edge("finalize_response", END)
    return graph.compile()


SUPERVISOR_GRAPH = build_supervisor_graph()


def run_supervisor_graph(request: AgentRespondRequest) -> AgentRespondResponse:
    final_state = SUPERVISOR_GRAPH.invoke({"request": request})
    return final_state["response"]
