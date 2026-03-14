import uvicorn
import sys

# Add seller_api to path if needed
sys.path.append(os.path.join(os.path.dirname(__file__), 'seller_api'))

from src.app import app
from src.core.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "seller_fastapi:app",
        host=settings.seller_api_host,
        port=settings.seller_api_port,
        reload=True,
    )
