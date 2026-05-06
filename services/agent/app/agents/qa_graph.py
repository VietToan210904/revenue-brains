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

from app.errors import DocumentProcessingError
from app.schemas import QaAnswerRequest, QaAnswerResponse, QaPlanRequest, QaPlanResponse
from app.tools.vector_tools import retrieve_qdrant_context

QA_PLAN_SCHEMA: dict[str, Any] = {
    "title": "QaPlanResponse",
    "description": "Retrieval plan for answering a company-brain question.",
    "type": "object",
    "additionalProperties": False,
    "required": ["status", "retrievalMode", "postgresQuery", "qdrantQuery", "reasoning"],
    "properties": {
        "status": {"type": "string", "enum": ["planned"]},
        "retrievalMode": {"type": "string", "enum": ["postgres", "qdrant", "hybrid"]},
        "postgresQuery": {
            "type": "object",
            "additionalProperties": False,
            "required": ["intent", "documentTypes", "recordLimit"],
            "properties": {
                "intent": {"type": "string"},
                "documentTypes": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": [
                            "INVOICE",
                            "CONTRACT",
                            "PURCHASE_ORDER",
                            "RECEIPT_EXPENSE",
                            "KNOWLEDGE",
                            "UNKNOWN",
                        ],
                    },
                },
                "recordLimit": {"type": "integer", "minimum": 1, "maximum": 20},
            },
        },
        "qdrantQuery": {"type": "string"},
        "reasoning": {"type": "string"},
    },
}

QA_CITATION_SCHEMA: dict[str, Any] = {
    "title": "QaCitation",
    "description": "Citation for a Postgres record or Qdrant chunk.",
    "type": "object",
    "additionalProperties": False,
    "required": ["sourceType", "documentId", "recordId", "qdrantPointId", "title", "snippet"],
    "properties": {
        "sourceType": {"type": "string", "enum": ["postgres", "qdrant"]},
        "documentId": {"type": ["string", "null"]},
        "recordId": {"type": ["string", "null"]},
        "qdrantPointId": {"type": ["string", "null"]},
        "title": {"type": ["string", "null"]},
        "snippet": {"type": ["string", "null"]},
    },
}

QA_ANSWER_SCHEMA: dict[str, Any] = {
    "title": "QaAnswerResponse",
    "description": "Cited answer to a company-brain question.",
    "type": "object",
    "additionalProperties": False,
    "required": ["status", "answer", "retrievalMode", "citations", "confidence", "limitations"],
    "properties": {
        "status": {"type": "string", "enum": ["answered"]},
        "answer": {"type": "string"},
        "retrievalMode": {"type": "string", "enum": ["postgres", "qdrant", "hybrid"]},
        "citations": {"type": "array", "items": QA_CITATION_SCHEMA},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "limitations": {"type": "array", "items": {"type": "string"}},
    },
}


class QaPlanState(TypedDict, total=False):
    request: QaPlanRequest
    plan: QaPlanResponse


class QaAnswerState(TypedDict, total=False):
    request: QaAnswerRequest
    qdrant_context: list[dict[str, Any]]
    answer: QaAnswerResponse


def get_chat_model() -> ChatOpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise DocumentProcessingError(
            "model_not_configured",
            "OPENAI_API_KEY is required for Q&A.",
            status_code=503,
        )

    return ChatOpenAI(
        api_key=api_key,
        model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        temperature=0,
    )


def plan_question_node(state: QaPlanState) -> QaPlanState:
    request = state["request"]
    planner = get_chat_model().with_structured_output(
        QA_PLAN_SCHEMA,
        method="json_schema",
        strict=True,
    )
    result = invoke_model_safely(
        planner,
        [
            SystemMessage(
                content=(
                    "Plan how to answer a company-brain question. Use postgres for exact "
                    "structured facts such as totals, vendors, dates, statuses, or extracted "
                    "fields. Use qdrant for semantic document meaning. Use hybrid when both "
                    "exact records and document context are useful. For postgresQuery, return "
                    "a short intent, any useful document types, and a record limit."
                )
            ),
            HumanMessage(
                content=(
                    f"Question: {request.question}\n"
                    f"Workspace ID: {request.workspace_id}\n"
                    f"Conversation ID: {request.conversation_id or 'none'}\n"
                    f"Filters: {request.filters}"
                )
            ),
        ],
        operation="Q&A retrieval planning",
    )

    plan = result if isinstance(result, QaPlanResponse) else QaPlanResponse.model_validate(result)
    return {"plan": plan}


