"""Privacy utilities for analytics event processing."""

from __future__ import annotations

import hashlib


def sha256_hash(value: str) -> str:
    """
    SHA-256 hash a value for privacy-safe analytics identification.
    
    - Strips whitespace and lowercases the input for consistency
    - Returns 64-char hex digest
    """
    normalized = value.strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
