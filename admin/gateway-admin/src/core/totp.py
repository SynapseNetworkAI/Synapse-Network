import base64
import hashlib
import hmac
import struct
import time


def _normalize_secret(secret: str) -> bytes:
    normalized = secret.strip().replace(" ", "").upper()
    padding = (-len(normalized)) % 8
    return base64.b32decode(normalized + ("=" * padding), casefold=True)


def generate_totp_code(
    secret: str,
    *,
    for_time: int | None = None,
    period_sec: int = 30,
    digits: int = 6,
) -> str:
    current_time = int(time.time()) if for_time is None else int(for_time)
    counter = current_time // period_sec
    counter_bytes = struct.pack(">Q", counter)
    digest = hmac.new(_normalize_secret(secret), counter_bytes, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    truncated = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    otp_value = truncated % (10**digits)
    return str(otp_value).zfill(digits)


def verify_totp_code(
    secret: str,
    code: str,
    *,
    at_time: int | None = None,
    period_sec: int = 30,
    digits: int = 6,
    window: int = 1,
) -> bool:
    normalized_code = code.strip()
    if len(normalized_code) != digits or not normalized_code.isdigit():
        return False
    current_time = int(time.time()) if at_time is None else int(at_time)
    for offset in range(-window, window + 1):
        candidate = generate_totp_code(
            secret,
            for_time=current_time + (offset * period_sec),
            period_sec=period_sec,
            digits=digits,
        )
        if hmac.compare_digest(candidate, normalized_code):
            return True
    return False