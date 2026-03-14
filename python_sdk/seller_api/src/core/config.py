import json
import os

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover - optional dependency
    load_dotenv = None


ENV_FILE_LOCAL = ".env.local"
ENV_FILE_PROD = ".env.prod"
ENV_FILE_PRODUCTION = ".env.production"
ENV_FILE_DEV = ".env.dev"
ENV_FILE_DEVELOPMENT = ".env.development"
ENV_FILE_STAGE = ".env.stage"
ENV_FILE_STAGING = ".env.staging"
ENV_FILE_TEST = ".env.test"


def _load_router_address_from_contract_config() -> str:
    """Fallback: read deployed router/core address from frontend contract config."""
    try:
        config_path = os.path.abspath(
            os.path.join(
                os.path.dirname(__file__),
                "..",
                "..",
                "..",
                "..",
                "frontend",
                "src",
                "contract-config.json",
            )
        )
        if not os.path.exists(config_path):
            return ""
        with open(config_path, "r", encoding="utf-8") as file:
            payload = json.load(file)
        value = payload.get("SynapseCore") or payload.get("A2APaySyncRouter") or ""
        return str(value).strip()
    except Exception:
        return ""


def _default_runtime_storage_dir() -> str:
    # Shared runtime storage root for all JSON persistence artifacts.
    return os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "runtime_storage")
    )


def _sdk_root_dir() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def _runtime_path(filename: str) -> str:
    return os.path.join(_default_runtime_storage_dir(), filename)


def _resolve_env_file_path(env_file: str) -> str:
    if os.path.isabs(env_file):
        return env_file
    return os.path.join(_sdk_root_dir(), env_file)


def _load_environment_files() -> None:
    if load_dotenv is None:
        return

    # Explicit env file has the highest priority for file-based configuration.
    explicit_env_file = os.getenv("ENV_FILE", "").strip()
    if explicit_env_file:
        explicit_path = _resolve_env_file_path(explicit_env_file)
        if os.path.exists(explicit_path):
            load_dotenv(explicit_path, override=False)
        return

    sdk_root = _sdk_root_dir()
    base_env_path = os.path.join(sdk_root, ".env")
    load_dotenv(base_env_path, override=False)

    runtime_env = str(os.getenv("ENVIRONMENT", "local") or "local").strip().lower()
    env_aliases = {
        "local": [ENV_FILE_LOCAL],
        "development": [ENV_FILE_DEVELOPMENT, ENV_FILE_LOCAL],
        "dev": [ENV_FILE_DEV, ENV_FILE_LOCAL],
        "prod": [ENV_FILE_PROD, ENV_FILE_PRODUCTION],
        "production": [ENV_FILE_PRODUCTION, ENV_FILE_PROD],
        "stage": [ENV_FILE_STAGE, ENV_FILE_STAGING],
        "staging": [ENV_FILE_STAGING, ENV_FILE_STAGE],
        "test": [ENV_FILE_TEST],
    }
    candidates = env_aliases.get(runtime_env, [f".env.{runtime_env}"])

    for env_file in candidates:
        env_path = os.path.join(sdk_root, env_file)
        if os.path.exists(env_path):
            # Override values from base .env so per-environment file wins.
            load_dotenv(env_path, override=True)
            break


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(str(raw).strip())
    except Exception:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(str(raw).strip())
    except Exception:
        return default


def _env_rate(name: str, default: float) -> float:
    value = _env_float(name, default)
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return float(value)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


# Load environment files once so all runtime entry points share the same config contract.
_load_environment_files()


