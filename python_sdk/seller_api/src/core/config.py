import json
import os

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover - optional dependency
    load_dotenv = None


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


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


# Load SDK-local .env so all runtime entry points share a single env contract.
if load_dotenv is not None:
    load_dotenv(os.path.join(_sdk_root_dir(), ".env"), override=False)


class Settings:
    # Runtime mode flag used by the gateway for environment-specific behavior.
    environment: str = os.getenv("ENVIRONMENT", "development")
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
    # Storage directory used by JsonStorage; defaults to unified runtime directory.
    data_dir: str = os.getenv("DATA_DIR", os.getenv("RUNTIME_STORAGE_DIR", _default_runtime_storage_dir()))
    # JWT secret for auth token signing and verification.
    jwt_secret: str = os.getenv("JWT_SECRET", "super-secret-key-change-me")
    # Optional Redis URL for distributed counters and rate limits.
    redis_url: str = os.getenv("REDIS_URL", "").strip()

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
    auth_secret: str = os.getenv("AUTH_SECRET", os.getenv("JWT_SECRET", "super-secret-key-change-me"))
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
