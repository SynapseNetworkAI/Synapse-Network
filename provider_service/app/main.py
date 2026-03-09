from fastapi import FastAPI

from app.api.v1.router import api_v1_router

app = FastAPI(
    title="Provider Service",
    version="0.1.0",
    description="Standalone provider API service for AgentPay integration testing",
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api_v1_router)
