from __future__ import annotations


BOOTSTRAP_TOTP_MARKER = "__BOOTSTRAP_TOTP_SECRET__"
DEFAULT_LOCAL_TOTP_ENCRYPTION_KEY = "MDEyMzQ1Njc4OUFCQ0RFRjAxMjM0NTY3ODlBQkNERUY="  # noqa: S105 - local-only fallback seed for non-prod bootstraps.
DEFAULT_LOCAL_TOTP_ENCRYPTION_KEY_PLACEHOLDER = "replace-this-with-a-32-byte-base64-fernet-key"  # noqa: S105 - documented placeholder, rejected outside local.
INLINE_FERNET_SECRET_REF_PREFIX = "inline-fernet:v1:"  # noqa: S105 - storage prefix marker, not a credential.
MASKED_SECRET_SHORT_LEN = 8
MIN_INTERNAL_JWT_SECRET_BYTES = 32
