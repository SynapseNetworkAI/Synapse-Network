import os
import uvicorn
import sys

# Ensure seller_api directory is importable when launched from repo root scripts.
sys.path.append(os.path.dirname(__file__))

from src.app import app
from src.core.config import settings

if __name__ == "__main__":
    uvicorn.run(
        app,
        host=settings.seller_api_host,
        port=settings.seller_api_port,
        reload=True,
    )
