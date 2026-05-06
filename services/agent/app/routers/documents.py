from fastapi import APIRouter, status

from app.schemas import DocumentAcceptedResponse, DocumentProcessRequest

router = APIRouter(tags=["documents"])


@router.post(
    "/documents/process",
    response_model=DocumentAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def process_document(request: DocumentProcessRequest) -> DocumentAcceptedResponse:
    return DocumentAcceptedResponse(
        documentId=request.document_id,
        processingImplemented=False,
        message="Document processing was accepted for a future extraction phase.",
    )
