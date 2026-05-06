from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.agents.ingestion_graph import run_ingestion_graph
from app.agents.qa_graph import run_qa_answer_graph, run_qa_plan_graph
from app.agents.supervisor_graph import SupervisorPlan, plan_with_heuristics, plan_with_model
from app.errors import DocumentProcessingError
from app.schemas import (
    AgentRunStartRequest,
    DocumentProcessRequest,
    DocumentProcessResponse,
    QaAnswerRequest,
    QaAnswerResponse,
    QaPlanRequest,
)
from app.tools.callback_tools import complete_agent_run_callback, emit_agent_step


class AutonomousTeamState(TypedDict, total=False):
    request: AgentRunStartRequest
    sequence: int
    plan: SupervisorPlan
    tool_actions: list[dict[str, str]]
    extractions: list[DocumentProcessResponse]
    qa_answer: QaAnswerResponse
    automation_decision: str
    review_required: bool
    final_reply: str


def run_autonomous_agent_team(request: AgentRunStartRequest) -> None:
    final_state = AUTONOMOUS_TEAM_GRAPH.invoke({"request": request, "sequence": 1})
    complete_agent_run_callback(
        callback_base_url=request.callback_base_url,
        agent_run_id=request.agent_run_id,
        payload=build_completion_payload(final_state),
    )


def manager_agent_node(state: AutonomousTeamState) -> AutonomousTeamState:
    request = state["request"]
    plan = (
        plan_with_heuristics(to_supervisor_request(request))
        if should_use_heuristic_manager(request)
        else plan_with_model(to_supervisor_request(request))
    )
    sequence = emit_step_from_state(
        state,
        agent_name="Manager Agent",
        action="plan_and_delegate",
        status="completed",
        input_summary=safe_message_summary(request.user_message),
        output_summary=f"Intent: {plan.intent}. {plan.reasoning}",
        metadata={
            "intent": plan.intent,
            "attachmentCount": len(request.attachments),
        },
    )
    return {
        "plan": plan,
        "sequence": sequence,
        "tool_actions": [
            {
                "tool": "manager_agent",
                "status": "completed",
                "summary": plan.reasoning,
            }
        ],
    }


def intake_agent_node(state: AutonomousTeamState) -> AutonomousTeamState:
    request = state["request"]
    plan = state["plan"]
    filenames = [attachment.original_filename for attachment in request.attachments]
    if plan.intent in {"clarify", "unsupported"}:
        summary = "No document intake was needed for this request."
        status = "skipped"
    else:
        summary = (
            f"Inspected {len(request.attachments)} attachment(s): {', '.join(filenames[:3])}"
            if request.attachments
            else "No attachments were supplied."
        )
        status = "completed"

    sequence = emit_step_from_state(
        state,
        agent_name="Intake Agent",
        action="inspect_attachments",
        status=status,
        input_summary=f"{len(request.attachments)} attachment(s) provided.",
        output_summary=summary,
        metadata={
            "filenames": filenames[:10],
            "contentTypes": [attachment.content_type for attachment in request.attachments[:10]],
        },
    )
    actions = [
        *state.get("tool_actions", []),
        {
            "tool": "intake_agent",
            "status": status,
            "summary": summary,
        },
    ]
    return {"sequence": sequence, "tool_actions": actions}


