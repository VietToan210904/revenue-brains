from fastapi import APIRouter, BackgroundTasks
from fastapi.responses import JSONResponse

from app.agents.autonomous_team_graph import run_autonomous_agent_team
from app.agents.supervisor_graph import run_supervisor_graph
from app.errors import DocumentProcessingError
from app.schemas import (
    AgentRespondRequest,
    AgentRespondResponse,
    AgentRunStartRequest,
    AgentRunStartResponse,
    DocumentProcessErrorResponse,
)

router = APIRouter(prefix="/agent", tags=["agent"])


@router.post(
    "/respond",
    response_model=AgentRespondResponse,
    responses={
        400: {"model": DocumentProcessErrorResponse},
        404: {"model": DocumentProcessErrorResponse},
        415: {"model": DocumentProcessErrorResponse},
        422: {"model": DocumentProcessErrorResponse},
        502: {"model": DocumentProcessErrorResponse},
        503: {"model": DocumentProcessErrorResponse},
    },
)
def respond(request: AgentRespondRequest) -> AgentRespondResponse | JSONResponse:
    try:
        return run_supervisor_graph(request)
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
    "/runs/start",
    response_model=AgentRunStartResponse,
    status_code=202,
    responses={
        400: {"model": DocumentProcessErrorResponse},
        422: {"model": DocumentProcessErrorResponse},
        503: {"model": DocumentProcessErrorResponse},
    },
)
def start_agent_run(
    request: AgentRunStartRequest,
    background_tasks: BackgroundTasks,
) -> AgentRunStartResponse:
    background_tasks.add_task(run_autonomous_agent_team_safely, request)
    return AgentRunStartResponse(
        agentRunId=request.agent_run_id,
        message="Autonomous agent run started.",
    )


def run_autonomous_agent_team_safely(request: AgentRunStartRequest) -> None:
    try:
        run_autonomous_agent_team(request)
    except DocumentProcessingError as error:
        from app.tools.callback_tools import fail_agent_run_callback

        try:
            fail_agent_run_callback(
                callback_base_url=request.callback_base_url,
                agent_run_id=request.agent_run_id,
                error_message=error.message,
                agent_name="Autonomous Agent Team",
                metadata={"code": error.code, **error.details},
            )
        except DocumentProcessingError:
            return
    except Exception as error:  # noqa: BLE001
        from app.tools.callback_tools import fail_agent_run_callback

        try:
            fail_agent_run_callback(
                callback_base_url=request.callback_base_url,
                agent_run_id=request.agent_run_id,
                error_message="Autonomous agent run failed unexpectedly.",
                agent_name="Autonomous Agent Team",
                metadata={"errorType": type(error).__name__},
            )
        except DocumentProcessingError:
            return
