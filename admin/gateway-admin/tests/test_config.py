from src.core.config import Settings


def test_cors_origins_include_common_local_ports_in_development() -> None:
    settings = Settings(
        ADMIN_GATEWAY_ALLOWED_ORIGINS="http://localhost:3000",
        environment="development",
    )

    assert "http://localhost:3000" in settings.cors_origins()
    assert "http://localhost:4000" in settings.cors_origins()
    assert "http://127.0.0.1:4000" in settings.cors_origins()


def test_cors_origins_do_not_expand_in_production() -> None:
    settings = Settings(
        ADMIN_GATEWAY_ALLOWED_ORIGINS="https://admin.synapse.network",
        environment="production",
    )

    assert settings.cors_origins() == ["https://admin.synapse.network"]
