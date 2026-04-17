"""Jitter helpers for spreading periodic background work."""
from __future__ import annotations

import hashlib


def compute_stable_offset_ms(key: str, interval_ms: int) -> int:
    """Return a deterministic offset inside an interval for the provided key."""
    safe_interval = max(1, int(interval_ms or 1))
    digest = hashlib.sha256(str(key or "").encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % safe_interval


def is_due_with_stable_jitter(
    *,
    now_ms: int,
    last_checked_at: int,
    interval_ms: int,
    key: str,
) -> bool:
    """Return whether a periodic job is due in its stable-jitter bucket."""
    safe_interval = max(1, int(interval_ms or 1))
    now = max(0, int(now_ms or 0))
    last_checked = max(0, int(last_checked_at or 0))
    offset = compute_stable_offset_ms(key, safe_interval)
    current_due_at = (now // safe_interval) * safe_interval + offset
    if current_due_at > now:
        current_due_at -= safe_interval
    return last_checked < current_due_at
