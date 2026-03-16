from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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
        default="http://localhost:3000",
        alias="ADMIN_GATEWAY_ALLOWED_ORIGINS",
    )
    token_prefix: str = Field(default="adm_demo_", alias="ADMIN_GATEWAY_TOKEN_PREFIX")
    admin_database_dsn: str = Field(
        default="postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin",
        alias="ADMIN_DATABASE_DSN",
    )
    use_inmemory_store: bool = Field(default=False, alias="ADMIN_GATEWAY_USE_INMEMORY_STORE")

    def cors_origins(self) -> list[str]:
        return [item.strip() for item in self.allowed_origins.split(",") if item.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
