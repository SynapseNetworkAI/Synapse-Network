import logging
import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.core.config import settings
from src.core.log_config import setup_logger
from src.api.routers import auth, services, balance, agents, wallet
from src.storage import get_storage, JsonStorage
from src.services.balance_service import BalanceService
from src.daemon.deposit_watcher import deposit_watcher_loop

setup_logger()
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize storage on startup
    data_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    storage = JsonStorage(directory=data_dir)
    app.state.storage = storage
    logger.info("Application starting up... Storage Connected.")
    
    # 启动链上守护进程 Web3 Daemon
    balance_service = BalanceService(storage)
    daemon_task = asyncio.create_task(deposit_watcher_loop(balance_service))
    app.state.daemon_task = daemon_task

    yield
    # Cleanup on shutdown
    logger.info("Application shutting down...")
    if hasattr(app.state, "daemon_task"):
        app.state.daemon_task.cancel()
        try:
            await app.state.daemon_task
        except asyncio.CancelledError:
            pass

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
    app.include_router(agents.router, prefix="/api", tags=["agents"])
    
    @app.get("/health")
    async def health_check():
        return {"status": "ok", "version": "2.0.0"}
        
    return app

app = create_app()
