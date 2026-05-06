import json
import os
import re
from pathlib import Path
from typing import Any

from openai import (
    APIConnectionError,
    APIStatusError,
    AuthenticationError,
    BadRequestError,
    RateLimitError,
)

from app.document_parsing import ParsedDocument, TextSource
from app.errors import DocumentProcessingError
from app.schemas import (
    AgentAssessmentPayload,
    DocumentProcessRequest,
    DocumentProcessResponse,
    ExtractedFieldPayload,
    ExtractionValidationPayload,
    SourceReferencePayload,
    VectorReferencePayload,
)
from app.tools.extraction_tools import extract_payload_with_langchain

DOCUMENT_TYPES = {
    "INVOICE",
    "CONTRACT",
    "PURCHASE_ORDER",
    "RECEIPT_EXPENSE",
    "KNOWLEDGE",
    "UNKNOWN",
}

REQUIRED_TYPE_FIELDS: dict[str, list[str]] = {
    "INVOICE": ["vendor", "invoice_number", "invoice_date", "total_amount", "currency"],
    "CONTRACT": ["primary_parties", "effective_date", "agreement_summary"],
    "PURCHASE_ORDER": [
        "purchase_order_number",
        "buyer",
        "supplier",
        "issue_date",
        "total_amount",
        "currency",
    ],
    "RECEIPT_EXPENSE": ["merchant_or_vendor", "transaction_date", "total_amount", "currency"],
    "KNOWLEDGE": ["key_facts", "tags"],
    "UNKNOWN": ["key_facts", "tags"],
}

COMMON_FIELD_NAMES = {"title", "source_filename", "document_type", "summary"}

EXTRACTION_FIELD_PROPERTIES: dict[str, Any] = {
    "name": {"type": "string"},
    "label": {"type": ["string", "null"]},
    "fieldType": {
        "type": "string",
        "enum": ["STRING", "NUMBER", "DATE", "CURRENCY", "BOOLEAN", "JSON"],
    },
    "valueString": {"type": ["string", "null"]},
    "valueNumber": {"type": ["number", "null"]},
    "valueDate": {"type": ["string", "null"]},
    "currency": {"type": ["string", "null"]},
    "valueJson": {
        "type": ["string", "null"],
        "description": "JSON-encoded string for complex values, otherwise null.",
    },
    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    "required": {"type": "boolean"},
    "validationStatus": {
        "type": "string",
        "enum": ["passed", "needs_review", "failed"],
    },
}

SOURCE_REFERENCE_PROPERTIES: dict[str, Any] = {
    "fieldName": {"type": ["string", "null"]},
    "pageNumber": {"type": ["integer", "null"]},
    "paragraphIndex": {"type": ["integer", "null"]},
    "lineStart": {"type": ["integer", "null"]},
    "lineEnd": {"type": ["integer", "null"]},
    "charStart": {"type": ["integer", "null"]},
    "charEnd": {"type": ["integer", "null"]},
    "evidenceSnippet": {"type": ["string", "null"]},
}

AGENT_ASSESSMENT_PROPERTIES: dict[str, Any] = {
    "status": {"type": "string", "enum": ["extracted", "needs_review"]},
    "validationStatus": {"type": "string", "enum": ["passed", "needs_review", "failed"]},
    "documentConfidence": {"type": "number", "minimum": 0, "maximum": 1},
    "reviewRequired": {"type": "boolean"},
    "reviewReasons": {"type": "array", "items": {"type": "string"}},
    "missingFields": {"type": "array", "items": {"type": "string"}},
    "uncertainFields": {"type": "array", "items": {"type": "string"}},
    "automationDecision": {"type": "string", "enum": ["safe_to_save", "save_for_review"]},
    "automationDecisionReason": {"type": "string"},
}

