from __future__ import annotations

from urllib.parse import urlparse

_LOOPBACK_TRIGGER_HOSTS = frozenset({"127.0.0.1", "localhost", "0.0.0.0", "::1"})


def is_loopback_trigger_url(url: str) -> bool:
    host = (urlparse(str(url or "").strip()).hostname or "").strip().lower()
    return host in _LOOPBACK_TRIGGER_HOSTS
