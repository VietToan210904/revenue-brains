from fastapi import FastAPI

from app.local_env import load_local_env


def create_app() -> FastAPI:
    load_local_env()

    from app.routers import documents, health, qa

    app = FastAPI(
        title="Revenue Brains Agent Service",
        summary="Python intelligence service for Revenue Brains.",
        version="0.1.0",
    )

    app.include_router(health.router)
    app.include_router(documents.router)
    app.include_router(qa.router)

    return app


app = create_app()
