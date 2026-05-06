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


class DocumentAcceptedResponse(AgentBaseModel):
    status: Literal["accepted"] = "accepted"
    endpoint: Literal["/documents/process"] = "/documents/process"
    document_id: str = Field(alias="documentId")
    processing_implemented: Literal[False] = Field(default=False, alias="processingImplemented")
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


class QaPlanRequest(AgentBaseModel):
    workspace_id: str = Field(alias="workspaceId")
    question: str
    conversation_id: str | None = Field(default=None, alias="conversationId")
    filters: dict[str, Any] = Field(default_factory=dict)


class QaAnswerRequest(AgentBaseModel):
    workspace_id: str = Field(alias="workspaceId")
    question: str
    conversation_id: str | None = Field(default=None, alias="conversationId")
    postgres_evidence: list[dict[str, Any]] = Field(default_factory=list, alias="postgresEvidence")
    qdrant_context: list[dict[str, Any]] = Field(default_factory=list, alias="qdrantContext")
