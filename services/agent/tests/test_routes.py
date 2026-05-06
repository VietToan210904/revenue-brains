from fastapi.testclient import TestClient

from app.main import create_app


client = TestClient(create_app())


def test_health_returns_process_status() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "agent"}


def test_documents_process_is_placeholder() -> None:
    response = client.post(
        "/documents/process",
        json={
            "conversationId": "conv_123",
            "messageId": "msg_123",
            "documentId": "doc_123",
            "workspaceId": "workspace_123",
            "fileStorageKey": "uploads/documents/doc_123.pdf",
            "checksum": "sha256:placeholder",
            "originalFilename": "invoice.pdf",
            "contentType": "application/pdf",
            "userInstructions": "Extract invoice fields.",
        },
    )

    body = response.json()
    assert response.status_code == 501
    assert body["status"] == "not_implemented"
    assert body["endpoint"] == "/documents/process"


def test_qa_plan_is_placeholder() -> None:
    response = client.post(
        "/qa/plan",
        json={
            "workspaceId": "workspace_123",
            "conversationId": "conv_123",
            "question": "Which invoices are overdue?",
        },
    )

    body = response.json()
    assert response.status_code == 501
    assert body["status"] == "not_implemented"
    assert body["endpoint"] == "/qa/plan"


def test_qa_answer_is_placeholder() -> None:
    response = client.post(
        "/qa/answer",
        json={
            "workspaceId": "workspace_123",
            "conversationId": "conv_123",
            "question": "What does the renewal clause say?",
            "postgresEvidence": [],
            "qdrantContext": [],
        },
    )

    body = response.json()
    assert response.status_code == 501
    assert body["status"] == "not_implemented"
    assert body["endpoint"] == "/qa/answer"
