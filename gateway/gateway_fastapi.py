import os
import sys

import uvicorn

# Ensure the gateway package is importable when launched from repo root scripts.
sys.path.append(os.path.dirname(__file__))

from src.core.config import settings


if __name__ == "__main__":
    uvicorn.run(
        "src.app:app",
        host=settings.provider_api_host,
        port=settings.provider_api_port,
        reload=True,
    )