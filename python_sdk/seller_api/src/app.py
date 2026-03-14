import logging
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.core.config import settings
from src.core.log_config import setup_logger
from src.api.routers import auth, services, balance, wallet, buyer_credentials, seller_secrets, forwarding
from src.storage import create_storage
from src.services.v2_indexer import run_v2_deposit_indexer
from src.services.service_health_service import run_service_health_monitor

setup_logger()
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize storage on startup
    storage = create_storage(settings)
    app.state.storage = storage
    logger.info("Application starting up... Storage Connected (%s).", settings.storage_backend)

    # 启动 V2 链上索引守护任务（主索引器）
    # 该任务负责充值事件的异步确认与最终一致性入账。
    app.state.v2_indexer_stop_event = asyncio.Event()
    app.state.v2_indexer_task = asyncio.create_task(
        run_v2_deposit_indexer(app.state.v2_indexer_stop_event, app.state.storage)
    )

    # Service health monitor keeps seller target liveness fresh for discover and routing.
    app.state.service_health_stop_event = asyncio.Event()
    app.state.service_health_task = None
    if settings.service_health_monitor_enabled:
        app.state.service_health_task = asyncio.create_task(
            run_service_health_monitor(app.state.service_health_stop_event, app.state.storage)
        )

    yield
    # Cleanup on shutdown
    logger.info("Application shutting down...")
    if hasattr(app.state, "v2_indexer_stop_event"):
        app.state.v2_indexer_stop_event.set()
    if hasattr(app.state, "v2_indexer_task"):
        app.state.v2_indexer_task.cancel()
        try:
            await app.state.v2_indexer_task
        except asyncio.CancelledError:
            logger.info("V2 indexer task cancelled during shutdown")
    if hasattr(app.state, "service_health_stop_event"):
        app.state.service_health_stop_event.set()
    if hasattr(app.state, "service_health_task") and app.state.service_health_task is not None:
        app.state.service_health_task.cancel()
        try:
            await app.state.service_health_task
        except asyncio.CancelledError:
            logger.info("Service health task cancelled during shutdown")

def create_app() -> FastAPI:
    app = FastAPI(
        title="Synapse M2M Speed Gateway",
        description="Core infra for AI Agents",
        version="2.0.0",
        lifespan=lifespan
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 包含所有分离的路由
    app.include_router(auth.router, prefix="/api", tags=["auth"])
    app.include_router(wallet.router, prefix="/api", tags=["wallet"])
    app.include_router(services.router, prefix="/api", tags=["services"])
    app.include_router(balance.router, prefix="/api", tags=["balance"])
    app.include_router(buyer_credentials.router, prefix="/api", tags=["buyer-credentials"])
    app.include_router(seller_secrets.router, prefix="/api", tags=["seller-secrets"])
    app.include_router(forwarding.router, prefix="/api", tags=["forwarding"])
    
    @app.get("/health")
    async def health_check():
        return {"status": "ok", "version": "2.0.0"}
        
    return app

app = create_app()
