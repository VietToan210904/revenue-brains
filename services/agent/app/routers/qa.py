from fastapi import APIRouter, status

from app.schemas import PlaceholderResponse, QaAnswerRequest, QaPlanRequest

router = APIRouter(prefix="/qa", tags=["qa"])


@router.post(
    "/plan",
    response_model=PlaceholderResponse,
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
def plan_answer(_request: QaPlanRequest) -> PlaceholderResponse:
    return PlaceholderResponse(
        endpoint="/qa/plan",
        message="Q&A retrieval planning is intentionally not implemented yet.",
    )


@router.post(
    "/answer",
    response_model=PlaceholderResponse,
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
def answer_question(_request: QaAnswerRequest) -> PlaceholderResponse:
    return PlaceholderResponse(
        endpoint="/qa/answer",
        message="Q&A answer generation is intentionally not implemented yet.",
    )
