import os
import uvicorn
import sys

# Add seller_api to path if needed
sys.path.append(os.path.join(os.path.dirname(__file__), 'seller_api'))

from src.app import app

if __name__ == "__main__":
    uvicorn.run(
        "seller_fastapi:app",
        host=os.getenv("SELLER_API_HOST", "127.0.0.1"),
        port=8000,
        reload=True,
    )