def extraction_agent_node(state: AutonomousTeamState) -> AutonomousTeamState:
    request = state["request"]
    plan = state["plan"]
    actions = list(state.get("tool_actions", []))
    if plan.intent not in {"ingest_documents", "ingest_and_answer"}:
        sequence = emit_step_from_state(
            state,
            agent_name="Extraction Agent",
            action="extract_structured_data",
            status="skipped",
            output_summary="No extraction was needed for this request.",
        )
        actions.append(
            {
                "tool": "extraction_agent",
                "status": "skipped",
                "summary": "No extraction was needed.",
            }
        )
        return {"sequence": sequence, "tool_actions": actions, "extractions": []}

    max_retries = bounded_int(request.processing_options.get("maxRetries"), default=1, maximum=3)
    extractions: list[DocumentProcessResponse] = []
    sequence = state.get("sequence", 1)

    for attachment in request.attachments:
        extraction = run_extraction_with_retries(request, attachment, max_retries)
        extractions.append(extraction)
        sequence = emit_step_from_state(
            {**state, "sequence": sequence},
            agent_name="Extraction Agent",
            action="extract_structured_data",
            status="completed",
            input_summary=f"Extract {attachment.original_filename}.",
            output_summary=(
                f"Extracted {extraction.title} as {extraction.document_type} "
                f"with {round(extraction.document_confidence * 100)}% confidence."
            ),
            confidence=extraction.document_confidence,
            metadata={
                "documentId": attachment.document_id,
                "documentType": extraction.document_type,
                "fieldCount": len(extraction.common_fields) + len(extraction.type_specific_fields),
            },
        )

    actions.append(
        {
            "tool": "extraction_agent",
            "status": "completed",
            "summary": f"Extracted structured data from {len(extractions)} document(s).",
        }
    )
    return {"sequence": sequence, "tool_actions": actions, "extractions": extractions}


def validation_critic_agent_node(state: AutonomousTeamState) -> AutonomousTeamState:
    extractions = state.get("extractions", [])
    actions = list(state.get("tool_actions", []))
    if not extractions:
        sequence = emit_step_from_state(
            state,
            agent_name="Validation Critic Agent",
            action="critique_outputs",
            status="skipped",
            output_summary="No extraction output needed critique.",
        )
        actions.append(
            {
                "tool": "validation_critic_agent",
                "status": "skipped",
                "summary": "No extraction output needed critique.",
            }
        )
        return {
            "sequence": sequence,
            "tool_actions": actions,
            "automation_decision": "safe_to_save",
            "review_required": False,
        }

    review_extractions = [
        extraction
        for extraction in extractions
        if extraction.agent_assessment.automation_decision == "save_for_review"
        or extraction.agent_assessment.review_required
        or extraction.status == "needs_review"
    ]
    review_required = bool(review_extractions)
    automation_decision = "save_for_review" if review_required else "safe_to_save"
    review_reasons = [
        reason
        for extraction in review_extractions
        for reason in extraction.agent_assessment.review_reasons
    ]
    summary = (
        f"{len(review_extractions)} document(s) need review: {review_reasons[0]}"
        if review_reasons
        else (
            f"{len(review_extractions)} document(s) need review."
            if review_required
            else "All extracted outputs passed agent validation."
        )
    )
    sequence = emit_step_from_state(
        state,
        agent_name="Validation Critic Agent",
        action="critique_outputs",
        status="completed",
        output_summary=summary,
        metadata={
            "reviewRequired": review_required,
            "automationDecision": automation_decision,
            "reviewDocumentIds": [extraction.document_id for extraction in review_extractions],
        },
    )
    actions.append(
        {
            "tool": "validation_critic_agent",
            "status": "completed",
            "summary": summary,
        }
    )
    return {
        "sequence": sequence,
        "tool_actions": actions,
        "automation_decision": automation_decision,
        "review_required": review_required,
    }


def memory_agent_node(state: AutonomousTeamState) -> AutonomousTeamState:
    extractions = state.get("extractions", [])
    vector_count = sum(len(extraction.vector_references) for extraction in extractions)
    status = "completed" if vector_count else "skipped"
    summary = (
        f"Stored {vector_count} vector memory reference(s) in Qdrant."
        if vector_count
        else "No new vector memory was stored."
    )
    sequence = emit_step_from_state(
        state,
        agent_name="Memory Agent",
        action="save_semantic_memory",
        status=status,
        output_summary=summary,
        metadata={"vectorReferenceCount": vector_count},
    )
    actions = [
        *state.get("tool_actions", []),
        {
            "tool": "memory_agent",
            "status": status,
            "summary": summary,
        },
    ]
    return {"sequence": sequence, "tool_actions": actions}


