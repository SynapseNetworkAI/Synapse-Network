import os

import uvicorn

from seller_api.app import app


if __name__ == "__main__":
    uvicorn.run(
        "seller_fastapi:app",
        host=os.getenv("SELLER_API_HOST", "127.0.0.1"),
        port=8000,
        reload=True,
    )
