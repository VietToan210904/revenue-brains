from fastapi import APIRouter, status

from app.schemas import DocumentProcessRequest, PlaceholderResponse

router = APIRouter(tags=["documents"])


@router.post(
    "/documents/process",
    response_model=PlaceholderResponse,
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
def process_document(_request: DocumentProcessRequest) -> PlaceholderResponse:
    return PlaceholderResponse(
        endpoint="/documents/process",
        message=(
            "Document processing is intentionally not implemented in the Phase 2 scaffold."
        ),
    )
