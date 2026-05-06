from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class AgentBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class HealthResponse(AgentBaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["agent"] = "agent"


class PlaceholderResponse(AgentBaseModel):
    status: Literal["not_implemented"] = "not_implemented"
    endpoint: str
    message: str


class DocumentProcessRequest(AgentBaseModel):
    conversation_id: str = Field(alias="conversationId")
    message_id: str = Field(alias="messageId")
    document_id: str = Field(alias="documentId")
    workspace_id: str = Field(alias="workspaceId")
    file_storage_key: str = Field(alias="fileStorageKey")
    checksum: str
    original_filename: str = Field(alias="originalFilename")
    content_type: str = Field(alias="contentType")
    user_instructions: str | None = Field(default=None, alias="userInstructions")
    processing_options: dict[str, Any] = Field(default_factory=dict, alias="processingOptions")


DocumentTypeValue = Literal[
    "INVOICE",
    "CONTRACT",
    "PURCHASE_ORDER",
    "RECEIPT_EXPENSE",
    "KNOWLEDGE",
    "UNKNOWN",
]

ValidationStatusValue = Literal["passed", "needs_review", "failed"]
FieldTypeValue = Literal["STRING", "NUMBER", "DATE", "CURRENCY", "BOOLEAN", "JSON"]
ExtractionStatusValue = Literal["extracted", "needs_review"]
AutomationDecisionValue = Literal["safe_to_save", "save_for_review"]
SupervisorIntentValue = Literal[
    "ingest_documents",
    "answer_question",
    "ingest_and_answer",
    "clarify",
    "unsupported",
]
SupervisorStatusValue = Literal["completed", "needs_clarification", "unsupported"]
SupervisorAutomationDecisionValue = Literal[
    "safe_to_save",
    "save_for_review",
    "needs_clarification",
    "unsupported",
]


class ExtractedFieldPayload(AgentBaseModel):
    name: str
    label: str | None = None
    field_type: FieldTypeValue = Field(alias="fieldType")
    value_string: str | None = Field(default=None, alias="valueString")
    value_number: float | None = Field(default=None, alias="valueNumber")
    value_date: str | None = Field(default=None, alias="valueDate")
    currency: str | None = None
    value_json: Any | None = Field(default=None, alias="valueJson")
    confidence: float = Field(ge=0, le=1)
    required: bool = False
    validation_status: ValidationStatusValue = Field(alias="validationStatus")


class SourceReferencePayload(AgentBaseModel):
    field_name: str | None = Field(default=None, alias="fieldName")
    page_number: int | None = Field(default=None, alias="pageNumber")
    paragraph_index: int | None = Field(default=None, alias="paragraphIndex")
    line_start: int | None = Field(default=None, alias="lineStart")
    line_end: int | None = Field(default=None, alias="lineEnd")
    char_start: int | None = Field(default=None, alias="charStart")
    char_end: int | None = Field(default=None, alias="charEnd")
    evidence_snippet: str | None = Field(default=None, alias="evidenceSnippet")


class VectorReferencePayload(AgentBaseModel):
    chunk_id: str = Field(alias="chunkId")
    qdrant_collection: str = Field(alias="qdrantCollection")
    qdrant_point_id: str = Field(alias="qdrantPointId")
    chunk_index: int = Field(alias="chunkIndex")
    content_preview: str = Field(alias="contentPreview")
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExtractionValidationPayload(AgentBaseModel):
    status: ValidationStatusValue
    missing_required_fields: list[str] = Field(default_factory=list, alias="missingRequiredFields")
    warnings: list[str] = Field(default_factory=list)


class AgentAssessmentPayload(AgentBaseModel):
    status: ExtractionStatusValue
    validation_status: ValidationStatusValue = Field(alias="validationStatus")
    document_confidence: float = Field(alias="documentConfidence", ge=0, le=1)
    review_required: bool = Field(alias="reviewRequired")
    review_reasons: list[str] = Field(default_factory=list, alias="reviewReasons")
    missing_fields: list[str] = Field(default_factory=list, alias="missingFields")
    uncertain_fields: list[str] = Field(default_factory=list, alias="uncertainFields")
    automation_decision: AutomationDecisionValue = Field(alias="automationDecision")
    automation_decision_reason: str = Field(alias="automationDecisionReason")


class DocumentProcessResponse(AgentBaseModel):
    status: ExtractionStatusValue
    document_id: str = Field(alias="documentId")
    document_type: DocumentTypeValue = Field(alias="documentType")
    title: str
    common_fields: list[ExtractedFieldPayload] = Field(alias="commonFields")
    type_specific_fields: list[ExtractedFieldPayload] = Field(alias="typeSpecificFields")
    summary: str
    key_facts: list[str] = Field(alias="keyFacts")
    tags: list[str]
    document_confidence: float = Field(alias="documentConfidence", ge=0, le=1)
    field_confidences: dict[str, float] = Field(alias="fieldConfidences")
    validation: ExtractionValidationPayload
    agent_assessment: AgentAssessmentPayload = Field(alias="agentAssessment")
    source_references: list[SourceReferencePayload] = Field(alias="sourceReferences")
    vector_references: list[VectorReferencePayload] = Field(
        default_factory=list,
        alias="vectorReferences",
    )
    chat_reply: str = Field(alias="chatReply")
    processing_implemented: Literal[True] = Field(default=True, alias="processingImplemented")


class DocumentProcessErrorResponse(AgentBaseModel):
    status: Literal["error"] = "error"
    code: str
    message: str
    document_id: str | None = Field(default=None, alias="documentId")
    processing_implemented: Literal[True] = Field(default=True, alias="processingImplemented")
    details: dict[str, Any] = Field(default_factory=dict)


class QaPlanRequest(AgentBaseModel):
    workspace_id: str = Field(alias="workspaceId")
    question: str
    conversation_id: str | None = Field(default=None, alias="conversationId")
    filters: dict[str, Any] = Field(default_factory=dict)


class QaPlanResponse(AgentBaseModel):
    status: Literal["planned"] = "planned"
    retrieval_mode: Literal["postgres", "qdrant", "hybrid"] = Field(alias="retrievalMode")
    postgres_query: dict[str, Any] = Field(default_factory=dict, alias="postgresQuery")
    qdrant_query: str = Field(alias="qdrantQuery")
    reasoning: str


class QaAnswerRequest(AgentBaseModel):
    workspace_id: str = Field(alias="workspaceId")
    question: str
    conversation_id: str | None = Field(default=None, alias="conversationId")
    retrieval_mode: Literal["postgres", "qdrant", "hybrid"] | None = Field(
        default=None,
        alias="retrievalMode",
    )
    postgres_evidence: list[dict[str, Any]] = Field(default_factory=list, alias="postgresEvidence")
    qdrant_context: list[dict[str, Any]] = Field(default_factory=list, alias="qdrantContext")


class QaCitationPayload(AgentBaseModel):
    source_type: Literal["postgres", "qdrant"] = Field(alias="sourceType")
    document_id: str | None = Field(default=None, alias="documentId")
    record_id: str | None = Field(default=None, alias="recordId")
    qdrant_point_id: str | None = Field(default=None, alias="qdrantPointId")
    title: str | None = None
    snippet: str | None = None


class QaAnswerResponse(AgentBaseModel):
    status: Literal["answered"] = "answered"
    answer: str
    retrieval_mode: Literal["postgres", "qdrant", "hybrid"] = Field(alias="retrievalMode")
    citations: list[QaCitationPayload] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    limitations: list[str] = Field(default_factory=list)


class AgentAttachmentPayload(AgentBaseModel):
    document_id: str = Field(alias="documentId")
    file_storage_key: str = Field(alias="fileStorageKey")
    checksum: str
    original_filename: str = Field(alias="originalFilename")
    content_type: str = Field(alias="contentType")


class AgentRespondRequest(AgentBaseModel):
    workspace_id: str = Field(alias="workspaceId")
    conversation_id: str = Field(alias="conversationId")
    message_id: str = Field(alias="messageId")
    user_message: str = Field(alias="userMessage")
    user_instructions: str | None = Field(default=None, alias="userInstructions")
    attachments: list[AgentAttachmentPayload] = Field(default_factory=list)
    postgres_evidence: list[dict[str, Any]] = Field(default_factory=list, alias="postgresEvidence")
    processing_options: dict[str, Any] = Field(default_factory=dict, alias="processingOptions")


class SupervisorToolActionPayload(AgentBaseModel):
    tool: Literal[
        "supervisor_planner",
        "document_ingestion",
        "qa_plan",
        "qa_answer",
        "clarification",
        "unsupported",
    ]
    status: Literal["completed", "failed", "skipped"]
    summary: str


class AgentRespondResponse(AgentBaseModel):
    status: SupervisorStatusValue
    intent: SupervisorIntentValue
    tool_actions: list[SupervisorToolActionPayload] = Field(alias="toolActions")
    extractions: list[DocumentProcessResponse] = Field(default_factory=list)
    qa_answer: QaAnswerResponse | None = Field(default=None, alias="qaAnswer")
    automation_decision: SupervisorAutomationDecisionValue = Field(alias="automationDecision")
    reply: str
    processing_implemented: Literal[True] = Field(default=True, alias="processingImplemented")


class AgentRunStartRequest(AgentBaseModel):
    agent_run_id: str = Field(alias="agentRunId")
    workspace_id: str = Field(alias="workspaceId")
    conversation_id: str = Field(alias="conversationId")
    message_id: str = Field(alias="messageId")
    user_message: str = Field(alias="userMessage")
    user_instructions: str | None = Field(default=None, alias="userInstructions")
    attachments: list[AgentAttachmentPayload] = Field(default_factory=list)
    postgres_evidence: list[dict[str, Any]] = Field(default_factory=list, alias="postgresEvidence")
    callback_base_url: str = Field(alias="callbackBaseUrl")
    processing_options: dict[str, Any] = Field(default_factory=dict, alias="processingOptions")


class AgentRunStartResponse(AgentBaseModel):
    status: Literal["accepted"] = "accepted"
    agent_run_id: str = Field(alias="agentRunId")
    message: str