EXTRACTION_JSON_SCHEMA: dict[str, Any] = {
    "title": "DocumentExtraction",
    "description": "Structured extraction result for a company document.",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "documentType",
        "title",
        "summary",
        "keyFacts",
        "tags",
        "commonFields",
        "typeSpecificFields",
        "sourceReferences",
        "agentAssessment",
    ],
    "properties": {
        "documentType": {"type": "string", "enum": sorted(DOCUMENT_TYPES)},
        "title": {"type": "string"},
        "summary": {"type": "string"},
        "keyFacts": {"type": "array", "items": {"type": "string"}},
        "tags": {"type": "array", "items": {"type": "string"}},
        "commonFields": {
            "type": "array",
            "items": {"$ref": "#/$defs/field"},
        },
        "typeSpecificFields": {
            "type": "array",
            "items": {"$ref": "#/$defs/field"},
        },
        "sourceReferences": {
            "type": "array",
            "items": {"$ref": "#/$defs/sourceReference"},
        },
        "agentAssessment": {
            "$ref": "#/$defs/agentAssessment",
        },
    },
    "$defs": {
        "field": {
            "type": "object",
            "additionalProperties": False,
            "required": list(EXTRACTION_FIELD_PROPERTIES),
            "properties": EXTRACTION_FIELD_PROPERTIES,
        },
        "sourceReference": {
            "type": "object",
            "additionalProperties": False,
            "required": list(SOURCE_REFERENCE_PROPERTIES),
            "properties": SOURCE_REFERENCE_PROPERTIES,
        },
        "agentAssessment": {
            "type": "object",
            "additionalProperties": False,
            "required": list(AGENT_ASSESSMENT_PROPERTIES),
            "properties": AGENT_ASSESSMENT_PROPERTIES,
        },
    },
}


def process_document_request(
    request: DocumentProcessRequest,
) -> DocumentProcessResponse:
    from app.agents.ingestion_graph import run_ingestion_graph

    return run_ingestion_graph(request)