class Settings:
    # Runtime mode flag used by the gateway for environment-specific behavior.
    environment: str = os.getenv("ENVIRONMENT", "local")
    # RPC endpoint used by chain-facing flows (deposit indexer, receipt checks).
    rpc_url: str = os.getenv("RPC_URL", "http://127.0.0.1:8545")
    # Listener contract for deposit events; falls back to frontend contract config.
    router_address: str = os.getenv("ROUTER_ADDRESS", "").strip() or _load_router_address_from_contract_config() or "0x0000000000000000000000000000000000000000"
    # Minimum block confirmations before crediting a deposit intent.
    v2_deposit_confirmations: int = _env_int("V2_DEPOSIT_CONFIRMATIONS", 1)
    # Poll interval for the background deposit indexer loop.
    v2_indexer_poll_interval_sec: float = _env_float("V2_INDEXER_POLL_INTERVAL_SEC", 2.0)
    # Reserved block batch size for indexer scaling upgrades.
    v2_indexer_block_batch: int = _env_int("V2_INDEXER_BLOCK_BATCH", 100)
    # Optional signer key for legacy or maintenance chain operations.
    private_key: str = os.getenv("PRIVATE_KEY", "")
    # Optional contract address used by compatibility paths.
    contract_address: str = os.getenv("CONTRACT_ADDRESS", "")

    # Unified runtime directory for JSON persistence (ledgers, intents, logs, configs).
    runtime_storage_dir: str = os.getenv("RUNTIME_STORAGE_DIR", _default_runtime_storage_dir())
    # Storage backend switch: "json" for local files, "postgres" for managed PostgreSQL.
    storage_backend: str = os.getenv("STORAGE_BACKEND", "json").strip().lower() or "json"
    # PostgreSQL DSN used when STORAGE_BACKEND=postgres.
    postgres_dsn: str = os.getenv("POSTGRES_DSN", "").strip()
    # Auto-create PostgreSQL tables/indexes on startup when using postgres backend.
    postgres_auto_init: bool = _env_bool("POSTGRES_AUTO_INIT", True)
    # Storage directory used by JsonStorage; defaults to unified runtime directory.
    data_dir: str = os.getenv("DATA_DIR", os.getenv("RUNTIME_STORAGE_DIR", _default_runtime_storage_dir()))
    # JWT secret for auth token signing and verification.
    jwt_secret: str = os.getenv("JWT_SECRET", "replace-this-with-a-32-byte-minimum-jwt-secret")
    # Optional Redis URL for distributed counters and rate limits.
    redis_url: str = os.getenv("REDIS_URL", "").strip()

    # Global platform fee rate for gateway billing split, range [0.0, 1.0].
    # Example: 0.10 means 10% platform fee and 90% seller net.
    platform_fee_rate: float = _env_rate("PLATFORM_FEE_RATE", 0.10)
    # Fixed per-request routing fee charged to buyer, in USDC.
    # Example: 0.0001 adds $0.0001 to every gateway generate call.
    gateway_routing_tax: float = max(0.0, _env_float("GATEWAY_ROUTING_TAX", 0.0001))
    # Optional admin wallet allow-list for fee-policy management endpoints.
    # Comma-separated lowercase/uppercase wallet addresses are accepted.
    platform_fee_admin_wallets: set[str] = {
        addr.strip().lower()
        for addr in os.getenv("PLATFORM_FEE_ADMIN_WALLETS", "").split(",")
        if addr.strip()
    }

    # DeepSeek API key used by service manifest parse-curl endpoint.
    deepseek_api_key: str = os.getenv("DEEPSEEK_API_KEY", "").strip()
    # DeepSeek API base URL for chat completion calls.
    deepseek_base_url: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip()
    # Default model used to parse cURL into service manifest fields.
    deepseek_model: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat").strip() or "deepseek-chat"
    # Timeout (seconds) for DeepSeek parse-curl requests.
    deepseek_timeout_s: float = _env_float("DEEPSEEK_TIMEOUT_S", 30.0)

    # Legacy payment fallback seller wallet (for compatibility-only flows).
    seller_address: str = os.getenv("SELLER_ADDRESS", "0x0000000000000000000000000000000000000000")
    # Legacy payment fallback expected price in wei.
    expected_price: int = _env_int("EXPECTED_PRICE", 1000000000000000000)
    # Minimum confirmations for legacy payment-verification endpoints.
    min_confirmations: int = _env_int("MIN_CONFIRMATIONS", 1)
    # Max wait time (seconds) for pending payment confirmation.
    payment_ttl_sec: int = _env_int("PAYMENT_TTL_SEC", 600)
    # Optional comma-separated allow-list for token contract addresses.
    allowed_token_addresses: set[str] = {
        addr.strip().lower()
        for addr in os.getenv("ALLOWED_TOKEN_ADDRESSES", "").split(",")
        if addr.strip()
    }
    # Per-service static pricing override JSON (serviceId -> wei string/int).
    service_prices_json: str = os.getenv("SERVICE_PRICES_JSON", "{}")
    # Error message used when payment confirmation exceeds ttl.
    payment_timeout_message: str = "Payment confirmation timed out"
    # Error message used for invalid wallet/address input.
    invalid_address_message: str = "address is invalid"

    # Wallet challenge JWT secret alias (defaults to jwt_secret for single-source config).
    auth_secret: str = os.getenv(
        "AUTH_SECRET",
        os.getenv("JWT_SECRET", "replace-this-with-a-32-byte-minimum-jwt-secret"),
    )
    # Issued auth token ttl in seconds.
    auth_token_ttl_sec: int = _env_int("AUTH_TOKEN_TTL_SEC", 86400)
    # Wallet-signature challenge ttl in seconds.
    auth_challenge_ttl_sec: int = _env_int("AUTH_CHALLENGE_TTL_SEC", 600)
    # Financial idempotency record ttl in seconds.
    finance_idempotency_ttl_sec: int = _env_int("FINANCE_IDEMPOTENCY_TTL_SEC", 86400)
    # Max number of cached idempotency rows retained after pruning.
    finance_idempotency_max_rows: int = _env_int("FINANCE_IDEMPOTENCY_MAX_ROWS", 10000)
    # Replay-protection window for duplicate tx/retry collisions in seconds.
    finance_replay_window_sec: int = _env_int("FINANCE_REPLAY_WINDOW_SEC", 900)
    # Owner-scoped write rate-limit for finance mutation endpoints (per minute).
    finance_write_rate_limit_per_min: int = _env_int("FINANCE_WRITE_RATE_LIMIT_PER_MIN", 60)
    # Keep backward-compatible auth behavior enabled by default.
    allow_legacy_auth: bool = _env_bool("ALLOW_LEGACY_AUTH", True)

    # Default credential ttl (seconds) when caller omits expiration.
    agent_credential_default_ttl_sec: int = _env_int("AGENT_CREDENTIAL_DEFAULT_TTL_SEC", 3600)
    # Maximum allowed credential ttl (seconds).
    agent_credential_max_ttl_sec: int = _env_int("AGENT_CREDENTIAL_MAX_TTL_SEC", 259200)
    # Default max calls for newly created credentials.
    agent_credential_max_calls_default: int = _env_int("AGENT_CREDENTIAL_MAX_CALLS_DEFAULT", 1000)
    # Owner control-plane rate limit per minute.
    owner_rate_limit_per_min: int = _env_int("OWNER_RATE_LIMIT_PER_MIN", 240)
    # Credential data-plane rate limit per minute.
    agent_rate_limit_per_min: int = _env_int("AGENT_RATE_LIMIT_PER_MIN", 600)
    # Service aggregate rate limit per minute.
    service_rate_limit_per_min: int = _env_int("SERVICE_RATE_LIMIT_PER_MIN", 1200)
    # Sliding-window seconds used for rate-limit buckets.
    rate_limit_window_sec: int = _env_int("RATE_LIMIT_WINDOW_SEC", 60)
    # Feature flag: require X-Credential on /generate paths.
    require_agent_credential_for_generate: bool = _env_bool("REQUIRE_AGENT_CREDENTIAL_FOR_GENERATE", False)

    # Platform hard caps for seller-registered forwarding constraints.
    # These guardrails prevent a single service manifest from exhausting gateway resources.
    gateway_min_timeout_ms: int = _env_int("GATEWAY_MIN_TIMEOUT_MS", 300)
    gateway_max_timeout_ms: int = _env_int("GATEWAY_MAX_TIMEOUT_MS", 15000)
    gateway_min_request_bytes: int = _env_int("GATEWAY_MIN_REQUEST_BYTES", 256)
    gateway_max_request_bytes: int = _env_int("GATEWAY_MAX_REQUEST_BYTES", 262144)
    gateway_min_response_bytes: int = _env_int("GATEWAY_MIN_RESPONSE_BYTES", 256)
    gateway_max_response_bytes: int = _env_int("GATEWAY_MAX_RESPONSE_BYTES", 1048576)
    gateway_min_service_qps: int = _env_int("GATEWAY_MIN_SERVICE_QPS", 1)
    gateway_max_service_qps: int = _env_int("GATEWAY_MAX_SERVICE_QPS", 200)

    # Service health monitor controls for seller upstream availability checks.
    service_health_monitor_enabled: bool = _env_bool("SERVICE_HEALTH_MONITOR_ENABLED", True)
    service_health_probe_interval_sec: float = _env_float("SERVICE_HEALTH_PROBE_INTERVAL_SEC", 15.0)
    service_health_probe_timeout_ms: int = _env_int("SERVICE_HEALTH_PROBE_TIMEOUT_MS", 1500)
    service_health_stale_after_sec: int = _env_int("SERVICE_HEALTH_STALE_AFTER_SEC", 120)
    forwarding_require_healthy_targets: bool = _env_bool("FORWARDING_REQUIRE_HEALTHY_TARGETS", True)
    service_health_history_enabled: bool = _env_bool("SERVICE_HEALTH_HISTORY_ENABLED", True)
    service_health_history_retention_days: int = _env_int("SERVICE_HEALTH_HISTORY_RETENTION_DAYS", 7)
    service_health_history_default_limit_per_target: int = _env_int("SERVICE_HEALTH_HISTORY_DEFAULT_LIMIT_PER_TARGET", 50)

    # Server bind host for the main app process.
    host: str = os.getenv("HOST", "0.0.0.1")
    # Server bind port for the main app process.
    port: int = _env_int("PORT", 5000)
    # Dedicated host for seller_fastapi.py launcher compatibility.
    seller_api_host: str = os.getenv("SELLER_API_HOST", "127.0.0.1")
    # Dedicated port for seller_fastapi.py launcher compatibility.
    seller_api_port: int = _env_int("SELLER_API_PORT", 8000)

    # Runtime JSON path: service registry.
    service_registry_path: str = os.getenv("SERVICE_REGISTRY_PATH", _runtime_path("service_registry.json"))
    # Runtime JSON path: agent registry.
    agent_registry_path: str = os.getenv("AGENT_REGISTRY_PATH", _runtime_path("agent_registry.json"))
    # Runtime JSON path: buyer credential records.
    agent_credentials_path: str = os.getenv("AGENT_CREDENTIALS_PATH", _runtime_path("agent_credentials.json"))
    # Runtime JSONL path: audit events.
    audit_log_path: str = os.getenv("AUDIT_LOG_PATH", _runtime_path("audit_log.jsonl"))
    # Runtime JSON path: buyer/seller/platform balances.
    balance_ledger_path: str = os.getenv("BALANCE_LEDGER_PATH", _runtime_path("balance_ledger.json"))
    # Runtime JSON path: usage logs.
    usage_log_path: str = os.getenv("USAGE_LOG_PATH", _runtime_path("usage_log.json"))
    # Runtime JSON path: deposit intents.
    deposit_intents_path: str = os.getenv("DEPOSIT_INTENTS_PATH", _runtime_path("deposit_intents.json"))
    # Runtime JSON path: legacy deposit cursor.
    deposit_event_cursor_path: str = os.getenv("DEPOSIT_EVENT_CURSOR_PATH", _runtime_path("deposit_event_cursor.json"))
    # Runtime JSON path: processed deposit event keys.
    deposit_event_processed_path: str = os.getenv("DEPOSIT_EVENT_PROCESSED_PATH", _runtime_path("deposit_event_processed.json"))
    # Runtime JSON path: refund intents.
    refund_intents_path: str = os.getenv("REFUND_INTENTS_PATH", _runtime_path("refund_intents.json"))
    # Runtime JSON path: router owner configs.
    router_config_path: str = os.getenv("ROUTER_CONFIG_PATH", _runtime_path("router_config.json"))
    # Runtime JSON path: wallet role mapping.
    wallet_roles_path: str = os.getenv("WALLET_ROLES_PATH", _runtime_path("wallet_roles.json"))
    # Runtime JSON path: provider secrets.
    provider_secrets_path: str = os.getenv("PROVIDER_SECRETS_PATH", _runtime_path("provider_secrets.json"))

    # Standardized payment-layer error metadata.
    error_responses: dict[int, dict[str, str]] = {
        402: {"description": "Payment required or invalid payment proof"},
        403: {"description": "Payment does not match seller/service policy"},
        408: {"description": "Payment confirmation timed out"},
        409: {"description": "Replay detected"},
        422: {"description": "Required serviceId missing"},
        500: {"description": "Provider API misconfiguration"},
    }
    # Standardized service-registry error metadata.
    service_registry_responses: dict[int, dict[str, str]] = {
        401: {"description": "Unauthorized"},
        403: {"description": "Forbidden (owner mismatch)"},
        400: {"description": "Invalid service registration payload"},
        404: {"description": "Service record not found"},
        500: {"description": "Service registry persistence error"},
    }
    # Standardized auth API error metadata.
    auth_responses: dict[int, dict[str, str]] = {
        401: {"description": "Unauthorized"},
        400: {"description": "Invalid auth payload"},
    }

    # Parsed per-service static prices; invalid JSON falls back to empty map.
    try:
        service_prices: dict[str, int] = {
            str(k): int(v) for k, v in json.loads(service_prices_json).items()
        }
    except Exception:
        service_prices = {}


settings = Settings()

# Ensure runtime storage exists for JSON persistence backends.
os.makedirs(settings.runtime_storage_dir, exist_ok=True)
