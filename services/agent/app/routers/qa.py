from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.agents.qa_graph import run_qa_answer_graph, run_qa_plan_graph
from app.errors import DocumentProcessingError
from app.schemas import (
    DocumentProcessErrorResponse,
    QaAnswerRequest,
    QaAnswerResponse,
    QaPlanRequest,
    QaPlanResponse,
)

router = APIRouter(prefix="/qa", tags=["qa"])


@router.post(
    "/plan",
    response_model=QaPlanResponse,
)
def plan_answer(request: QaPlanRequest) -> QaPlanResponse | JSONResponse:
    try:
        return run_qa_plan_graph(request)
    except DocumentProcessingError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=DocumentProcessErrorResponse(
                code=error.code,
                message=error.message,
                details=error.details,
            ).model_dump(by_alias=True),
        )


@router.post(
    "/answer",
    response_model=QaAnswerResponse,
)
def answer_question(request: QaAnswerRequest) -> QaAnswerResponse | JSONResponse:
    try:
        return run_qa_answer_graph(request)
    except DocumentProcessingError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=DocumentProcessErrorResponse(
                code=error.code,
                message=error.message,
                details=error.details,
            ).model_dump(by_alias=True),
        )
