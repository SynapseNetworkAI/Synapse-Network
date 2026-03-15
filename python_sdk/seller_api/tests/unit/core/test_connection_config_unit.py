# pyright: reportMissingImports=false

import secrets
from urllib.parse import quote

from src.core.config import _resolve_postgres_dsn, _resolve_redis_url


def test_resolve_postgres_dsn_builds_from_components() -> None:
    pg_secret = f"pg_{secrets.token_hex(4)}"
    dsn = _resolve_postgres_dsn(
        "",
        user="synapse",
        password=pg_secret,
        host="postgres",
        port=5432,
        database="synapse_gateway",
    )
    assert dsn == f"postgresql://synapse:{quote(pg_secret, safe='')}@postgres:5432/synapse_gateway"


def test_resolve_postgres_dsn_overrides_password_from_env() -> None:
    pg_secret = f"pg_{secrets.token_hex(4)}"
    dsn = _resolve_postgres_dsn(
        "postgresql://synapse:old@postgres:5432/synapse_gateway",
        user="synapse",
        password=pg_secret,
        host="postgres",
        port=5432,
        database="synapse_gateway",
    )
    assert dsn == f"postgresql://synapse:{quote(pg_secret, safe='')}@postgres:5432/synapse_gateway"


def test_resolve_redis_url_accepts_plain_host_port_and_password() -> None:
    redis_secret = f"rd_{secrets.token_hex(4)}"
    url = _resolve_redis_url(
        "localhost:6379",
        username="",
        password=redis_secret,
        host="",
        port=6379,
        db=0,
    )
    assert url == f"redis://:{quote(redis_secret, safe='')}@localhost:6379/0"


def test_resolve_redis_url_builds_from_components() -> None:
    redis_secret = f"rd_{secrets.token_hex(4)}"
    url = _resolve_redis_url(
        "",
        username="",
        password=redis_secret,
        host="127.0.0.1",
        port=6380,
        db=2,
    )
    assert url == f"redis://:{quote(redis_secret, safe='')}@127.0.0.1:6380/2"


def test_resolve_redis_url_keeps_query_and_path() -> None:
    url = _resolve_redis_url(
        "redis://cache.local:6379/5?ssl_cert_reqs=none",
        username="",
        password="",
        host="",
        port=6379,
        db=0,
    )
    assert url == "redis://cache.local:6379/5?ssl_cert_reqs=none"
