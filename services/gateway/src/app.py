import logging
import asyncio
from contextlib import asynccontextmanager, suppress
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from src.core.config import settings
from src.core.cors import resolve_cors_origin_regex, resolve_cors_origins
from src.core.log_config import setup_logger
from src.api.routers import (
    auth,
    services,
    balance,
    agent_credentials,
    provider_secrets,
    forwarding,
)
from src.storage import create_storage
from src.services.platform.tasks.deposit_indexer import run_v2_deposit_indexer
from src.services.platform.tasks.provider_withdraw_expiry_reaper import (
    run_provider_withdraw_expiry_reaper,
)
from src.services.platform.tasks.consumer_withdraw_processor import (
    run_consumer_withdraw_processor,
)
from src.services.platform.service_health_service import run_service_health_monitor
from src.services.analytics.emitter import create_analytics_emitter
from src.services.analytics import gateway_events as gw_analytics
from src.api.routers.events import router as events_router

setup_logger()
logger = logging.getLogger(__name__)


def _task_initialized(task: asyncio.Task | None) -> bool:
    return task is not None and not task.done()


def _build_monitor_state(*, enabled: bool, task: asyncio.Task | None) -> dict[str, bool]:
    return {"enabled": enabled, "initialized": _task_initialized(task)}


def _readiness_snapshot(app: FastAPI) -> dict[str, object]:
    state = getattr(app, "state", None)

    def _state_task(name: str) -> asyncio.Task | None:
        if state is None:
            return None
        return getattr(state, name, None)

    monitors = {
        "deposit_indexer": _build_monitor_state(
            enabled=True, task=_state_task("v2_indexer_task")
        ),
        "service_health_monitor": _build_monitor_state(
            enabled=settings.service_health_monitor_enabled,
            task=_state_task("service_health_task"),
        ),
        "provider_withdraw_expiry_reaper": _build_monitor_state(
            enabled=settings.provider_withdraw_expiry_reaper_enabled,
            task=_state_task("provider_withdraw_expiry_reaper_task"),
        ),
        "consumer_withdraw_processor": _build_monitor_state(
            enabled=settings.consumer_withdraw_processor_enabled,
            task=_state_task("consumer_withdraw_processor_task"),
        ),
    }

    ready = all(
        (not monitor["enabled"]) or monitor["initialized"]
        for monitor in monitors.values()
    )

    return {"status": "ready" if ready else "degraded", "monitors": monitors}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize storage on startup
    storage = create_storage(settings)
    app.state.storage = storage
    logger.info(
        "Application starting up... Storage Connected (%s).", settings.storage_backend
    )

    # Initialize analytics emitter
    app.state.analytics = create_analytics_emitter(
        kafka_bootstrap_servers=settings.analytics_kafka_bootstrap_servers or None,
        kafka_topic=settings.analytics_kafka_topic,
        fallback_file=settings.analytics_fallback_file,
        environment=settings.environment,
    )
    gw_analytics.set_emitter(app.state.analytics)

    # 启动 V2 链上索引守护任务（主索引器）
    # 该任务负责充值事件的异步确认与最终一致性入账。
    app.state.v2_indexer_stop_event = asyncio.Event()
    app.state.v2_indexer_task = asyncio.create_task(
        run_v2_deposit_indexer(app.state.v2_indexer_stop_event, app.state.storage)
    )

    # Service health monitor keeps provider targets fresh for discover and routing.
    app.state.service_health_stop_event = asyncio.Event()
    app.state.service_health_task = None
    if settings.service_health_monitor_enabled:
        app.state.service_health_task = asyncio.create_task(
            run_service_health_monitor(
                app.state.service_health_stop_event, app.state.storage
            )
        )

    app.state.provider_withdraw_expiry_reaper_stop_event = asyncio.Event()
    app.state.provider_withdraw_expiry_reaper_task = None
    if settings.provider_withdraw_expiry_reaper_enabled:
        app.state.provider_withdraw_expiry_reaper_task = asyncio.create_task(
            run_provider_withdraw_expiry_reaper(
                app.state.provider_withdraw_expiry_reaper_stop_event,
                app.state.storage,
            )
        )

    # Consumer withdrawal processor: recovery-only safety net.
    # It never sends on-chain transactions; it only reconciles REQUESTED rows by
    # observing WithdrawInfo events or cancels expired tickets.
    app.state.consumer_withdraw_processor_stop_event = asyncio.Event()
    app.state.consumer_withdraw_processor_task = None
    if settings.consumer_withdraw_processor_enabled:
        app.state.consumer_withdraw_processor_task = asyncio.create_task(
            run_consumer_withdraw_processor(
                app.state.consumer_withdraw_processor_stop_event,
                app.state.storage,
            )
        )

    yield
    # Cleanup on shutdown
    logger.info("Application shutting down...")
    if hasattr(app.state, "v2_indexer_stop_event"):
        app.state.v2_indexer_stop_event.set()
    if hasattr(app.state, "v2_indexer_task"):
        app.state.v2_indexer_task.cancel()
        with suppress(asyncio.CancelledError):
            await app.state.v2_indexer_task
        logger.info("V2 indexer task cancelled during shutdown")
    if hasattr(app.state, "service_health_stop_event"):
        app.state.service_health_stop_event.set()
    if (
        hasattr(app.state, "service_health_task")
        and app.state.service_health_task is not None
    ):
        app.state.service_health_task.cancel()
        with suppress(asyncio.CancelledError):
            await app.state.service_health_task
        logger.info("Service health task cancelled during shutdown")
    if hasattr(app.state, "provider_withdraw_expiry_reaper_stop_event"):
        app.state.provider_withdraw_expiry_reaper_stop_event.set()
    if (
        hasattr(app.state, "provider_withdraw_expiry_reaper_task")
        and app.state.provider_withdraw_expiry_reaper_task is not None
    ):
        app.state.provider_withdraw_expiry_reaper_task.cancel()
        with suppress(asyncio.CancelledError):
            await app.state.provider_withdraw_expiry_reaper_task
        logger.info("Provider withdrawal expiry reaper task cancelled during shutdown")
    if hasattr(app.state, "consumer_withdraw_processor_stop_event"):
        app.state.consumer_withdraw_processor_stop_event.set()
    if (
        hasattr(app.state, "consumer_withdraw_processor_task")
        and app.state.consumer_withdraw_processor_task is not None
    ):
        app.state.consumer_withdraw_processor_task.cancel()
        with suppress(asyncio.CancelledError):
            await app.state.consumer_withdraw_processor_task
        logger.info("Consumer withdrawal processor task cancelled during shutdown")

    # Cleanup analytics
    if hasattr(app.state, "analytics"):
        await app.state.analytics._backend.close()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Synapse M2M Speed Gateway",
        description="Core infra for AI Agents",
        version="2.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolve_cors_origins(),
        allow_origin_regex=resolve_cors_origin_regex(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 包含所有分离的路由
    app.include_router(auth.router, prefix="/api", tags=["auth"])
    app.include_router(services.router, prefix="/api", tags=["services"])
    app.include_router(balance.router, prefix="/api", tags=["balance"])
    app.include_router(
        agent_credentials.router, prefix="/api", tags=["agent-credentials"]
    )
    app.include_router(provider_secrets.router, prefix="/api", tags=["provider-secrets"])
    app.include_router(forwarding.router, prefix="/api", tags=["forwarding"])
    app.include_router(events_router, tags=["analytics"])

    @app.get("/health")
    async def health_check():
        return {"status": "ok", "version": "2.0.0"}

    @app.get("/readiness")
    async def readiness_check(request: Request):
        return _readiness_snapshot(request.app)

    return app


app = create_app()
