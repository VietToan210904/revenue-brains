from pathlib import Path

import httpx
from docx import Document as DocxDocument
from fastapi.testclient import TestClient

import app.agents.autonomous_team_graph as autonomous_team_graph
import app.agents.ingestion_graph as ingestion_graph
import app.agents.supervisor_graph as supervisor_graph
import app.extraction as extraction
import app.routers.agent as agent_router
import app.routers.qa as qa_router
from app.extraction import EXTRACTION_JSON_SCHEMA, classify_document
from app.main import create_app
from app.schemas import (
    DocumentProcessResponse,
    QaAnswerResponse,
    QaCitationPayload,
    QaPlanResponse,
    VectorReferencePayload,
)

client = TestClient(create_app())


def write_upload(upload_root: Path, storage_key: str, content: str) -> None:
    path = upload_root.joinpath(*storage_key.split("/"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def write_docx_upload(upload_root: Path, storage_key: str, paragraphs: list[str]) -> None:
    path = upload_root.joinpath(*storage_key.split("/"))
    path.parent.mkdir(parents=True, exist_ok=True)
    document = DocxDocument()
    for paragraph in paragraphs:
        document.add_paragraph(paragraph)
    document.save(path)


def write_pdf_upload(upload_root: Path, storage_key: str, lines: list[str]) -> None:
    path = upload_root.joinpath(*storage_key.split("/"))
    path.parent.mkdir(parents=True, exist_ok=True)
    escaped_lines = [
        line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") for line in lines
    ]
    content_stream = (
        "BT /F1 12 Tf 72 720 Td " + " T* ".join(f"({line}) Tj" for line in escaped_lines) + " ET"
    )
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
        ),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        (
            f"<< /Length {len(content_stream.encode())} >>\nstream\n{content_stream}\nendstream"
        ).encode(),
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{index} 0 obj\n".encode())
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")
    xref_offset = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        pdf.extend(f"{offset:010d} 00000 n \n".encode())
    pdf.extend(
        (
            f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"
        ).encode()
    )
    path.write_bytes(bytes(pdf))


def base_payload(storage_key: str, filename: str, content_type: str) -> dict[str, object]:
    return {
        "conversationId": "conv_123",
        "messageId": "msg_123",
        "documentId": "doc_123",
        "workspaceId": "workspace_123",
        "fileStorageKey": storage_key,
        "checksum": "sha256:placeholder",
        "originalFilename": filename,
        "contentType": content_type,
        "userInstructions": "Extract the important business fields.",
        "processingOptions": {"extractorMode": "heuristic"},
    }


def openai_payload(storage_key: str, filename: str, content_type: str) -> dict[str, object]:
    payload = base_payload(storage_key, filename, content_type)
    payload["processingOptions"] = {"vectorMode": "disabled"}
    return payload


def assert_strict_schema_objects_require_all_properties(schema: object) -> None:
    if isinstance(schema, dict):
        is_strict_object = schema.get("additionalProperties") is False
        has_properties = isinstance(schema.get("properties"), dict)
        if is_strict_object and has_properties:
            assert set(schema.get("required", [])) == set(schema["properties"])

        for value in schema.values():
            assert_strict_schema_objects_require_all_properties(value)

    if isinstance(schema, list):
        for item in schema:
            assert_strict_schema_objects_require_all_properties(item)


def model_field(
    name: str,
    field_type: str,
    value_string: str | None = None,
    *,
    value_number: float | None = None,
    value_date: str | None = None,
    currency: str | None = None,
    confidence: float = 0.92,
    required: bool = False,
    validation_status: str = "passed",
) -> dict[str, object]:
    return {
        "name": name,
        "label": name.replace("_", " ").title(),
        "fieldType": field_type,
        "valueString": value_string,
        "valueNumber": value_number,
        "valueDate": value_date,
        "currency": currency,
        "valueJson": None,
        "confidence": confidence,
        "required": required,
        "validationStatus": validation_status,
    }


def model_reference(field_name: str, snippet: str) -> dict[str, object]:
    return {
        "fieldName": field_name,
        "pageNumber": None,
        "paragraphIndex": None,
        "lineStart": 1,
        "lineEnd": 1,
        "charStart": None,
        "charEnd": None,
        "evidenceSnippet": snippet,
    }


def agent_assessment(
    *,
    status: str = "extracted",
    validation_status: str = "passed",
    confidence: float = 0.91,
    review_required: bool = False,
    review_reasons: list[str] | None = None,
    missing_fields: list[str] | None = None,
    uncertain_fields: list[str] | None = None,
) -> dict[str, object]:
    return {
        "status": status,
        "validationStatus": validation_status,
        "documentConfidence": confidence,
        "reviewRequired": review_required,
        "reviewReasons": review_reasons or [],
        "missingFields": missing_fields or [],
        "uncertainFields": uncertain_fields or [],
        "automationDecision": "safe_to_save" if status == "extracted" else "save_for_review",
        "automationDecisionReason": "Agent decided based on document evidence.",
    }


def successful_invoice_payload() -> dict[str, object]:
    return {
        "documentType": "INVOICE",
        "title": "Invoice INV-1001",
        "summary": "Invoice from Acme Cloud for hosted services.",
        "keyFacts": ["Vendor: Acme Cloud", "Invoice Number: INV-1001"],
        "tags": ["invoice", "finance"],
        "commonFields": [
            model_field("title", "STRING", "Invoice INV-1001", required=True),
            model_field("source_filename", "STRING", "invoice.txt", required=True),
            model_field("document_type", "STRING", "INVOICE", required=True),
            model_field(
                "summary",
                "STRING",
                "Invoice from Acme Cloud for hosted services.",
                required=True,
            ),
        ],
        "typeSpecificFields": [
            model_field("vendor", "STRING", "Acme Cloud", required=True),
            model_field("invoice_number", "STRING", "INV-1001", required=True),
            model_field("invoice_date", "DATE", value_date="2026-05-06", required=True),
            model_field(
                "total_amount",
                "CURRENCY",
                value_number=1250.0,
                currency="USD",
                required=True,
            ),
            model_field("currency", "STRING", "USD", required=True),
        ],
        "sourceReferences": [
            model_reference("invoice_number", "Invoice Number: INV-1001"),
            model_reference("vendor", "Vendor: Acme Cloud"),
        ],
        "agentAssessment": agent_assessment(confidence=0.93),
    }


def unknown_resume_payload() -> dict[str, object]:
    return {
        "documentType": "UNKNOWN",
        "title": "Resume of Anh Hoang Phuc Nguyen",
        "summary": "AI and data engineering resume with education and work experience.",
        "keyFacts": [
            "AI and machine learning engineer with data science experience.",
            "Experience includes Python, PyTorch, cloud services, and data pipelines.",
        ],
        "tags": ["resume", "candidate_profile"],
        "commonFields": [
            model_field("title", "STRING", "Resume of Anh Hoang Phuc Nguyen", required=True),
            model_field("source_filename", "STRING", "resume.pdf", required=True),
            model_field("document_type", "STRING", "UNKNOWN", required=True),
            model_field(
                "summary",
                "STRING",
                "AI and data engineering resume with education and work experience.",
                required=True,
            ),
        ],
        "typeSpecificFields": [
            {
                **model_field("education_1", "JSON"),
                "valueJson": extraction.json.dumps(
                    {
                        "degree": "Master of Artificial Intelligence",
                        "institution": "University of Technology Sydney",
                        "period": "2024-2025",
                    }
                ),
            },
            model_field("primary_skill", "STRING", "Python"),
        ],
        "sourceReferences": [],
        "agentAssessment": agent_assessment(confidence=0.91),
    }


def needs_review_payload() -> dict[str, object]:
    return {
        "documentType": "CONTRACT",
        "title": "Incomplete Agreement",
        "summary": "Agreement with unclear renewal and signature details.",
        "keyFacts": ["Agreement references services but omits the effective date."],
        "tags": ["contract", "needs_review"],
        "commonFields": [
            model_field("title", "STRING", "Incomplete Agreement", required=True),
            model_field("source_filename", "STRING", "contract.txt", required=True),
            model_field("document_type", "STRING", "CONTRACT", required=True),
            model_field(
                "summary",
                "STRING",
                "Agreement with unclear renewal and signature details.",
                required=True,
            ),
        ],
        "typeSpecificFields": [
            model_field("primary_parties", "STRING", "Revenue Brains and Example Co"),
            model_field(
                "effective_date",
                "DATE",
                value_date=None,
                confidence=0.35,
                required=True,
                validation_status="needs_review",
            ),
        ],
        "sourceReferences": [
            model_reference("primary_parties", "Revenue Brains and Example Co"),
        ],
        "agentAssessment": agent_assessment(
            status="needs_review",
            validation_status="needs_review",
            confidence=0.67,
            review_required=True,
            review_reasons=["The effective date is unclear."],
            missing_fields=["effective_date"],
            uncertain_fields=["effective_date"],
        ),
    }


def document_process_response(document_id: str = "doc_123") -> DocumentProcessResponse:
    payload = successful_invoice_payload()
    return DocumentProcessResponse.model_validate(
        {
            "status": "extracted",
            "documentId": document_id,
            "documentType": payload["documentType"],
            "title": payload["title"],
            "commonFields": payload["commonFields"],
            "typeSpecificFields": payload["typeSpecificFields"],
            "summary": payload["summary"],
            "keyFacts": payload["keyFacts"],
            "tags": payload["tags"],
            "documentConfidence": 0.93,
            "fieldConfidences": {"invoice_number": 0.93},
            "validation": {
                "status": "passed",
                "missingRequiredFields": [],
                "warnings": [],
            },
            "agentAssessment": payload["agentAssessment"],
            "sourceReferences": payload["sourceReferences"],
            "vectorReferences": [],
            "chatReply": "Processed as Invoice with 93% confidence.",
            "processingImplemented": True,
        }
    )


def malformed_assessment_payload() -> dict[str, object]:
    return {
        "documentType": "INVOICE",
        "title": "Invoice INV-1001",
        "summary": "Invoice from Acme Cloud.",
        "keyFacts": ["Vendor: Acme Cloud"],
        "tags": ["invoice"],
        "commonFields": [model_field("title", "STRING", "Invoice INV-1001")],
        "typeSpecificFields": [model_field("vendor", "STRING", "Acme Cloud")],
        "sourceReferences": [],
        "agentAssessment": {
            "status": "definitely_done",
            "documentConfidence": 2,
        },
    }


def raise_bad_request(**_kwargs: object) -> dict[str, object]:
    request = httpx.Request("POST", "https://api.openai.com/v1/responses")
    response = httpx.Response(400, request=request)
    raise extraction.BadRequestError(
        "schema rejected because of unsupported content",
        response=response,
        body={"error": {"message": "schema rejected"}},
    )


class FakeResponse:
    def __init__(self, output_text: str) -> None:
        self.output_text = output_text


class FakeSuccessfulOpenAI:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.responses = self

    def create(self, **kwargs: object) -> FakeResponse:
        assert kwargs["text"]["format"]["strict"] is True  # type: ignore[index]
        payload = {
            "documentType": "INVOICE",
            "title": "Invoice INV-1001",
            "summary": "Invoice from Acme Cloud for hosted services.",
            "keyFacts": ["Vendor: Acme Cloud", "Invoice Number: INV-1001"],
            "tags": ["invoice", "finance"],
            "commonFields": [
                model_field("title", "STRING", "Invoice INV-1001", required=True),
                model_field("source_filename", "STRING", "invoice.txt", required=True),
                model_field("document_type", "STRING", "INVOICE", required=True),
                model_field(
                    "summary",
                    "STRING",
                    "Invoice from Acme Cloud for hosted services.",
                    required=True,
                ),
            ],
            "typeSpecificFields": [
                model_field("vendor", "STRING", "Acme Cloud", required=True),
                model_field("invoice_number", "STRING", "INV-1001", required=True),
                model_field("invoice_date", "DATE", value_date="2026-05-06", required=True),
                model_field(
                    "total_amount",
                    "CURRENCY",
                    value_number=1250.0,
                    currency="USD",
                    required=True,
                ),
                model_field("currency", "STRING", "USD", required=True),
            ],
            "sourceReferences": [
                model_reference("invoice_number", "Invoice Number: INV-1001"),
                model_reference("vendor", "Vendor: Acme Cloud"),
            ],
            "agentAssessment": agent_assessment(confidence=0.93),
        }
        return FakeResponse(extraction.json.dumps(payload))


class FakeUnknownResumeOpenAI:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.responses = self

    def create(self, **_kwargs: object) -> FakeResponse:
        payload = {
            "documentType": "UNKNOWN",
            "title": "Resume of Anh Hoang Phuc Nguyen",
            "summary": "AI and data engineering resume with education and work experience.",
            "keyFacts": [
                "AI and machine learning engineer with data science experience.",
                "Experience includes Python, PyTorch, cloud services, and data pipelines.",
            ],
            "tags": ["resume", "candidate_profile"],
            "commonFields": [
                model_field("title", "STRING", "Resume of Anh Hoang Phuc Nguyen", required=True),
                model_field("source_filename", "STRING", "resume.pdf", required=True),
                model_field("document_type", "STRING", "UNKNOWN", required=True),
                model_field(
                    "summary",
                    "STRING",
                    "AI and data engineering resume with education and work experience.",
                    required=True,
                ),
            ],
            "typeSpecificFields": [
                {
                    **model_field("education_1", "JSON"),
                    "valueJson": extraction.json.dumps(
                        {
                            "degree": "Master of Artificial Intelligence",
                            "institution": "University of Technology Sydney",
                            "period": "2024-2025",
                        }
                    ),
                },
                model_field("primary_skill", "STRING", "Python"),
            ],
            "sourceReferences": [],
            "agentAssessment": agent_assessment(confidence=0.91),
        }
        return FakeResponse(extraction.json.dumps(payload))


class FakeNeedsReviewOpenAI:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.responses = self

    def create(self, **_kwargs: object) -> FakeResponse:
        payload = {
            "documentType": "CONTRACT",
            "title": "Incomplete Agreement",
            "summary": "Agreement with unclear renewal and signature details.",
            "keyFacts": ["Agreement references services but omits the effective date."],
            "tags": ["contract", "needs_review"],
            "commonFields": [
                model_field("title", "STRING", "Incomplete Agreement", required=True),
                model_field("source_filename", "STRING", "contract.txt", required=True),
                model_field("document_type", "STRING", "CONTRACT", required=True),
                model_field(
                    "summary",
                    "STRING",
                    "Agreement with unclear renewal and signature details.",
                    required=True,
                ),
            ],
            "typeSpecificFields": [
                model_field("primary_parties", "STRING", "Revenue Brains and Example Co"),
                model_field(
                    "effective_date",
                    "DATE",
                    value_date=None,
                    confidence=0.35,
                    required=True,
                    validation_status="needs_review",
                ),
            ],
            "sourceReferences": [
                model_reference("primary_parties", "Revenue Brains and Example Co"),
            ],
            "agentAssessment": agent_assessment(
                status="needs_review",
                validation_status="needs_review",
                confidence=0.67,
                review_required=True,
                review_reasons=["The effective date is unclear."],
                missing_fields=["effective_date"],
                uncertain_fields=["effective_date"],
            ),
        }
        return FakeResponse(extraction.json.dumps(payload))


class FakeMalformedAssessmentOpenAI:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.responses = self

    def create(self, **_kwargs: object) -> FakeResponse:
        payload = {
            "documentType": "INVOICE",
            "title": "Invoice INV-1001",
            "summary": "Invoice from Acme Cloud.",
            "keyFacts": ["Vendor: Acme Cloud"],
            "tags": ["invoice"],
            "commonFields": [model_field("title", "STRING", "Invoice INV-1001")],
            "typeSpecificFields": [model_field("vendor", "STRING", "Acme Cloud")],
            "sourceReferences": [],
            "agentAssessment": {
                "status": "definitely_done",
                "documentConfidence": 2,
            },
        }
        return FakeResponse(extraction.json.dumps(payload))


class FakeBadRequestOpenAI:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.responses = self

    def create(self, **_kwargs: object) -> FakeResponse:
        request = httpx.Request("POST", "https://api.openai.com/v1/responses")
        response = httpx.Response(400, request=request)
        raise extraction.BadRequestError(
            "schema rejected because of unsupported content",
            response=response,
            body={"error": {"message": "schema rejected"}},
        )


def test_health_returns_process_status() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "agent"}


