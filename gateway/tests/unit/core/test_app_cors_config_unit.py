from src.core.cors import resolve_cors_origins


def test_resolve_cors_origins_defaults(monkeypatch) -> None:
    monkeypatch.delenv("CORS_ALLOW_ORIGINS", raising=False)

    origins = resolve_cors_origins()

    assert "http://localhost:3000" in origins
    assert "http://127.0.0.1:3000" in origins


def test_resolve_cors_origins_env_override(monkeypatch) -> None:
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "http://localhost:3000, https://console.synapse.network")

    origins = resolve_cors_origins()

    assert origins == ["http://localhost:3000", "https://console.synapse.network"]
