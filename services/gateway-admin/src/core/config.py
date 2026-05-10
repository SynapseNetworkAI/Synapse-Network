from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from src.core.totp_secret_constants import DEFAULT_LOCAL_TOTP_ENCRYPTION_KEY, DEFAULT_LOCAL_TOTP_ENCRYPTION_KEY_PLACEHOLDER, MIN_INTERNAL_JWT_SECRET_BYTES


SERVICE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LOG_DIR = SERVICE_ROOT / "logs"


DEVELOPMENT_CORS_ORIGINS = (
    "http://localhost:3000",
    "http://localhost:3100",
    "http://localhost:3200",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3100",
    "http://127.0.0.1:3200",
)
ADMIN_LOGIN_LOCK_THRESHOLD_MIN = 3
ADMIN_LOGIN_LOCK_THRESHOLD_MAX = 10
ADMIN_LOGIN_LOCK_HOURS_MIN = 1
ADMIN_LOGIN_LOCK_HOURS_MAX = 168
ADMIN_LOGIN_LOCK_THRESHOLD_TYPE_ERROR = "ADMIN_LOGIN_LOCK_THRESHOLD must be an integer between 3 and 10"
ADMIN_LOGIN_LOCK_THRESHOLD_RANGE_ERROR = "ADMIN_LOGIN_LOCK_THRESHOLD must be between 3 and 10"
ADMIN_LOGIN_LOCK_HOURS_TYPE_ERROR = "ADMIN_LOGIN_LOCK_HOURS must be an integer between 1 and 168"
ADMIN_LOGIN_LOCK_HOURS_RANGE_ERROR = "ADMIN_LOGIN_LOCK_HOURS must be between 1 and 168"
DEFAULT_ADMIN_CSRF_SECRET = "replace-this-with-a-dedicated-admin-csrf-secret"  # noqa: S105 - documented placeholder, rejected outside local.
DEFAULT_GATEWAY_INTERNAL_TOKEN_PLACEHOLDER = "replace-this-with-a-32-byte-minimum-jwt-secret"  # noqa: S105 - documented placeholder, rejected outside local.


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
    metrics_bearer_token: str = Field(default="", alias="METRICS_BEARER_TOKEN")
    metrics_basic_username: str = Field(default="", alias="METRICS_BASIC_USERNAME")
    metrics_basic_password: str = Field(default="", alias="METRICS_BASIC_PASSWORD")
    gcp_alert_receiver_enabled: bool = Field(
        default=False,
        alias="GCP_ALERT_RECEIVER_ENABLED",
    )
    gcp_alert_receiver_token: str = Field(
        default="",
        alias="GCP_ALERT_RECEIVER_TOKEN",
    )
    gcp_alert_receiver_username: str = Field(
        default="synapse-gcp-alert",
        alias="GCP_ALERT_RECEIVER_USERNAME",
    )
    gcp_alert_default_route: str = Field(
        default="staging-drill",
        alias="GCP_ALERT_DEFAULT_ROUTE",
    )
    lark_webhook_staging_drill: str = Field(
        default="",
        alias="LARK_WEBHOOK_STAGING_DRILL",
    )
    lark_secret_staging_drill: str = Field(
        default="",
        alias="LARK_SECRET_STAGING_DRILL",
    )
    lark_webhook_p0_war_room: str = Field(
        default="",
        alias="LARK_WEBHOOK_P0_WAR_ROOM",
    )
    lark_secret_p0_war_room: str = Field(
        default="",
        alias="LARK_SECRET_P0_WAR_ROOM",
    )
    lark_webhook_prod_alerts: str = Field(
        default="",
        alias="LARK_WEBHOOK_PROD_ALERTS",
    )
    lark_secret_prod_alerts: str = Field(
        default="",
        alias="LARK_SECRET_PROD_ALERTS",
    )
    host: str = Field(default="0.0.0.0", alias="ADMIN_GATEWAY_HOST")  # noqa: S104 - production ingress/LB owns public exposure.
    port: int = Field(default=8300, alias="ADMIN_GATEWAY_PORT")
    debug: bool = Field(default=True, alias="ADMIN_GATEWAY_DEBUG")
    allowed_origins: str = Field(
        default="http://localhost:3000,http://localhost:3200",
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
        default=DEFAULT_ADMIN_CSRF_SECRET,
        alias="ADMIN_CSRF_SECRET",
    )
    admin_totp_secret_encryption_key: str = Field(
        default=DEFAULT_LOCAL_TOTP_ENCRYPTION_KEY,
        alias="ADMIN_TOTP_SECRET_ENCRYPTION_KEY",
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
    admin_login_lock_threshold: int = Field(
        default=5,
        alias="ADMIN_LOGIN_LOCK_THRESHOLD",
    )
    admin_login_lock_hours: int = Field(
        default=24,
        alias="ADMIN_LOGIN_LOCK_HOURS",
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
    public_app_base_url: str = Field(
        default="http://127.0.0.1:3000",
        alias="PUBLIC_APP_BASE_URL",
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
    analytics_source: str = Field(
        default="postgres",
        alias="ADMIN_ANALYTICS_SOURCE",
    )
    analytics_postgres_timeout_sec: float = Field(
        default=5.0,
        alias="ADMIN_ANALYTICS_POSTGRES_TIMEOUT_SEC",
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
        default=DEFAULT_GATEWAY_INTERNAL_TOKEN_PLACEHOLDER,
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
    withdrawal_manual_review_expiry_sec: int = Field(
        default=86400,
        alias="WITHDRAWAL_MANUAL_REVIEW_EXPIRY_SEC",
    )
    chain_rpc_url: str = Field(default="http://127.0.0.1:8545", alias="RPC_URL")
    synapse_core_address: str = Field(default="", alias="SYNAPSE_CORE_ADDRESS")
    platform_treasury_safe_address: str = Field(
        default="",
        alias="PLATFORM_TREASURY_SAFE_ADDRESS",
    )
    platform_treasury_ledger_signer_address: str = Field(
        default="",
        alias="PLATFORM_TREASURY_LEDGER_SIGNER_ADDRESS",
    )
    platform_fee_token_decimals: int = Field(default=18, alias="PLATFORM_FEE_TOKEN_DECIMALS")
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

    @field_validator("admin_login_lock_threshold", mode="before")
    @classmethod
    def validate_admin_login_lock_threshold(cls, value: object) -> int:
        try:
            threshold = int(str(value).strip())
        except (TypeError, ValueError) as exc:
            raise ValueError(ADMIN_LOGIN_LOCK_THRESHOLD_TYPE_ERROR) from exc
        if threshold < ADMIN_LOGIN_LOCK_THRESHOLD_MIN or threshold > ADMIN_LOGIN_LOCK_THRESHOLD_MAX:
            raise ValueError(ADMIN_LOGIN_LOCK_THRESHOLD_RANGE_ERROR)
        return threshold

    @field_validator("admin_login_lock_hours", mode="before")
    @classmethod
    def validate_admin_login_lock_hours(cls, value: object) -> int:
        try:
            hours = int(str(value).strip())
        except (TypeError, ValueError) as exc:
            raise ValueError(ADMIN_LOGIN_LOCK_HOURS_TYPE_ERROR) from exc
        if hours < ADMIN_LOGIN_LOCK_HOURS_MIN or hours > ADMIN_LOGIN_LOCK_HOURS_MAX:
            raise ValueError(ADMIN_LOGIN_LOCK_HOURS_RANGE_ERROR)
        return hours

    @model_validator(mode="after")
    def validate_security_baseline(self) -> "Settings":
        if self.environment not in {"staging", "prod"}:
            return self

        violations: list[str] = []
        if self.debug:
            violations.append("ADMIN_GATEWAY_DEBUG must be false outside local")
        if not self.admin_session_cookie_secure:
            violations.append("ADMIN_SESSION_COOKIE_SECURE must be true outside local")
        if not self.admin_csrf_secret.strip() or self.admin_csrf_secret == DEFAULT_ADMIN_CSRF_SECRET:
            violations.append("ADMIN_CSRF_SECRET must be replaced outside local")
        if (
            not self.gateway_internal_jwt_secret.strip()
            or self.gateway_internal_jwt_secret == DEFAULT_GATEWAY_INTERNAL_TOKEN_PLACEHOLDER
            or len(self.gateway_internal_jwt_secret) < MIN_INTERNAL_JWT_SECRET_BYTES
        ):
            violations.append("GATEWAY_INTERNAL_JWT_SECRET must be replaced with a 32-byte minimum secret outside local")
        if (
            not self.admin_totp_secret_encryption_key.strip()
            or self.admin_totp_secret_encryption_key in {
                DEFAULT_LOCAL_TOTP_ENCRYPTION_KEY,
                DEFAULT_LOCAL_TOTP_ENCRYPTION_KEY_PLACEHOLDER,
            }
        ):
            violations.append("ADMIN_TOTP_SECRET_ENCRYPTION_KEY must be replaced outside local")
        if violations:
            raise ValueError("; ".join(violations))
        return self

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
