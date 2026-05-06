from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.errors import DocumentProcessingError
from app.extraction import process_document_request
from app.schemas import (
    DocumentProcessErrorResponse,
    DocumentProcessRequest,
    DocumentProcessResponse,
)

router = APIRouter(tags=["documents"])


@router.post(
    "/documents/process",
    response_model=DocumentProcessResponse,
    responses={
        400: {"model": DocumentProcessErrorResponse},
        404: {"model": DocumentProcessErrorResponse},
        415: {"model": DocumentProcessErrorResponse},
        422: {"model": DocumentProcessErrorResponse},
        502: {"model": DocumentProcessErrorResponse},
        503: {"model": DocumentProcessErrorResponse},
    },
)
def process_document(request: DocumentProcessRequest) -> DocumentProcessResponse | JSONResponse:
    try:
        return process_document_request(request)
    except DocumentProcessingError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=DocumentProcessErrorResponse(
                code=error.code,
                message=error.message,
                documentId=request.document_id,
                details=error.details,
            ).model_dump(by_alias=True),
        )
