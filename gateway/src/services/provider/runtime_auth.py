from __future__ import annotations

from urllib.parse import urlparse


def auth_mode_for_endpoint_path(endpoint_path: str) -> str:
    normalized = str(endpoint_path or "").strip().lower()
    if normalized.startswith("/provider-services/"):
        return "gateway_signed"
    return "gateway_forward"


def auth_mode_for_endpoint_url(endpoint_url: str) -> str:
    path = urlparse(str(endpoint_url or "").strip()).path
    return auth_mode_for_endpoint_path(path)
