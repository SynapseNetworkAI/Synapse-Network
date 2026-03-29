from contextlib import asynccontextmanager
import time
from uuid import uuid4
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.v1.router import api_v1_router
from app.services.sentiment.scheduler import scheduler_from_settings
from app.core.log_config import logger


@asynccontextmanager
async def lifespan(_: FastAPI):
    scheduler = scheduler_from_settings()
    if scheduler is not None:
        await scheduler.start()
    try:
        yield
    finally:
        if scheduler is not None:
            await scheduler.stop()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Provider Service",
        version="0.1.0",
        description="Standalone provider API service for AgentPay integration testing",
        lifespan=lifespan,
    )

    app.add_middleware(RequestLoggingMiddleware)

    @app.get("/health")
    async def health(request: Request) -> dict[str, str]:
        req_logger = logger.bind(request_id=request.state.request_id)
        req_logger.debug("Health check requested")
        return {"status": "ok"}

    app.include_router(api_v1_router)
    return app

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-Id") or str(uuid4())
        request.state.request_id = request_id
        
        req_logger = logger.bind(request_id=request_id)
        start_time = time.time()
        
        req_logger.info(f"==> Provider Server Incoming: {request.method} {request.url.path}")
        
        try:
            response = await call_next(request)
            
            process_time_ms = round((time.time() - start_time) * 1000, 2)
            req_logger.info(f"<== Provider Server Completed: {response.status_code} in {process_time_ms}ms")
            
            response.headers["X-Request-Id"] = request_id
            return response
        except Exception as e:
            process_time_ms = round((time.time() - start_time) * 1000, 2)
            req_logger.error(f"<== Provider Server Error: {str(e)} in {process_time_ms}ms")
            raise


app = create_app()
