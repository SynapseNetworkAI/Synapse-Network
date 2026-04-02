import hashlib
import hmac

from src.core.config import get_settings


def build_admin_csrf_token(session_token: str) -> str:
    secret = get_settings().admin_csrf_secret.encode("utf-8")
    message = session_token.encode("utf-8")
    return hmac.new(secret, message, hashlib.sha256).hexdigest()