def extract_with_openai(
    request: DocumentProcessRequest,
    parsed_document: ParsedDocument,
) -> DocumentProcessResponse:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise DocumentProcessingError(
            "model_not_configured",
            "OPENAI_API_KEY is required for Phase 4 extraction.",
            status_code=503,
        )

    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    text = truncate_for_model(parsed_document.text)
    system_prompt = (
        "You extract structured business data from company documents. "
        "Return only fields supported by the document text, but choose the "
        "fields dynamically based on what the document contains. Recognize "
        "known business types when appropriate, and use UNKNOWN for useful "
        "documents that do not fit those categories. You are responsible for "
        "the confidence, validation, review, and automation decision in "
        "agentAssessment; do not rely on downstream code to apply business "
        "confidence rules. Include short evidence snippets for important values."
    )
    user_prompt = (
        f"Filename: {request.original_filename}\n"
        f"Employee instructions: {request.user_instructions or 'None'}\n\n"
        f"Document text:\n{text}"
    )

    try:
        payload = extract_payload_with_langchain(
            api_key=api_key,
            model=model,
            schema=EXTRACTION_JSON_SCHEMA,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
        )
    except DocumentProcessingError:
        raise
    except BadRequestError as exc:
        raise model_error(
            "model_request_failed",
            "Extraction model request failed: structured schema rejected.",
            status_code=502,
            model=model,
            provider_status_code=getattr(exc, "status_code", 400),
        ) from exc
    except AuthenticationError as exc:
        raise model_error(
            "model_auth_failed",
            "Extraction model authentication failed. Check OPENAI_API_KEY.",
            status_code=503,
            model=model,
            provider_status_code=getattr(exc, "status_code", 401),
        ) from exc
    except RateLimitError as exc:
        raise model_error(
            "model_rate_limited",
            "Extraction model request was rate limited.",
            status_code=429,
            model=model,
            provider_status_code=getattr(exc, "status_code", 429),
        ) from exc
    except APIConnectionError as exc:
        raise model_error(
            "model_connection_failed",
            "Extraction model could not be reached.",
            status_code=503,
            model=model,
        ) from exc
    except APIStatusError as exc:
        raise model_error(
            "model_provider_failed",
            "Extraction model provider returned an error.",
            status_code=502,
            model=model,
            provider_status_code=getattr(exc, "status_code", None),
        ) from exc
    except json.JSONDecodeError as exc:
        raise model_error(
            "model_invalid_json",
            "Extraction model returned invalid JSON.",
            status_code=502,
            model=model,
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise model_error(
            "model_failed",
            "Extraction model failed unexpectedly.",
            status_code=502,
            model=model,
        ) from exc

    return response_from_payload(payload, request, parsed_document)


def build_heuristic_response(
    request: DocumentProcessRequest,
    parsed_document: ParsedDocument,
) -> DocumentProcessResponse:
    text = parsed_document.text
    document_type = classify_document(text, request.original_filename)
    title = title_from_document(text, request.original_filename)
    summary = summarize_text(text, document_type)
    key_facts = extract_key_facts(text)
    tags = tags_for_document(document_type, text)

    common_fields = [
        make_field("title", title, required=True, confidence=0.9),
        make_field("source_filename", request.original_filename, required=True, confidence=1.0),
        make_field("document_type", document_type, required=True, confidence=0.88),
        make_field("summary", summary, required=True, confidence=0.82),
    ]
    type_specific_fields = heuristic_type_fields(document_type, text)
    agent_assessment = build_heuristic_agent_assessment(
        document_type,
        common_fields + type_specific_fields,
    )

    return finalize_response(
        request=request,
        parsed_document=parsed_document,
        document_type=document_type,
        title=title,
        summary=summary,
        key_facts=key_facts,
        tags=tags,
        common_fields=common_fields,
        type_specific_fields=type_specific_fields,
        source_references=[],
        agent_assessment=agent_assessment,
    )


def response_from_payload(
    payload: dict[str, Any],
    request: DocumentProcessRequest,
    parsed_document: ParsedDocument,
) -> DocumentProcessResponse:
    document_type = normalize_document_type(payload.get("documentType"))
    title = string_value(payload.get("title")) or Path(request.original_filename).stem
    summary = string_value(payload.get("summary"))
    key_facts = string_list(payload.get("keyFacts"))
    tags = string_list(payload.get("tags"))

    common_fields = normalize_fields(payload.get("commonFields", []))
    type_specific_fields = normalize_fields(payload.get("typeSpecificFields", []))
    agent_assessment = normalize_agent_assessment(payload.get("agentAssessment"))

    source_references = normalize_source_references(payload.get("sourceReferences", []))

    return finalize_response(
        request=request,
        parsed_document=parsed_document,
        document_type=document_type,
        title=title,
        summary=summary,
        key_facts=key_facts,
        tags=tags,
        common_fields=common_fields,
        type_specific_fields=type_specific_fields,
        source_references=source_references,
        agent_assessment=agent_assessment,
    )


def model_error(
    code: str,
    message: str,
    *,
    status_code: int,
    model: str,
    provider_status_code: int | None = None,
) -> DocumentProcessingError:
    details: dict[str, Any] = {"model": model}
    if provider_status_code is not None:
        details["providerStatusCode"] = provider_status_code

    return DocumentProcessingError(
        code,
        message,
        status_code=status_code,
        details=details,
    )


def normalize_agent_assessment(raw_assessment: Any) -> AgentAssessmentPayload:
    if not isinstance(raw_assessment, dict):
        raise DocumentProcessingError(
            "invalid_agent_assessment",
            "Extraction model returned an invalid agent assessment.",
            status_code=422,
        )

    try:
        return AgentAssessmentPayload.model_validate(raw_assessment)
    except Exception as exc:  # noqa: BLE001
        raise DocumentProcessingError(
            "invalid_agent_assessment",
            "Extraction model returned an invalid agent assessment.",
            status_code=422,
        ) from exc


def build_heuristic_agent_assessment(
    document_type: str,
    fields: list[ExtractedFieldPayload],
) -> AgentAssessmentPayload:
    missing_fields = heuristic_missing_required_fields(document_type, fields)
    uncertain_fields = [
        field.name for field in fields if field_has_value(field) and field.confidence < 0.85
    ]
    confidence = compute_heuristic_document_confidence(
        fields=fields,
        document_type=document_type,
        missing_required=missing_fields,
    )
    status = "extracted" if confidence >= 0.85 and not missing_fields else "needs_review"
    review_reasons = []
    if missing_fields:
        review_reasons.append("Missing required fields: " + ", ".join(missing_fields))
    if uncertain_fields:
        review_reasons.append("Uncertain fields: " + ", ".join(uncertain_fields[:5]))

    return AgentAssessmentPayload(
        status=status,
        validationStatus="passed" if status == "extracted" else "needs_review",
        documentConfidence=confidence,
        reviewRequired=status == "needs_review",
        reviewReasons=review_reasons,
        missingFields=missing_fields,
        uncertainFields=uncertain_fields,
        automationDecision="safe_to_save" if status == "extracted" else "save_for_review",
        automationDecisionReason=(
            "Heuristic test extraction found all required fields."
            if status == "extracted"
            else "Heuristic test extraction needs review before automation."
        ),
    )


def finalize_response(
    *,
    request: DocumentProcessRequest,
    parsed_document: ParsedDocument,
    document_type: str,
    title: str,
    summary: str,
    key_facts: list[str],
    tags: list[str],
    common_fields: list[ExtractedFieldPayload],
    type_specific_fields: list[ExtractedFieldPayload],
    source_references: list[SourceReferencePayload],
    agent_assessment: AgentAssessmentPayload,
    vector_references: list[VectorReferencePayload] | None = None,
) -> DocumentProcessResponse:
    all_fields = common_fields + type_specific_fields

    existing_refs = {(reference.field_name or "").lower() for reference in source_references}
    for field in all_fields:
        if field.name.lower() not in existing_refs and field_has_value(field):
            source_references.append(source_reference_for_field(parsed_document, field))
            existing_refs.add(field.name.lower())

    field_confidences = {field.name: round(field.confidence, 2) for field in all_fields}
    warnings = agent_assessment.review_reasons

    return DocumentProcessResponse(
        status=agent_assessment.status,
        documentId=request.document_id,
        documentType=document_type,
        title=title,
        commonFields=common_fields,
        typeSpecificFields=type_specific_fields,
        summary=summary,
        keyFacts=key_facts,
        tags=tags,
        documentConfidence=agent_assessment.document_confidence,
        fieldConfidences=field_confidences,
        validation=ExtractionValidationPayload(
            status=agent_assessment.validation_status,
            missingRequiredFields=agent_assessment.missing_fields,
            warnings=warnings,
        ),
        agentAssessment=agent_assessment,
        sourceReferences=source_references,
        vectorReferences=vector_references or [],
        chatReply=chat_reply(
            document_type,
            agent_assessment.status,
            agent_assessment.document_confidence,
            type_specific_fields,
            key_facts,
            warnings,
        ),
        processingImplemented=True,
    )


def classify_document(text: str, filename: str = "") -> str:
    haystack = f"{filename}\n{text}".lower()

    if has_any(
        haystack,
        ["invoice", "invoice number", "invoice #", "amount due", "bill to", "invoice date"],
    ):
        return "INVOICE"
    if has_any(haystack, ["purchase order", "po number", "po #", "ship to", "buyer:"]):
        return "PURCHASE_ORDER"
    if has_any(haystack, ["receipt", "expense", "transaction date", "payment method", "merchant:"]):
        return "RECEIPT_EXPENSE"
    if has_any(haystack, ["agreement", "contract", "effective date", "termination", "renewal"]):
        return "CONTRACT"
    if has_any(haystack, ["policy", "guide", "handbook", "process", "overview", "knowledge"]):
        return "KNOWLEDGE"

    return "UNKNOWN"


def heuristic_type_fields(document_type: str, text: str) -> list[ExtractedFieldPayload]:
    if document_type == "INVOICE":
        total_amount, currency = extract_amount_and_currency(text)
        return [
            make_field(
                "vendor",
                labeled_value(text, ["vendor", "from", "supplier"]),
                required=True,
            ),
            make_field(
                "invoice_number",
                labeled_value(text, ["invoice number", "invoice #", "invoice no"]),
                required=True,
            ),
            make_field(
                "invoice_date",
                labeled_value(text, ["invoice date", "date"]),
                required=True,
            ),
            make_field(
                "total_amount",
                total_amount,
                required=True,
                field_type="CURRENCY",
                currency=currency,
            ),
            make_field("currency", currency, required=True),
            make_field(
                "due_date",
                labeled_value(text, ["due date", "payment due"]),
                confidence=0.72,
            ),
            make_field(
                "payment_terms",
                labeled_value(text, ["payment terms", "terms"]),
                confidence=0.72,
            ),
        ]

    if document_type == "CONTRACT":
        return [
            make_field("primary_parties", contract_parties(text), required=True),
            make_field(
                "effective_date",
                labeled_value(text, ["effective date", "signature date", "start date"]),
                required=True,
            ),
            make_field("agreement_summary", summarize_text(text, document_type), required=True),
            make_field("contract_value", labeled_value(text, ["contract value", "total value"])),
            make_field("renewal_date", labeled_value(text, ["renewal date", "renewal"])),
            make_field("payment_terms", labeled_value(text, ["payment terms", "terms"])),
        ]

    if document_type == "PURCHASE_ORDER":
        total_amount, currency = extract_amount_and_currency(text)
        return [
            make_field(
                "purchase_order_number",
                labeled_value(text, ["purchase order number", "po number", "po #"]),
                required=True,
            ),
            make_field("buyer", labeled_value(text, ["buyer", "bill to"]), required=True),
            make_field("supplier", labeled_value(text, ["supplier", "vendor"]), required=True),
            make_field("issue_date", labeled_value(text, ["issue date", "date"]), required=True),
            make_field(
                "total_amount",
                total_amount,
                required=True,
                field_type="CURRENCY",
                currency=currency,
            ),
            make_field("currency", currency, required=True),
            make_field("delivery_date", labeled_value(text, ["delivery date", "deliver by"])),
        ]

    if document_type == "RECEIPT_EXPENSE":
        total_amount, currency = extract_amount_and_currency(text)
        return [
            make_field(
                "merchant_or_vendor",
                labeled_value(text, ["merchant", "vendor", "store"]),
                required=True,
            ),
            make_field(
                "transaction_date",
                labeled_value(text, ["transaction date", "date"]),
                required=True,
            ),
            make_field(
                "total_amount",
                total_amount,
                required=True,
                field_type="CURRENCY",
                currency=currency,
            ),
            make_field("currency", currency, required=True),
            make_field("payment_method", labeled_value(text, ["payment method", "paid with"])),
            make_field("expense_category", labeled_value(text, ["category", "expense category"])),
        ]

    return [
        make_field("key_facts", extract_key_facts(text), required=True, confidence=0.78),
        make_field("tags", tags_for_document(document_type, text), required=True, confidence=0.78),
    ]


def normalize_fields(
    raw_fields: Any,
) -> list[ExtractedFieldPayload]:
    normalized = []

    if not isinstance(raw_fields, list):
        return normalized

    for item in raw_fields:
        if not isinstance(item, dict):
            continue

        name = snake_case(string_value(item.get("name")))
        if not name:
            continue

        confidence = clamp_float(item.get("confidence"), default=0.7)
        value = first_present(
            item.get("valueString"),
            item.get("valueNumber"),
            item.get("valueDate"),
            item.get("valueJson"),
        )
        field_type = normalize_field_type(item.get("fieldType"), value)

        normalized.append(
            make_field(
                name,
                value,
                label=string_value(item.get("label")) or None,
                required=bool(item.get("required")),
                confidence=confidence,
                field_type=field_type,
                currency=string_value(item.get("currency")) or None,
                validation_status=normalize_validation_status_value(
                    item.get("validationStatus"),
                ),
            )
        )

    return normalized


def normalize_source_references(raw_references: Any) -> list[SourceReferencePayload]:
    if not isinstance(raw_references, list):
        return []

    references = []
    for item in raw_references:
        if not isinstance(item, dict):
            continue
        references.append(
            SourceReferencePayload(
                fieldName=snake_case(string_value(item.get("fieldName"))) or None,
                pageNumber=optional_int(item.get("pageNumber")),
                paragraphIndex=optional_int(item.get("paragraphIndex")),
                lineStart=optional_int(item.get("lineStart")),
                lineEnd=optional_int(item.get("lineEnd")),
                charStart=optional_int(item.get("charStart")),
                charEnd=optional_int(item.get("charEnd")),
                evidenceSnippet=trim_snippet(string_value(item.get("evidenceSnippet"))),
            )
        )

    return references


def make_field(
    name: str,
    value: Any,
    *,
    label: str | None = None,
    required: bool = False,
    confidence: float | None = None,
    field_type: str | None = None,
    currency: str | None = None,
    validation_status: str | None = None,
) -> ExtractedFieldPayload:
    normalized_name = snake_case(name)
    field_type = normalize_field_type(field_type, value)
    has_value = value is not None and value != "" and value != []
    confidence = confidence if confidence is not None else (0.86 if has_value else 0.25)
    validation_status = validation_status or (
        "passed" if has_value and confidence >= 0.85 else "needs_review"
    )

    value_string = None
    value_number = None
    value_date = None
    value_json = None

    if field_type in {"STRING", "BOOLEAN"}:
        value_string = string_value(value) or None
    elif field_type == "DATE":
        value_date = string_value(value) or None
    elif field_type in {"NUMBER", "CURRENCY"}:
        value_number = number_value(value)
        value_string = string_value(value) if value_number is None else None
    else:
        value_json = decode_json_like(value)

    return ExtractedFieldPayload(
        name=normalized_name,
        label=label or title_case(normalized_name),
        fieldType=field_type,
        valueString=value_string,
        valueNumber=value_number,
        valueDate=value_date,
        currency=currency,
        valueJson=value_json,
        confidence=round(clamp_float(confidence), 2),
        required=required,
        validationStatus=normalize_validation_status_value(validation_status),
    )


def field_has_value(field: ExtractedFieldPayload) -> bool:
    return any(
        value is not None and value != "" and value != []
        for value in [
            field.value_string,
            field.value_number,
            field.value_date,
            field.value_json,
        ]
    )


def source_reference_for_field(
    parsed_document: ParsedDocument,
    field: ExtractedFieldPayload,
) -> SourceReferencePayload:
    evidence_value = field.value_string
    if evidence_value is None and field.value_number is not None:
        evidence_value = str(field.value_number)
    if evidence_value is None and field.value_date:
        evidence_value = field.value_date
    if evidence_value is None and field.value_json is not None:
        evidence_value = json.dumps(field.value_json)[:80]
    source = find_source(parsed_document.sources, field.name, evidence_value)

    return SourceReferencePayload(
        fieldName=field.name,
        pageNumber=source.page_number,
        paragraphIndex=source.paragraph_index,
        lineStart=source.line_start,
        lineEnd=source.line_end,
        charStart=source.char_start,
        charEnd=source.char_end,
        evidenceSnippet=trim_snippet(source.text),
    )


def find_source(
    sources: list[TextSource],
    field_name: str,
    evidence_value: str | None,
) -> TextSource:
    candidates = [source for source in sources if source.text.strip()]
    evidence = (evidence_value or "").lower()

    if evidence:
        for source in candidates:
            if evidence in source.text.lower():
                return source

    label_tokens = [token for token in field_name.lower().split("_") if len(token) > 2]
    for source in candidates:
        text = source.text.lower()
        if any(token in text for token in label_tokens):
            return source

    return candidates[0] if candidates else TextSource(text="")


def heuristic_missing_required_fields(
    document_type: str,
    fields: list[ExtractedFieldPayload],
) -> list[str]:
    required_names = set(COMMON_FIELD_NAMES) | set(REQUIRED_TYPE_FIELDS[document_type])
    return [
        name
        for name in sorted(required_names)
        if not any(field.name == name and field_has_value(field) for field in fields)
    ]


def compute_heuristic_document_confidence(
    *,
    fields: list[ExtractedFieldPayload],
    document_type: str,
    missing_required: list[str],
) -> float:
    if not fields:
        return 0.0

    required_names = set(COMMON_FIELD_NAMES) | set(REQUIRED_TYPE_FIELDS[document_type])
    present_required = [
        field
        for field in fields
        if field.name in required_names and field.name not in set(missing_required)
    ]
    required_ratio = len(present_required) / max(len(required_names), 1)
    average_confidence = sum(field.confidence for field in fields if field_has_value(field)) / max(
        len([field for field in fields if field_has_value(field)]),
        1,
    )
    confidence = (average_confidence * 0.7) + (required_ratio * 0.3)

    return round(max(0.0, min(confidence, 1.0)), 2)


def chat_reply(
    document_type: str,
    status: str,
    confidence: float,
    fields: list[ExtractedFieldPayload],
    key_facts: list[str],
    warnings: list[str],
) -> str:
    visible_fields = []
    for field in fields:
        if not field_has_value(field):
            continue
        value = compact_field_value(field)
        if value:
            visible_fields.append(f"{title_case(field.name)}: {value}")
        if len(visible_fields) >= 3:
            break

    field_summary = (
        "; ".join(visible_fields) if visible_fields else "No type-specific fields found."
    )
    if not visible_fields and key_facts:
        field_summary = "Key facts: " + "; ".join(shorten_text(fact, 90) for fact in key_facts[:2])
    review_text = f" Review warning: {warnings[0]}" if warnings else ""

    return (
        f"Processed as {title_case(document_type)} with {round(confidence * 100)}% confidence. "
        f"{field_summary}.{review_text}"
        if status == "extracted"
        else f"Processed as {title_case(document_type)}, but it needs review "
        f"({round(confidence * 100)}% confidence). {field_summary}.{review_text}"
    )


def display_field_value(field: ExtractedFieldPayload) -> str:
    if field.value_number is not None:
        prefix = f"{field.currency} " if field.currency else ""
        return f"{prefix}{field.value_number:g}"
    if field.value_date:
        return field.value_date
    if field.value_string:
        return field.value_string
    if field.value_json is not None:
        decoded = decode_json_like(field.value_json)
        if isinstance(decoded, list):
            return ", ".join(format_json_item(item) for item in decoded[:3])
        if isinstance(decoded, dict):
            return "; ".join(
                f"{title_case(str(key))}: {format_json_item(value)}"
                for key, value in list(decoded.items())[:3]
            )
        return str(decoded)
    return "missing"


def compact_field_value(field: ExtractedFieldPayload) -> str | None:
    if field.value_json is not None:
        decoded = decode_json_like(field.value_json)
        if isinstance(decoded, list):
            if all(not isinstance(item, dict | list) for item in decoded):
                return shorten_text(", ".join(str(item) for item in decoded[:3]), 110)
            return f"{len(decoded)} structured item{'s' if len(decoded) != 1 else ''} captured"
        if isinstance(decoded, dict):
            readable_items = [
                f"{title_case(str(key))}: {format_json_item(value)}"
                for key, value in decoded.items()
                if not isinstance(value, dict | list) and format_json_item(value)
            ][:2]
            return (
                shorten_text("; ".join(readable_items), 110)
                if readable_items
                else "structured details captured"
            )

    value = display_field_value(field)
    if not value or value == "missing":
        return None
    return shorten_text(value, 110)


def decode_json_like(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def format_json_item(value: Any) -> str:
    if isinstance(value, dict):
        readable_items = [
            f"{title_case(str(key))}: {format_json_item(item)}"
            for key, item in value.items()
            if not isinstance(item, dict | list)
        ][:2]
        return "; ".join(readable_items) if readable_items else "structured details"
    if isinstance(value, list):
        return ", ".join(format_json_item(item) for item in value[:3])
    return str(value)


def title_from_document(text: str, filename: str) -> str:
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    return first_line[:90] if first_line else Path(filename).stem.replace("-", " ").title()


def summarize_text(text: str, document_type: str) -> str:
    words = " ".join(text.split())
    if not words:
        return f"{title_case(document_type)} document with no readable summary."
    return words[:220] + ("..." if len(words) > 220 else "")


def extract_key_facts(text: str) -> list[str]:
    lines = [line.strip(" -\t") for line in text.splitlines() if line.strip()]
    facts = [line for line in lines if len(line) >= 12][:5]

    if facts:
        return facts

    words = " ".join(text.split())
    return [words[:160]] if words else []


def tags_for_document(document_type: str, text: str) -> list[str]:
    tags = [document_type.lower()]
    lower_text = text.lower()

    for candidate in ["finance", "revenue", "legal", "operations", "policy", "payment"]:
        if candidate in lower_text:
            tags.append(candidate)

    return list(dict.fromkeys(tags))[:6]


def labeled_value(text: str, labels: list[str], *, default: str | None = None) -> str | None:
    for label in labels:
        pattern = rf"(?im)^\s*{re.escape(label)}\s*(?:[:#-]|\bnumber\b)?\s*[:#-]?\s*(.+?)\s*$"
        match = re.search(pattern, text)
        if match:
            value = match.group(1).strip()
            if value:
                return value[:160]

    return default


def contract_parties(text: str) -> str | None:
    explicit = labeled_value(text, ["parties", "between"])
    if explicit:
        return explicit

    match = re.search(r"(?is)\bbetween\s+(.{2,80}?)\s+and\s+(.{2,80}?)(?:\.|\n|,)", text)
    if match:
        return f"{match.group(1).strip()} and {match.group(2).strip()}"

    return None


def extract_amount_and_currency(text: str) -> tuple[float | None, str | None]:
    pattern = re.compile(
        r"(?i)(?:total|amount due|grand total|balance due|amount)[^\d$A-Z]{0,30}"
        r"(?P<currency>USD|AUD|EUR|GBP|\$)?\s*(?P<amount>[0-9][0-9,]*(?:\.[0-9]{2})?)"
    )
    match = pattern.search(text)

    if not match:
        return None, None

    amount = number_value(match.group("amount"))
    raw_currency = match.group("currency")
    currency = "USD" if raw_currency == "$" else raw_currency

    return amount, currency


def normalize_document_type(value: Any) -> str:
    document_type = string_value(value).upper()
    return document_type if document_type in DOCUMENT_TYPES else "UNKNOWN"


def normalize_validation_status_value(value: Any) -> str:
    validation_status = string_value(value).lower()
    if validation_status in {"passed", "needs_review", "failed"}:
        return validation_status
    return "needs_review"


def normalize_field_type(value: Any, field_value: Any) -> str:
    field_type = string_value(value).upper()
    if field_type in {"STRING", "NUMBER", "DATE", "CURRENCY", "BOOLEAN", "JSON"}:
        return field_type

    if isinstance(field_value, bool):
        return "BOOLEAN"
    if isinstance(field_value, int | float):
        return "NUMBER"
    if isinstance(field_value, list | dict):
        return "JSON"

    value_text = string_value(field_value)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value_text):
        return "DATE"
    if re.fullmatch(r"\$?\s*-?[0-9][0-9,]*(?:\.[0-9]+)?", value_text):
        return "NUMBER"

    return "STRING"


def string_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [string_value(item) for item in value if string_value(item)]


def number_value(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, int | float):
        return float(value)

    match = re.search(r"-?[0-9][0-9,]*(?:\.[0-9]+)?", str(value))
    if not match:
        return None

    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def clamp_float(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    return max(0.0, min(parsed, 1.0))


def first_present(*values: Any) -> Any:
    for value in values:
        if value is not None and value != "":
            return value
    return None


def snake_case(value: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", value.lower())).strip("_")


def title_case(value: str) -> str:
    return value.replace("_", " ").title()


def trim_snippet(value: str, limit: int = 260) -> str | None:
    cleaned = " ".join(value.split())
    if not cleaned:
        return None
    return cleaned[:limit] + ("..." if len(cleaned) > limit else "")


def shorten_text(value: str, limit: int = 120) -> str:
    cleaned = " ".join(value.split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: max(limit - 3, 0)].rstrip() + "..."


def has_any(text: str, terms: list[str]) -> bool:
    return any(term in text for term in terms)


def truncate_for_model(text: str, limit: int = 24_000) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n\n[Document text truncated for extraction.]"
