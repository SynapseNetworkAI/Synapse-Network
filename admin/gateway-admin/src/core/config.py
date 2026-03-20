from functools import lru_cache
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


DEVELOPMENT_CORS_ORIGINS = (
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:4000",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:4000",
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Synapse Gateway Admin"
    environment: str = "development"
    host: str = Field(default="0.0.0.0", alias="ADMIN_GATEWAY_HOST")
    port: int = Field(default=8300, alias="ADMIN_GATEWAY_PORT")
    debug: bool = Field(default=True, alias="ADMIN_GATEWAY_DEBUG")
    allowed_origins: str = Field(
        default="http://localhost:3000,http://localhost:4000",
        alias="ADMIN_GATEWAY_ALLOWED_ORIGINS",
    )
    token_prefix: str = Field(default="adm_demo_", alias="ADMIN_GATEWAY_TOKEN_PREFIX")
    admin_session_ttl_sec: int = Field(default=3600, alias="ADMIN_SESSION_TTL_SEC")
    admin_session_cookie_name: str = Field(
        default="synapse_admin_session",
        alias="ADMIN_SESSION_COOKIE_NAME",
    )
    admin_session_cookie_secure: bool = Field(
        default=False,
        alias="ADMIN_SESSION_COOKIE_SECURE",
    )
    admin_session_cookie_samesite: str = Field(
        default="lax",
        alias="ADMIN_SESSION_COOKIE_SAMESITE",
    )
    admin_session_cookie_domain: Optional[str] = Field(
        default=None,
        alias="ADMIN_SESSION_COOKIE_DOMAIN",
    )
    admin_csrf_secret: str = Field(
        default="replace-this-with-a-dedicated-admin-csrf-secret",
        alias="ADMIN_CSRF_SECRET",
    )
    admin_database_dsn: str = Field(
        default="postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin",
        alias="ADMIN_DATABASE_DSN",
    )
    gateway_readonly_dsn: str = Field(
        default="postgresql://synapse_gateway_ro:12345678@localhost:5432/synapse_gateway",
        alias="GATEWAY_READONLY_DSN",
    )
    gateway_internal_base_url: str = Field(
        default="http://localhost:8000",
        alias="GATEWAY_INTERNAL_BASE_URL",
    )
    gateway_internal_admin_wallet: str = Field(
        default="",
        alias="GATEWAY_INTERNAL_ADMIN_WALLET",
    )
    gateway_internal_jwt_secret: str = Field(
        default="replace-this-with-a-32-byte-minimum-jwt-secret",
        alias="GATEWAY_INTERNAL_JWT_SECRET",
    )
    gateway_internal_token_issuer: str = Field(
        default="gateway-admin",
        alias="GATEWAY_INTERNAL_TOKEN_ISSUER",
    )
    gateway_internal_token_audience: str = Field(
        default="gateway-internal",
        alias="GATEWAY_INTERNAL_TOKEN_AUDIENCE",
    )
    gateway_internal_service_subject: str = Field(
        default="service:gateway-admin",
        alias="GATEWAY_INTERNAL_SERVICE_SUBJECT",
    )
    gateway_internal_timeout_sec: float = Field(
        default=10.0,
        alias="GATEWAY_INTERNAL_TIMEOUT_SEC",
    )
    execution_worker_enabled: bool = Field(
        default=True,
        alias="EXECUTION_WORKER_ENABLED",
    )
    execution_worker_poll_interval_sec: float = Field(
        default=5.0,
        alias="EXECUTION_WORKER_POLL_INTERVAL_SEC",
    )
    execution_worker_batch_size: int = Field(
        default=10,
        alias="EXECUTION_WORKER_BATCH_SIZE",
    )
    use_inmemory_store: bool = Field(default=False, alias="ADMIN_GATEWAY_USE_INMEMORY_STORE")

    def cors_origins(self) -> list[str]:
        origins = [item.strip() for item in self.allowed_origins.split(",") if item.strip()]
        if self.environment.lower() == "development":
            for origin in DEVELOPMENT_CORS_ORIGINS:
                if origin not in origins:
                    origins.append(origin)
        return origins


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
