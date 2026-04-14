import logging
import os
import sys

import uvicorn

# Ensure the gateway package is importable when launched from repo root scripts.
sys.path.append(os.path.dirname(__file__))

from src.core.config import settings
from src.core.log_config import setup_logger

BOOT_LOGGER = logging.getLogger("synapse.gateway.bootstrap")


def _reload_enabled() -> bool:
    return str(os.getenv("GATEWAY_RELOAD", "false")).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _run_gateway() -> None:
    """Launch the FastAPI gateway with Synapse logging controls intact."""

    setup_logger()
    BOOT_LOGGER.info(
        "gateway.startup service=%s env=%s host=%s port=%s pid=%s",
        "synapse-gateway",
        settings.environment,
        settings.provider_api_host,
        settings.provider_api_port,
        os.getpid(),
        extra={
            "service": "synapse-gateway",
            "environment": settings.environment,
            "host": settings.provider_api_host,
            "port": settings.provider_api_port,
            "pid": os.getpid(),
        },
    )
    uvicorn.run(
        "src.app:app",
        host=settings.provider_api_host,
        port=settings.provider_api_port,
        reload=_reload_enabled(),
        log_config=None,
    )


if __name__ == "__main__":
    _run_gateway()