def test_openai_schema_is_strict_compatible() -> None:
    assert_strict_schema_objects_require_all_properties(EXTRACTION_JSON_SCHEMA)


def test_documents_process_extracts_text_invoice(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setenv("UPLOAD_STORAGE_PATH", str(upload_root))
    write_upload(
        upload_root,
        "documents/invoice.txt",
        "\n".join(
            [
                "Invoice",
                "Vendor: Acme Cloud",
                "Invoice Number: INV-1001",
                "Invoice Date: 2026-05-06",
                "Total: $1250.00",
            ]
        ),
    )

    response = client.post(
        "/documents/process",
        json=base_payload("documents/invoice.txt", "invoice.txt", "text/plain"),
    )

    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "extracted"
    assert body["documentType"] == "INVOICE"
    assert body["processingImplemented"] is True
    assert body["documentConfidence"] >= 0.85
    assert body["fieldConfidences"]["invoice_number"] >= 0.85
    assert body["sourceReferences"]


def test_documents_process_extracts_with_mocked_openai(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setenv("UPLOAD_STORAGE_PATH", str(upload_root))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(
        extraction,
        "extract_payload_with_langchain",
        lambda **_kwargs: successful_invoice_payload(),
    )
    write_upload(
        upload_root,
        "documents/openai-invoice.txt",
        "\n".join(
            [
                "Invoice",
                "Vendor: Acme Cloud",
                "Invoice Number: INV-1001",
                "Invoice Date: 2026-05-06",
                "Total: $1250.00",
            ]
        ),
    )

    response = client.post(
        "/documents/process",
        json=openai_payload("documents/openai-invoice.txt", "invoice.txt", "text/plain"),
    )

    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "extracted"
    assert body["documentType"] == "INVOICE"
    assert body["fieldConfidences"]["invoice_number"] >= 0.9


def test_documents_process_returns_vector_references_when_enabled(
    tmp_path: Path,
    monkeypatch,
) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setenv("UPLOAD_STORAGE_PATH", str(upload_root))
    write_upload(
        upload_root,
        "documents/vector-invoice.txt",
        "Invoice Number: INV-VECTOR-1\nVendor: Vector Co\nTotal: $100.00",
    )

    def fake_store_chunks(
        chunks: object,
        *,
        document_type: str,
    ) -> list[VectorReferencePayload]:
        assert document_type == "INVOICE"
        assert chunks
        return [
            VectorReferencePayload(
                chunkId="doc_123:chunk:0",
                qdrantCollection="revenue_brains_documents",
                qdrantPointId="point_123",
                chunkIndex=0,
                contentPreview="Invoice Number: INV-VECTOR-1",
                metadata={"workspaceId": "workspace_123", "documentId": "doc_123"},
            )
        ]

    monkeypatch.setattr(ingestion_graph, "store_chunks_in_qdrant", fake_store_chunks)
    payload = base_payload("documents/vector-invoice.txt", "invoice.txt", "text/plain")
    payload["processingOptions"] = {"extractorMode": "heuristic", "vectorMode": "mock"}

    response = client.post("/documents/process", json=payload)

    body = response.json()
    assert response.status_code == 200
    assert body["vectorReferences"] == [
        {
            "chunkId": "doc_123:chunk:0",
            "qdrantCollection": "revenue_brains_documents",
            "qdrantPointId": "point_123",
            "chunkIndex": 0,
            "contentPreview": "Invoice Number: INV-VECTOR-1",
            "metadata": {"workspaceId": "workspace_123", "documentId": "doc_123"},
        }
    ]


def test_unknown_openai_result_can_be_high_confidence(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setenv("UPLOAD_STORAGE_PATH", str(upload_root))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(
        extraction,
        "extract_payload_with_langchain",
        lambda **_kwargs: unknown_resume_payload(),
    )
    write_pdf_upload(upload_root, "documents/resume.pdf", ["Resume", "Python and AI experience."])

    response = client.post(
        "/documents/process",
        json=openai_payload("documents/resume.pdf", "resume.pdf", "application/pdf"),
    )

    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "extracted"
    assert body["documentType"] == "UNKNOWN"
    assert body["documentConfidence"] == 0.91
    assert body["agentAssessment"]["status"] == "extracted"
    assert body["agentAssessment"]["reviewRequired"] is False
    assert "key_facts" not in body["validation"]["missingRequiredFields"]
    assert "tags" not in body["validation"]["missingRequiredFields"]
    assert len(body["chatReply"]) < 350
    assert "{" not in body["chatReply"]


def test_openai_agent_assessment_can_require_review(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setenv("UPLOAD_STORAGE_PATH", str(upload_root))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(
        extraction,
        "extract_payload_with_langchain",
        lambda **_kwargs: needs_review_payload(),
    )
    write_upload(upload_root, "documents/contract.txt", "Agreement between parties.")

    response = client.post(
        "/documents/process",
        json=openai_payload("documents/contract.txt", "contract.txt", "text/plain"),
    )

    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "needs_review"
    assert body["documentConfidence"] == 0.67
    assert body["validation"]["missingRequiredFields"] == ["effective_date"]
    assert body["validation"]["warnings"] == ["The effective date is unclear."]
    assert body["agentAssessment"]["automationDecision"] == "save_for_review"


def test_documents_process_returns_safe_error_for_malformed_agent_assessment(
    tmp_path: Path,
    monkeypatch,
) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setenv("UPLOAD_STORAGE_PATH", str(upload_root))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(
        extraction,
        "extract_payload_with_langchain",
        lambda **_kwargs: malformed_assessment_payload(),
    )
    secret_document_text = "Invoice Number: SHOULD_NOT_LEAK"
    write_upload(upload_root, "documents/malformed-assessment.txt", secret_document_text)

    response = client.post(
        "/documents/process",
        json=openai_payload(
            "documents/malformed-assessment.txt",
            "invoice.txt",
            "text/plain",
        ),
    )

    body = response.json()
    assert response.status_code == 422
    assert body["status"] == "error"
    assert body["code"] == "invalid_agent_assessment"
    assert "SHOULD_NOT_LEAK" not in response.text


def test_documents_process_returns_safe_openai_bad_request_error(
    tmp_path: Path,
    monkeypatch,
) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setenv("UPLOAD_STORAGE_PATH", str(upload_root))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(extraction, "extract_payload_with_langchain", raise_bad_request)
    secret_document_text = "Invoice Number: SHOULD_NOT_LEAK"
    write_upload(upload_root, "documents/bad-schema.txt", secret_document_text)

    response = client.post(
        "/documents/process",
        json=openai_payload("documents/bad-schema.txt", "invoice.txt", "text/plain"),
    )

    body = response.json()
    assert response.status_code == 502
    assert body["status"] == "error"
    assert body["code"] == "model_request_failed"
    assert body["message"] == "Extraction model request failed: structured schema rejected."
    assert "SHOULD_NOT_LEAK" not in response.text


def test_documents_process_extracts_markdown_knowledge(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setenv("UPLOAD_STORAGE_PATH", str(upload_root))
    write_upload(
        upload_root,
        "documents/policy.md",
        "# Refund Policy\n\nThis guide explains revenue operations refund approvals.",
    )

    response = client.post(
        "/documents/process",
        json=base_payload("documents/policy.md", "policy.md", "text/markdown"),
    )

    body = response.json()
    assert response.status_code == 200
    assert body["documentType"] == "KNOWLEDGE"
    assert body["keyFacts"]


def test_documents_process_extracts_text_pdf(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setenv("UPLOAD_STORAGE_PATH", str(upload_root))
    write_pdf_upload(
        upload_root,
        "documents/invoice.pdf",
        [
            "Invoice Number: INV-PDF-1",
            "Vendor: PDF Co",
            "Invoice Date: 2026-05-06",
            "Total: $42.00",
        ],
    )

    response = client.post(
        "/documents/process",
        json=base_payload("documents/invoice.pdf", "invoice.pdf", "application/pdf"),
    )

    body = response.json()
    assert response.status_code == 200
    assert body["documentType"] == "INVOICE"
    assert any(reference["pageNumber"] == 1 for reference in body["sourceReferences"])


def test_documents_process_extracts_docx_contract(tmp_path: Path, monkeypatch) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setenv("UPLOAD_STORAGE_PATH", str(upload_root))
    write_docx_upload(
        upload_root,
        "documents/contract.docx",
        [
            "Master Services Agreement",
            "Parties: Revenue Brains and Example Customer",
            "Effective Date: 2026-05-06",
            "Payment Terms: Net 30",
        ],
    )

    response = client.post(
        "/documents/process",
        json=base_payload(
            "documents/contract.docx",
            "contract.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
    )

    body = response.json()
    assert response.status_code == 200
    assert body["documentType"] == "CONTRACT"
    assert body["status"] in {"extracted", "needs_review"}


def test_documents_process_marks_missing_required_fields_for_review(
    tmp_path: Path,
    monkeypatch,
) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setenv("UPLOAD_STORAGE_PATH", str(upload_root))
    write_upload(upload_root, "documents/invoice.md", "Invoice\nVendor: Missing Fields LLC")

    response = client.post(
        "/documents/process",
        json=base_payload("documents/invoice.md", "invoice.md", "text/markdown"),
    )

    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "needs_review"
    assert "invoice_number" in body["validation"]["missingRequiredFields"]


def test_documents_process_returns_structured_error_for_missing_file(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("UPLOAD_STORAGE_PATH", str(tmp_path / "uploads"))

    response = client.post(
        "/documents/process",
        json=base_payload("documents/missing.txt", "missing.txt", "text/plain"),
    )

    body = response.json()
    assert response.status_code == 404
    assert body["status"] == "error"
    assert body["code"] == "missing_file"
    assert body["documentId"] == "doc_123"


def test_documents_process_returns_structured_error_for_unsupported_format(
    tmp_path: Path,
    monkeypatch,
) -> None:
    upload_root = tmp_path / "uploads"
    monkeypatch.setenv("UPLOAD_STORAGE_PATH", str(upload_root))
    write_upload(upload_root, "documents/sheet.csv", "Invoice Number,Total\n1,2")

    response = client.post(
        "/documents/process",
        json=base_payload("documents/sheet.csv", "sheet.csv", "text/csv"),
    )

    body = response.json()
    assert response.status_code == 415
    assert body["status"] == "error"
    assert body["code"] == "unsupported_format"


def test_classifier_covers_supported_document_types() -> None:
    examples = {
        "INVOICE": "Invoice Number: INV-1\nInvoice Date: 2026-05-06\nAmount Due: $10",
        "CONTRACT": "This agreement has an effective date and renewal terms.",
        "PURCHASE_ORDER": "Purchase Order\nPO Number: PO-1\nBuyer: Example Co",
        "RECEIPT_EXPENSE": "Receipt\nMerchant: Cafe\nTransaction Date: 2026-05-06",
        "KNOWLEDGE": "Policy guide for revenue operations approval process.",
        "UNKNOWN": "A short note with no clear business document signals.",
    }

    for expected, text in examples.items():
        assert classify_document(text) == expected


def test_qa_plan_returns_retrieval_plan(monkeypatch) -> None:
    def fake_plan(request):
        assert request.question == "Which invoices are overdue?"
        return QaPlanResponse(
            retrievalMode="postgres",
            postgresQuery={"documentType": "INVOICE"},
            qdrantQuery="Which invoices are overdue?",
            reasoning="Invoice due dates are exact extracted fields.",
        )

    monkeypatch.setattr(qa_router, "run_qa_plan_graph", fake_plan)

    response = client.post(
        "/qa/plan",
        json={
            "workspaceId": "workspace_123",
            "conversationId": "conv_123",
            "question": "Which invoices are overdue?",
        },
    )

    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "planned"
    assert body["retrievalMode"] == "postgres"
    assert body["postgresQuery"] == {"documentType": "INVOICE"}


def test_qa_answer_returns_cited_answer(monkeypatch) -> None:
    def fake_answer(request):
        assert request.retrieval_mode == "hybrid"
        return QaAnswerResponse(
            answer="The renewal clause requires 30 days notice.",
            retrievalMode="hybrid",
            citations=[
                QaCitationPayload(
                    sourceType="qdrant",
                    documentId="doc_123",
                    qdrantPointId="point_123",
                    title="Agreement",
                    snippet="renewal requires 30 days notice",
                )
            ],
            confidence=0.86,
            limitations=[],
        )

    monkeypatch.setattr(qa_router, "run_qa_answer_graph", fake_answer)

    response = client.post(
        "/qa/answer",
        json={
            "workspaceId": "workspace_123",
            "conversationId": "conv_123",
            "question": "What does the renewal clause say?",
            "retrievalMode": "hybrid",
            "postgresEvidence": [],
            "qdrantContext": [],
        },
    )

    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "answered"
    assert body["retrievalMode"] == "hybrid"
    assert body["citations"][0]["qdrantPointId"] == "point_123"


def test_supervisor_routes_attachment_only_to_document_ingestion(monkeypatch) -> None:
    def fake_ingestion(request):
        assert request.document_id == "doc_123"
        assert request.file_storage_key == "documents/invoice.md"
        return document_process_response(request.document_id)

    monkeypatch.setattr(supervisor_graph, "run_ingestion_graph", fake_ingestion)

    response = client.post(
        "/agent/respond",
        json={
            "workspaceId": "workspace_123",
            "conversationId": "conv_123",
            "messageId": "msg_123",
            "userMessage": "Please process this invoice.",
            "attachments": [
                {
                    "documentId": "doc_123",
                    "fileStorageKey": "documents/invoice.md",
                    "checksum": "sha256:placeholder",
                    "originalFilename": "invoice.md",
                    "contentType": "text/markdown",
                }
            ],
            "postgresEvidence": [],
            "processingOptions": {"supervisorMode": "heuristic"},
        },
    )

    body = response.json()
    assert response.status_code == 200
    assert body["intent"] == "ingest_documents"
    assert body["extractions"][0]["documentId"] == "doc_123"
    assert [action["tool"] for action in body["toolActions"]] == [
        "supervisor_planner",
        "document_ingestion",
    ]


def test_supervisor_routes_text_question_to_qa(monkeypatch) -> None:
    def fake_plan(request):
        assert request.question == "What is the invoice total?"
        return QaPlanResponse(
            retrievalMode="hybrid",
            postgresQuery={"intent": "invoice_total"},
            qdrantQuery="What is the invoice total?",
            reasoning="Exact fields and document context can both help.",
        )

    def fake_answer(request):
        assert request.retrieval_mode == "hybrid"
        assert request.postgres_evidence == [{"recordId": "record_123"}]
        return QaAnswerResponse(
            answer="The invoice total is 1250 USD.",
            retrievalMode="hybrid",
            citations=[
                QaCitationPayload(
                    sourceType="postgres",
                    documentId="doc_123",
                    recordId="record_123",
                    title="Invoice INV-1001",
                    snippet="total_amount: 1250 USD",
                )
            ],
            confidence=0.91,
            limitations=[],
        )

    monkeypatch.setattr(supervisor_graph, "run_qa_plan_graph", fake_plan)
    monkeypatch.setattr(supervisor_graph, "run_qa_answer_graph", fake_answer)

    response = client.post(
        "/agent/respond",
        json={
            "workspaceId": "workspace_123",
            "conversationId": "conv_123",
            "messageId": "msg_123",
            "userMessage": "What is the invoice total?",
            "attachments": [],
            "postgresEvidence": [{"recordId": "record_123"}],
            "processingOptions": {"supervisorMode": "heuristic"},
        },
    )

    body = response.json()
    assert response.status_code == 200
    assert body["intent"] == "answer_question"
    assert body["qaAnswer"]["answer"] == "The invoice total is 1250 USD."
    assert body["reply"] == "The invoice total is 1250 USD."


def test_supervisor_routes_document_plus_question_to_ingest_and_answer(monkeypatch) -> None:
    monkeypatch.setattr(
        supervisor_graph,
        "run_ingestion_graph",
        lambda request: document_process_response(request.document_id),
    )
    monkeypatch.setattr(
        supervisor_graph,
        "run_qa_plan_graph",
        lambda request: QaPlanResponse(
            retrievalMode="hybrid",
            postgresQuery={"intent": "due_date"},
            qdrantQuery=request.question,
            reasoning="The fresh extraction and vector memory can answer this.",
        ),
    )
    monkeypatch.setattr(
        supervisor_graph,
        "run_qa_answer_graph",
        lambda request: QaAnswerResponse(
            answer="The invoice due date is May 30, 2026.",
            retrievalMode="hybrid",
            citations=[],
            confidence=0.9,
            limitations=[],
        ),
    )

    response = client.post(
        "/agent/respond",
        json={
            "workspaceId": "workspace_123",
            "conversationId": "conv_123",
            "messageId": "msg_123",
            "userMessage": "Please process this invoice and tell me the due date.",
            "attachments": [
                {
                    "documentId": "doc_123",
                    "fileStorageKey": "documents/invoice.md",
                    "checksum": "sha256:placeholder",
                    "originalFilename": "invoice.md",
                    "contentType": "text/markdown",
                }
            ],
            "postgresEvidence": [],
            "processingOptions": {"supervisorMode": "heuristic"},
        },
    )

    body = response.json()
    assert response.status_code == 200
    assert body["intent"] == "ingest_and_answer"
    assert body["extractions"]
    assert body["qaAnswer"]["answer"] == "The invoice due date is May 30, 2026."
    assert "Processed Invoice INV-1001 as INVOICE" in body["reply"]


def test_supervisor_returns_clarification_for_ambiguous_request() -> None:
    response = client.post(
        "/agent/respond",
        json={
            "workspaceId": "workspace_123",
            "conversationId": "conv_123",
            "messageId": "msg_123",
            "userMessage": "hi",
            "attachments": [],
            "postgresEvidence": [],
            "processingOptions": {"supervisorMode": "heuristic"},
        },
    )

    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "needs_clarification"
    assert body["intent"] == "clarify"
    assert body["automationDecision"] == "needs_clarification"


def test_supervisor_returns_safe_unsupported_response() -> None:
    response = client.post(
        "/agent/respond",
        json={
            "workspaceId": "workspace_123",
            "conversationId": "conv_123",
            "messageId": "msg_123",
            "userMessage": "Sync this spreadsheet to Google Drive",
            "attachments": [],
            "postgresEvidence": [],
            "processingOptions": {"supervisorMode": "heuristic"},
        },
    )

    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "unsupported"
    assert body["intent"] == "unsupported"
    assert body["automationDecision"] == "unsupported"
    assert "outside" in body["reply"]


def agent_run_start_payload(
    *,
    message: str = "Please process this invoice.",
    attachments: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "agentRunId": "run_123",
        "workspaceId": "workspace_123",
        "conversationId": "conv_123",
        "messageId": "msg_123",
        "userMessage": message,
        "userInstructions": "Keep payment terms visible.",
        "attachments": attachments or [],
        "postgresEvidence": [],
        "callbackBaseUrl": "http://web.local",
        "processingOptions": {"managerMode": "heuristic", "vectorMode": "disabled"},
    }


def invoice_attachment() -> dict[str, object]:
    return {
        "documentId": "doc_123",
        "fileStorageKey": "documents/invoice.md",
        "checksum": "sha256:placeholder",
        "originalFilename": "invoice.md",
        "contentType": "text/markdown",
    }


def test_agent_run_start_accepts_autonomous_background_run(monkeypatch) -> None:
    captured = []

    def fake_run(request):
        captured.append(request.agent_run_id)

    monkeypatch.setattr(agent_router, "run_autonomous_agent_team", fake_run)

    response = client.post(
        "/agent/runs/start",
        json=agent_run_start_payload(attachments=[invoice_attachment()]),
    )

    body = response.json()
    assert response.status_code == 202
    assert body == {
        "status": "accepted",
        "agentRunId": "run_123",
        "message": "Autonomous agent run started.",
    }
    assert captured == ["run_123"]


def test_autonomous_team_delegates_attachment_only_request(monkeypatch) -> None:
    events = []
    completions = []

    def fake_emit_step(**kwargs):
        events.append(kwargs)

    def fake_complete(**kwargs):
        completions.append(kwargs["payload"])

    def fake_ingestion(request):
        assert request.document_id == "doc_123"
        return document_process_response(request.document_id)

    monkeypatch.setattr(autonomous_team_graph, "emit_agent_step", fake_emit_step)
    monkeypatch.setattr(autonomous_team_graph, "complete_agent_run_callback", fake_complete)
    monkeypatch.setattr(autonomous_team_graph, "run_ingestion_graph", fake_ingestion)

    request = autonomous_team_graph.AgentRunStartRequest.model_validate(
        agent_run_start_payload(attachments=[invoice_attachment()])
    )

    autonomous_team_graph.run_autonomous_agent_team(request)

    assert [event["agent_name"] for event in events] == [
        "Manager Agent",
        "Intake Agent",
        "Extraction Agent",
        "Validation Critic Agent",
        "Memory Agent",
        "Q&A Agent",
        "Response Agent",
    ]
    assert completions[0]["intent"] == "ingest_documents"
    assert completions[0]["automationDecision"] == "safe_to_save"
    assert completions[0]["extractions"][0]["documentId"] == "doc_123"
    assert "Processed as Invoice" in completions[0]["reply"]


def test_autonomous_team_answers_text_question_from_qa_agent(monkeypatch) -> None:
    events = []
    completions = []

    monkeypatch.setattr(
        autonomous_team_graph,
        "emit_agent_step",
        lambda **kwargs: events.append(kwargs),
    )
    monkeypatch.setattr(
        autonomous_team_graph,
        "complete_agent_run_callback",
        lambda **kwargs: completions.append(kwargs["payload"]),
    )
    monkeypatch.setattr(
        autonomous_team_graph,
        "run_qa_plan_graph",
        lambda request: QaPlanResponse(
            retrievalMode="hybrid",
            postgresQuery={"intent": "invoice_total"},
            qdrantQuery=request.question,
            reasoning="Use exact fields and vector memory.",
        ),
    )
    monkeypatch.setattr(
        autonomous_team_graph,
        "run_qa_answer_graph",
        lambda request: QaAnswerResponse(
            answer="The invoice total is 1250 USD.",
            retrievalMode="hybrid",
            citations=[
                QaCitationPayload(
                    sourceType="postgres",
                    documentId="doc_123",
                    recordId="record_123",
                    title="Invoice INV-1001",
                    snippet="total_amount: 1250 USD",
                )
            ],
            confidence=0.91,
            limitations=[],
        ),
    )

    request = autonomous_team_graph.AgentRunStartRequest.model_validate(
        agent_run_start_payload(message="What is the invoice total?")
    )

    autonomous_team_graph.run_autonomous_agent_team(request)

    assert any(event["agent_name"] == "Q&A Agent" for event in events)
    assert completions[0]["intent"] == "answer_question"
    assert completions[0]["qaAnswer"]["answer"] == "The invoice total is 1250 USD."
    assert completions[0]["reply"] == "The invoice total is 1250 USD."
