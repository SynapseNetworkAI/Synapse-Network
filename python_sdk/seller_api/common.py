from fastapi.responses import JSONResponse

from .settings import EXPECTED_PRICE, SERVICE_PRICES


def get_expected_price(service_id: str) -> int:
    if service_id in SERVICE_PRICES:
        return SERVICE_PRICES[service_id]
    return EXPECTED_PRICE


def pending_response(tx_hash: str, retry_after_sec: int = 3) -> JSONResponse:
    return JSONResponse(
        status_code=202,
        content={
            "status": "pending",
            "code": "PAYMENT_PENDING",
            "txHash": tx_hash,
            "retryAfterSec": retry_after_sec,
            "message": "Payment receipt not finalized yet. Please retry later.",
        },
    )


def normalize_service_id(service_id: str) -> str:
    return "".join(ch for ch in service_id.upper() if ch.isalnum() or ch == "_")


def normalize_wallet(address: str) -> str:
    return address.lower().strip()