def retrieve_context_node(state: QaAnswerState) -> QaAnswerState:
    request = state["request"]
    provided_context = request.qdrant_context
    if request.retrieval_mode == "postgres":
        return {"qdrant_context": provided_context}

    retrieved_context = retrieve_qdrant_context(
        request.question,
        workspace_id=request.workspace_id,
    )
    return {"qdrant_context": [*provided_context, *retrieved_context]}


def answer_question_node(state: QaAnswerState) -> QaAnswerState:
    request = state["request"]
    qdrant_context = state.get("qdrant_context", [])
    retrieval_mode = request.retrieval_mode or infer_retrieval_mode(
        request.postgres_evidence,
        qdrant_context,
    )
    answerer = get_chat_model().with_structured_output(
        QA_ANSWER_SCHEMA,
        method="json_schema",
        strict=True,
    )
    result = invoke_model_safely(
        answerer,
        [
            SystemMessage(
                content=(
                    "Answer company questions only from supplied Postgres evidence and Qdrant "
                    "context. Include concise citations. If evidence is insufficient, say what "
                    "is missing instead of inventing facts."
                )
            ),
            HumanMessage(
                content=(
                    f"Question: {request.question}\n"
                    f"Retrieval mode: {retrieval_mode}\n"
                    f"Postgres evidence: {request.postgres_evidence}\n"
                    f"Qdrant context: {qdrant_context}"
                )
            ),
        ],
        operation="Q&A answer generation",
    )

    answer = (
        result if isinstance(result, QaAnswerResponse) else QaAnswerResponse.model_validate(result)
    )
    return {"answer": answer}


def infer_retrieval_mode(
    postgres_evidence: list[dict[str, Any]],
    qdrant_context: list[dict[str, Any]],
) -> str:
    if postgres_evidence and qdrant_context:
        return "hybrid"
    if postgres_evidence:
        return "postgres"
    return "qdrant"


def invoke_model_safely(model: Any, messages: list[Any], *, operation: str) -> Any:
    try:
        return model.invoke(messages)
    except BadRequestError as exc:
        raise qa_error(
            "model_request_failed",
            f"{operation} model request failed: structured schema rejected.",
            502,
            exc,
        ) from exc
    except AuthenticationError as exc:
        raise qa_error(
            "model_auth_failed",
            f"{operation} model authentication failed. Check OPENAI_API_KEY.",
            503,
            exc,
        ) from exc
    except RateLimitError as exc:
        raise qa_error(
            "model_rate_limited",
            f"{operation} model request was rate limited.",
            429,
            exc,
        ) from exc
    except APIConnectionError as exc:
        raise qa_error(
            "model_connection_failed",
            f"{operation} model could not be reached.",
            503,
            exc,
        ) from exc
    except APIStatusError as exc:
        raise qa_error(
            "model_provider_failed",
            f"{operation} model provider returned an error.",
            502,
            exc,
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise qa_error(
            "model_failed",
            f"{operation} model failed unexpectedly.",
            502,
            exc,
        ) from exc


def qa_error(
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


def build_qa_plan_graph():
    graph = StateGraph(QaPlanState)
    graph.add_node("plan_question", plan_question_node)
    graph.add_edge(START, "plan_question")
    graph.add_edge("plan_question", END)
    return graph.compile()


def build_qa_answer_graph():
    graph = StateGraph(QaAnswerState)
    graph.add_node("retrieve_context", retrieve_context_node)
    graph.add_node("answer_question", answer_question_node)
    graph.add_edge(START, "retrieve_context")
    graph.add_edge("retrieve_context", "answer_question")
    graph.add_edge("answer_question", END)
    return graph.compile()


QA_PLAN_GRAPH = build_qa_plan_graph()
QA_ANSWER_GRAPH = build_qa_answer_graph()


def run_qa_plan_graph(request: QaPlanRequest) -> QaPlanResponse:
    final_state = QA_PLAN_GRAPH.invoke({"request": request})
    return final_state["plan"]


def run_qa_answer_graph(request: QaAnswerRequest) -> QaAnswerResponse:
    final_state = QA_ANSWER_GRAPH.invoke({"request": request})
    return final_state["answer"]
