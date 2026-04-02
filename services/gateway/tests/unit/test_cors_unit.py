import os

from src.core.cors import resolve_cors_origin_regex, resolve_cors_origins


def test_resolve_cors_origins_defaults_to_local_frontend_hosts(monkeypatch):
    monkeypatch.delenv("CORS_ALLOW_ORIGINS", raising=False)
    assert resolve_cors_origins() == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


def test_resolve_cors_origin_regex_defaults_for_local_env(monkeypatch):
    monkeypatch.delenv("CORS_ALLOW_ORIGIN_REGEX", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "local")

    pattern = resolve_cors_origin_regex()

    assert pattern == r"^https?://([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*|localhost|127\.0\.0\.1|0\.0\.0\.0):(3000|3001)$"


def test_resolve_cors_origin_regex_respects_explicit_override(monkeypatch):
    monkeypatch.setenv("CORS_ALLOW_ORIGIN_REGEX", r"^https://demo\.example\.com$")
    monkeypatch.setenv("ENVIRONMENT", "prod")

    assert resolve_cors_origin_regex() == r"^https://demo\.example\.com$"
