from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


SERVICE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LOG_DIR = SERVICE_ROOT / "logs"


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
    environment: str = "local"
    log_directory: str = Field(
        default=str(DEFAULT_LOG_DIR),
        alias="ADMIN_LOG_DIR",
    )
    log_file_name: str = Field(
        default="gateway-admin.log",
        alias="ADMIN_LOG_FILE_NAME",
    )
    log_rotation: str = Field(
        default="00:00",
        alias="ADMIN_LOG_ROTATION",
    )
    log_retention_days: int = Field(
        default=7,
        alias="ADMIN_LOG_RETENTION_DAYS",
    )
    log_level: str = Field(default="INFO", alias="ADMIN_LOG_LEVEL")
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
    admin_google_authenticator_login_enabled: bool = Field(
        default=True,
        alias="ADMIN_GOOGLE_AUTHENTICATOR_LOGIN_ENABLED",
    )
    admin_google_authenticator_high_risk_enabled: bool = Field(
        default=True,
        alias="ADMIN_GOOGLE_AUTHENTICATOR_HIGH_RISK_ENABLED",
    )
    admin_google_authenticator_issuer: str = Field(
        default="Synapse Gateway Admin",
        alias="ADMIN_GOOGLE_AUTHENTICATOR_ISSUER",
    )
    admin_google_authenticator_window: int = Field(
        default=1,
        alias="ADMIN_GOOGLE_AUTHENTICATOR_WINDOW",
    )
    admin_database_dsn: str = Field(
        default="postgresql://synapse_admin_app:local-dev-admin-app-password@localhost:5432/synapse_gateway_admin",
        alias="ADMIN_DATABASE_DSN",
    )
    gateway_readonly_dsn: str = Field(
        default="postgresql://synapse_gateway_ro:local-dev-gateway-readonly-password@localhost:5432/synapse_gateway",
        alias="GATEWAY_READONLY_DSN",
    )
    gateway_forum_write_dsn: str = Field(
        default="postgresql://synapse_gateway_app:local-dev-gateway-app-password@localhost:5432/synapse_gateway",
        alias="GATEWAY_FORUM_WRITE_DSN",
    )
    forum_suggestion_service_token: str = Field(
        default="",
        alias="GATEWAY_ADMIN_FORUM_SUGGESTION_TOKEN",
    )
    analytics_clickhouse_url: str = Field(
        default="http://localhost:8123",
        alias="ANALYTICS_CLICKHOUSE_URL",
    )
    analytics_clickhouse_timeout_sec: float = Field(
        default=5.0,
        alias="ANALYTICS_CLICKHOUSE_TIMEOUT_SEC",
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
    @field_validator("environment", mode="before")
    @classmethod
    def normalize_environment(cls, value: object) -> str:
        normalized = str(value or "local").strip().lower()
        aliases = {
            "development": "local",
            "dev": "local",
            "local": "local",
            "staging": "staging",
            "stage": "staging",
            "production": "prod",
            "prod": "prod",
        }
        return aliases.get(normalized, normalized or "local")

    def cors_origins(self) -> list[str]:
        origins = [item.strip() for item in self.allowed_origins.split(",") if item.strip()]
        if self.environment.lower() == "local":
            for origin in DEVELOPMENT_CORS_ORIGINS:
                if origin not in origins:
                    origins.append(origin)
        return origins

    def log_file_path(self) -> str:
        return str(Path(self.log_directory).expanduser().resolve() / self.log_file_name)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
