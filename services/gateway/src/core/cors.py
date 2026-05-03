from __future__ import annotations

import os


def resolve_cors_origins() -> list[str]:
    raw = str(os.getenv("CORS_ALLOW_ORIGINS", "")).strip()
    if raw:
        return [origin.strip() for origin in raw.split(",") if origin.strip()]
    return [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3100",
        "http://127.0.0.1:3100",
    ]


def resolve_cors_origin_regex() -> str | None:
    raw = str(os.getenv("CORS_ALLOW_ORIGIN_REGEX", "")).strip()
    if raw:
        return raw

    environment = str(os.getenv("ENVIRONMENT", "local")).strip().lower()
    if environment in {"local", "development", "dev"}:
        return r"^https?://([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*|localhost|127\.0\.0\.1|0\.0\.0\.0):(3000|3100)$"

    return None