def qa_agent_node(state: AutonomousTeamState) -> AutonomousTeamState:
    request = state["request"]
    plan = state["plan"]
    actions = list(state.get("tool_actions", []))
    if plan.intent not in {"answer_question", "ingest_and_answer"}:
        sequence = emit_step_from_state(
            state,
            agent_name="Q&A Agent",
            action="answer_from_company_memory",
            status="skipped",
            output_summary="No question answering was needed for this request.",
        )
        actions.append(
            {
                "tool": "qa_agent",
                "status": "skipped",
                "summary": "No question answering was needed.",
            }
        )
        return {"sequence": sequence, "tool_actions": actions}

    question = plan.question or request.user_message
    qa_plan = run_qa_plan_graph(
        QaPlanRequest(
            workspaceId=request.workspace_id,
            conversationId=request.conversation_id,
            question=question,
            filters={},
        )
    )
    postgres_evidence = [
        *request.postgres_evidence,
        *[extraction.model_dump(by_alias=True) for extraction in state.get("extractions", [])],
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
    sequence = emit_step_from_state(
        state,
        agent_name="Q&A Agent",
        action="answer_from_company_memory",
        status="completed",
        input_summary=safe_message_summary(question),
        output_summary=answer.answer,
        confidence=answer.confidence,
        metadata={
            "retrievalMode": answer.retrieval_mode,
            "citationCount": len(answer.citations),
            "limitations": answer.limitations,
        },
    )
    actions.append(
        {
            "tool": "qa_agent",
            "status": "completed",
            "summary": f"Answered using {answer.retrieval_mode} retrieval.",
        }
    )
    return {"sequence": sequence, "tool_actions": actions, "qa_answer": answer}


def response_agent_node(state: AutonomousTeamState) -> AutonomousTeamState:
    plan = state["plan"]
    request = state["request"]
    extractions = state.get("extractions", [])
    qa_answer = state.get("qa_answer")
    reply = build_final_reply(plan, request, extractions, qa_answer)
    sequence = emit_step_from_state(
        state,
        agent_name="Response Agent",
        action="write_final_reply",
        status="completed",
        output_summary=safe_message_summary(reply),
        metadata={
            "usesVerifiedOutputsOnly": True,
            "hasQaAnswer": qa_answer is not None,
            "extractionCount": len(extractions),
        },
    )
    actions = [
        *state.get("tool_actions", []),
        {
            "tool": "response_agent",
            "status": "completed",
            "summary": "Wrote the employee-facing response from verified agent outputs.",
        },
    ]
    return {"sequence": sequence, "tool_actions": actions, "final_reply": reply}


def build_autonomous_team_graph():
    graph = StateGraph(AutonomousTeamState)
    graph.add_node("manager_agent", manager_agent_node)
    graph.add_node("intake_agent", intake_agent_node)
    graph.add_node("extraction_agent", extraction_agent_node)
    graph.add_node("validation_critic_agent", validation_critic_agent_node)
    graph.add_node("memory_agent", memory_agent_node)
    graph.add_node("qa_agent", qa_agent_node)
    graph.add_node("response_agent", response_agent_node)

    graph.add_edge(START, "manager_agent")
    graph.add_edge("manager_agent", "intake_agent")
    graph.add_edge("intake_agent", "extraction_agent")
    graph.add_edge("extraction_agent", "validation_critic_agent")
    graph.add_edge("validation_critic_agent", "memory_agent")
    graph.add_edge("memory_agent", "qa_agent")
    graph.add_edge("qa_agent", "response_agent")
    graph.add_edge("response_agent", END)
    return graph.compile()


def to_supervisor_request(request: AgentRunStartRequest):
    from app.schemas import AgentRespondRequest

    return AgentRespondRequest(
        workspaceId=request.workspace_id,
        conversationId=request.conversation_id,
        messageId=request.message_id,
        userMessage=request.user_message,
        userInstructions=request.user_instructions,
        attachments=request.attachments,
        postgresEvidence=request.postgres_evidence,
        processingOptions=request.processing_options,
    )


def should_use_heuristic_manager(request: AgentRunStartRequest) -> bool:
    mode = str(request.processing_options.get("managerMode", "")).lower()
    supervisor_mode = str(request.processing_options.get("supervisorMode", "")).lower()
    return mode == "heuristic" or supervisor_mode == "heuristic"


def run_extraction_with_retries(
    request: AgentRunStartRequest,
    attachment,
    max_retries: int,
) -> DocumentProcessResponse:
    last_error: DocumentProcessingError | None = None
    for attempt in range(1, max_retries + 1):
        try:
            return run_ingestion_graph(
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
        except DocumentProcessingError as error:
            last_error = error
            if attempt >= max_retries:
                raise
    if last_error:
        raise last_error
    raise DocumentProcessingError(
        "extraction_failed",
        "Extraction agent could not process the attachment.",
        status_code=502,
    )


def build_final_reply(
    plan: SupervisorPlan,
    request: AgentRunStartRequest,
    extractions: list[DocumentProcessResponse],
    qa_answer: QaAnswerResponse | None,
) -> str:
    if plan.intent == "clarify":
        return plan.clarification_question or "What would you like me to find or process?"

    if plan.intent == "unsupported":
        return plan.unsupported_reason or "That request is outside the current MVP scope."

    if plan.intent == "answer_question" and qa_answer:
        return qa_answer.answer

    if plan.intent == "ingest_and_answer" and qa_answer:
        prefix = extraction_summary(extractions)
        return f"{prefix}\n\n{qa_answer.answer}" if prefix else qa_answer.answer

    if extractions:
        return "\n\n".join(extraction.chat_reply for extraction in extractions)

    return f"I reviewed your request: {request.user_message}"


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


def build_completion_payload(state: AutonomousTeamState) -> dict[str, Any]:
    plan = state["plan"]
    extractions = state.get("extractions", [])
    qa_answer = state.get("qa_answer")
    automation_decision = state.get("automation_decision", "safe_to_save")
    status = (
        "needs_review"
        if automation_decision == "save_for_review" or state.get("review_required", False)
        else "completed"
    )
    return {
        "status": status,
        "intent": plan.intent,
        "automationDecision": automation_decision
        if plan.intent not in {"clarify", "unsupported"}
        else ("needs_clarification" if plan.intent == "clarify" else "unsupported"),
        "reply": state.get("final_reply", "The autonomous agent team finished."),
        "toolActions": state.get("tool_actions", []),
        "extractions": [extraction.model_dump(by_alias=True) for extraction in extractions],
        "qaAnswer": qa_answer.model_dump(by_alias=True) if qa_answer else None,
        "artifacts": [
            {
                "artifactType": "RUN_METADATA",
                "payload": {
                    "agentTeam": [
                        "Manager Agent",
                        "Intake Agent",
                        "Extraction Agent",
                        "Validation Critic Agent",
                        "Memory Agent",
                        "Q&A Agent",
                        "Response Agent",
                    ],
                    "intent": plan.intent,
                    "reviewRequired": state.get("review_required", False),
                },
            }
        ],
    }


def emit_step_from_state(
    state: AutonomousTeamState,
    *,
    agent_name: str,
    action: str,
    status: str,
    input_summary: str | None = None,
    output_summary: str | None = None,
    confidence: float | None = None,
    metadata: dict[str, Any] | None = None,
) -> int:
    request = state["request"]
    sequence = state.get("sequence", 1)
    emit_agent_step(
        callback_base_url=request.callback_base_url,
        agent_run_id=request.agent_run_id,
        sequence=sequence,
        agent_name=agent_name,
        action=action,
        status=status,
        input_summary=input_summary,
        output_summary=output_summary,
        confidence=confidence,
        metadata=metadata,
    )
    return sequence + 1


def bounded_int(value: object, *, default: int, maximum: int) -> int:
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return max(1, min(parsed, maximum))


def safe_message_summary(value: str, limit: int = 220) -> str:
    cleaned = " ".join(value.split())
    if len(cleaned) <= limit:
        return cleaned
    return f"{cleaned[: limit - 3].strip()}..."


AUTONOMOUS_TEAM_GRAPH = build_autonomous_team_graph()
