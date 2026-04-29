"""Gateway runtime settings.

Private loader helpers live in ``config_loaders``; they are imported here so
that test code that accesses them via ``config.<helper>`` continues to work.
"""
import os
from datetime import datetime, timezone

from src.core.config_loaders import (
    _build_redis_url_from_components,  # noqa: F401 - re-exported for config helper tests.
    _canonical_environment_name,
    _env_bool,
    _env_float,
    _env_int,
    _env_int_strict_range,
    _env_rate,
    _environment_file_candidates,  # noqa: F401 - re-exported for config helper tests.
    _gateway_root_dir,
    _load_environment_files,
    _load_router_address_from_contract_config,
    _load_usdc_address_from_contract_config,
    _normalize_redis_input_url,  # noqa: F401 - re-exported for config helper tests.
    _redis_auth_fragment,  # noqa: F401 - re-exported for config helper tests.
    _repo_root_dir,  # noqa: F401 - re-exported for config helper tests.
    _resolve_env_file_path,  # noqa: F401 - re-exported for config helper tests.
    _resolve_postgres_dsn,
    _resolve_redis_url,
)

# Load environment files once so all runtime entry points share the same config contract.
_load_environment_files()

_service_health_history_retention_hours_default = max(
    1,
    _env_int(
        "SERVICE_HEALTH_HISTORY_RETENTION_HOURS",
        _env_int("SERVICE_HEALTH_HISTORY_RETENTION_DAYS", 7) * 24,
    ),
)


class Settings:
    # Runtime mode flag used by the gateway for environment-specific behavior.
    environment: str = _canonical_environment_name(os.getenv("ENVIRONMENT", "local"))
    # Structured logging defaults (JSON file sink managed via stdlib handlers).
    log_directory: str = os.path.abspath(
        os.getenv(
            "GATEWAY_LOG_DIR", os.path.join(_gateway_root_dir(), "logs", "gateway")
        )
    )
    log_file_name: str = os.getenv("GATEWAY_LOG_FILE_NAME", "gateway-runtime.log").strip() or "gateway-runtime.log"
    log_rotation: str = os.getenv("GATEWAY_LOG_ROTATION", "00:00").strip() or "00:00"
    log_retention_days: int = max(14, _env_int("GATEWAY_LOG_RETENTION_DAYS", 14))
    log_level: str = os.getenv("GATEWAY_LOG_LEVEL", "INFO").strip().upper() or "INFO"
    # Prometheus-compatible metrics are intentionally internal-only. The reverse
    # proxy should also block public /metrics access; this token is the app-layer
    # defense-in-depth guard for the Prometheus scraper.
    metrics_bearer_token: str = os.getenv("METRICS_BEARER_TOKEN", "").strip()
    metrics_basic_username: str = os.getenv("METRICS_BASIC_USERNAME", "").strip()
    metrics_basic_password: str = os.getenv("METRICS_BASIC_PASSWORD", "").strip()
    # Staging-only controlled 500 endpoint used to validate GCP Monitoring -> Lark.
    staging_alert_drill_enabled: bool = _env_bool("STAGING_ALERT_DRILL_ENABLED", False)
    staging_alert_drill_token: str = os.getenv("STAGING_ALERT_DRILL_TOKEN", "").strip()
    # RPC endpoint used by chain-facing flows (deposit indexer, receipt checks).
    rpc_url: str = os.getenv("RPC_URL", "http://127.0.0.1:8545")
    # Listener contract for deposit events; falls back to frontend contract config.
    router_address: str = (
        os.getenv("ROUTER_ADDRESS", "").strip()
        or _load_router_address_from_contract_config()
        or "0x0000000000000000000000000000000000000000"
    )
    # Minimum block confirmations before crediting a deposit intent.
    v2_deposit_confirmations: int = _env_int("V2_DEPOSIT_CONFIRMATIONS", 1)
    # Run the deposit indexer inside the API process. Cloud Run staging/prod
    # should set this false and run deposit-indexer as a scheduled one-shot job.
    v2_indexer_enabled: bool = _env_bool("V2_INDEXER_ENABLED", True)
    # Poll interval for the background deposit indexer loop.
    v2_indexer_poll_interval_sec: float = _env_float(
        "V2_INDEXER_POLL_INTERVAL_SEC", 2.0
    )
    # Delay first blocking indexer step so HTTP liveness can become responsive first.
    v2_indexer_startup_delay_sec: float = max(
        0.0, _env_float("V2_INDEXER_STARTUP_DELAY_SEC", 3.0)
    )
    # Upper bound for one blocking indexer step as observed by the FastAPI event loop.
    v2_indexer_step_timeout_sec: float = max(
        1.0, _env_float("V2_INDEXER_STEP_TIMEOUT_SEC", 20.0)
    )
    # Heartbeat freshness window used by readiness.
    v2_indexer_stale_after_sec: int = max(
        5, _env_int("V2_INDEXER_STALE_AFTER_SEC", 60)
    )
    # Hard timeout for Web3 HTTP calls. This must be lower than the step timeout
    # because asyncio cannot kill a synchronous worker thread after wait_for fires.
    rpc_request_timeout_sec: float = max(
        1.0,
        _env_float(
            "RPC_REQUEST_TIMEOUT_SEC",
            min(15.0, v2_indexer_step_timeout_sec),
        ),
    )
    # Reserved block batch size for indexer scaling upgrades.
    v2_indexer_block_batch: int = _env_int("V2_INDEXER_BLOCK_BATCH", 100)
    # Enable block-range backfill scanner for missed onchain deposits.
    v2_backfill_enabled: bool = _env_bool("V2_BACKFILL_ENABLED", True)
    # Confirmed block batch size scanned per backfill round.
    v2_backfill_block_batch: int = max(1, _env_int("V2_BACKFILL_BLOCK_BATCH", 200))
    # Optional fixed start block for backfill cursor bootstrap; 0 means auto bootstrap.
    v2_backfill_start_block: int = max(0, _env_int("V2_BACKFILL_START_BLOCK", 0))
    # Reconciliation monitor switch for chain-vs-ledger consistency checks.
    v2_reconciliation_enabled: bool = _env_bool("V2_RECONCILIATION_ENABLED", True)
    # Minimum interval between reconciliation checks.
    v2_reconciliation_interval_sec: float = max(
        2.0, _env_float("V2_RECONCILIATION_INTERVAL_SEC", 30.0)
    )
    # Alert threshold in USDC for chain-vs-ledger absolute delta.
    v2_reconciliation_alert_delta_usdc: str = (
        os.getenv("V2_RECONCILIATION_ALERT_DELTA_USDC", "1.0").strip() or "1.0"
    )
    # Token contract used for onchain vault balance reconciliation.
    usdc_token_address: str = (
        os.getenv("USDC_TOKEN_ADDRESS", "").strip()
        or _load_usdc_address_from_contract_config()
        or ""
    )
    # Gateway withdraw signer used to issue EIP-712 provider withdrawal tickets.
    # Provider settlements require this key to be configured in the runtime environment.
    private_key: str = os.getenv("PRIVATE_KEY", "")

    # Storage backend switch. Only "postgres" is supported.
    storage_backend: str = (
        os.getenv("STORAGE_BACKEND", "postgres").strip().lower() or "postgres"
    )
    # PostgreSQL basic connection fields used when POSTGRES_DSN is omitted or password override is required.
    postgres_host: str = os.getenv("POSTGRES_HOST", "postgres").strip()
    postgres_port: int = _env_int("POSTGRES_PORT", 5432)
    postgres_user: str = os.getenv("POSTGRES_USER", "synapse").strip()
    postgres_password: str = os.getenv("POSTGRES_PASSWORD", "").strip()
    postgres_db: str = os.getenv(
        "POSTGRES_DB", os.getenv("POSTGRES_DATABASE", "synapse_gateway")
    ).strip()
    # PostgreSQL DSN used by all environments (dev/stage/prod).
    postgres_dsn: str = _resolve_postgres_dsn(
        os.getenv("POSTGRES_DSN", ""),
        user=postgres_user,
        password=postgres_password,
        host=postgres_host,
        port=postgres_port,
        database=postgres_db,
    )
    postgres_connect_timeout_sec: int = max(
        1, _env_int("POSTGRES_CONNECT_TIMEOUT_SEC", 5)
    )
    # Max reusable Postgres connections kept by each Gateway process.
    # Keep this low on small Cloud SQL instances; total possible connections are
    # roughly Cloud Run max instances * POSTGRES_POOL_MAX.
    postgres_pool_max: int = _env_int_strict_range(
        "POSTGRES_POOL_MAX",
        5,
        minimum=1,
        maximum=10,
        fatal_code="DB-CONFIG-001",
        guidance="set POSTGRES_POOL_MAX between 1 and 10; staging default is 5.",
    )
    # Auto-create PostgreSQL tables/indexes on startup when using postgres backend.
    postgres_auto_init: bool = _env_bool("POSTGRES_AUTO_INIT", True)
    # JWT secret for auth token signing and verification.
    jwt_secret: str = os.getenv(
        "JWT_SECRET", "replace-this-with-a-32-byte-minimum-jwt-secret"
    )
    # Dedicated secret for admin -> gateway internal command tokens.
    gateway_internal_jwt_secret: str = os.getenv(
        "GATEWAY_INTERNAL_JWT_SECRET",
        "replace-this-with-a-separate-32-byte-minimum-internal-jwt-secret",
    )
    gateway_provider_signature_secret: str = os.getenv(
        "GATEWAY_PROVIDER_SIGNATURE_SECRET",
        "replace-this-with-a-provider-signature-secret",
    ).strip()
    # Expected issuer for internal service tokens.
    gateway_internal_token_issuer: str = os.getenv(
        "GATEWAY_INTERNAL_TOKEN_ISSUER", "gateway-admin"
    ).strip() or "gateway-admin"
    # Expected audience for internal service tokens.
    gateway_internal_token_audience: str = os.getenv(
        "GATEWAY_INTERNAL_TOKEN_AUDIENCE", "gateway-internal"
    ).strip() or "gateway-internal"
    # Allow-list of service subjects permitted to execute internal admin commands.
    gateway_internal_service_subjects: set[str] = {
        value.strip()
        for value in os.getenv(
            "GATEWAY_INTERNAL_SERVICE_SUBJECTS", "service:gateway-admin"
        ).split(",")
        if value.strip()
    } or {"service:gateway-admin"}
    # Optional Redis URL and fields for distributed counters and rate limits.
    redis_host: str = os.getenv("REDIS_HOST", "").strip()
    redis_port: int = _env_int("REDIS_PORT", 6379)
    redis_db: int = _env_int("REDIS_DB", 0)
    redis_username: str = os.getenv("REDIS_USERNAME", "").strip()
    redis_password: str = os.getenv("REDIS_PASSWORD", "").strip()
    redis_url: str = _resolve_redis_url(
        os.getenv("REDIS_URL", ""),
        username=redis_username,
        password=redis_password,
        host=redis_host,
        port=redis_port,
        db=redis_db,
    )

    # Global platform fee rate for gateway billing split, range [0.0, 1.0].
    # Example: 0.10 means 10% platform fee and 90% provider net.
    platform_fee_rate: float = _env_rate("PLATFORM_FEE_RATE", 0.10)
    # Fixed per-request routing fee charged to the consumer, in USDC.
    # Example: 0.0001 adds $0.0001 to every gateway generate call.
    gateway_routing_tax: float = max(0.0, _env_float("GATEWAY_ROUTING_TAX", 0.0001))
    # Optional admin wallet allow-list for fee-policy management endpoints.
    # Comma-separated lowercase/uppercase wallet addresses are accepted.
    platform_fee_admin_wallets: set[str] = {
        addr.strip().lower()
        for addr in os.getenv("PLATFORM_FEE_ADMIN_WALLETS", "").split(",")
        if addr.strip()
    }
    # Comma-separated admin wallet allow-list for indexer status endpoint.
    # If empty, falls back to PLATFORM_FEE_ADMIN_WALLETS.
    indexer_admin_wallets: set[str] = {
        addr.strip().lower()
        for addr in os.getenv("INDEXER_ADMIN_WALLETS", "").split(",")
        if addr.strip()
    } or set(platform_fee_admin_wallets)

    # DeepSeek API key used by service manifest parse-curl endpoint.
    deepseek_api_key: str = os.getenv("DEEPSEEK_API_KEY", "").strip()
    # DeepSeek API base URL for chat completion calls.
    deepseek_base_url: str = os.getenv(
        "DEEPSEEK_BASE_URL", "https://api.deepseek.com"
    ).strip()
    # Default model used to parse cURL into service manifest fields.
    deepseek_model: str = (
        os.getenv("DEEPSEEK_MODEL", "deepseek-chat").strip() or "deepseek-chat"
    )
    # Timeout (seconds) for DeepSeek parse-curl requests.
    deepseek_timeout_s: float = _env_float("DEEPSEEK_TIMEOUT_S", 30.0)

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
    finance_write_rate_limit_per_min: int = _env_int(
        "FINANCE_WRITE_RATE_LIMIT_PER_MIN", 60
    )

    # Default credential ttl (seconds) when caller omits expiration.
    agent_credential_default_ttl_sec: int = _env_int(
        "AGENT_CREDENTIAL_DEFAULT_TTL_SEC", 3600
    )
    # Maximum allowed credential ttl (seconds).
    agent_credential_max_ttl_sec: int = _env_int("AGENT_CREDENTIAL_MAX_TTL_SEC", 259200)
    # Default max calls for newly created credentials.
    agent_credential_max_calls_default: int = _env_int(
        "AGENT_CREDENTIAL_MAX_CALLS_DEFAULT", 1000
    )
    # Owner control-plane rate limit per minute.
    owner_rate_limit_per_min: int = _env_int("OWNER_RATE_LIMIT_PER_MIN", 240)
    # Credential data-plane rate limit per minute.
    agent_rate_limit_per_min: int = _env_int("AGENT_RATE_LIMIT_PER_MIN", 600)
    # Service aggregate rate limit per minute.
    service_rate_limit_per_min: int = _env_int("SERVICE_RATE_LIMIT_PER_MIN", 1200)
    # Sliding-window seconds used for rate-limit buckets.
    rate_limit_window_sec: int = _env_int("RATE_LIMIT_WINDOW_SEC", 60)
    # Feature flag: require X-Credential on /generate paths.
    require_agent_credential_for_generate: bool = _env_bool(
        "REQUIRE_AGENT_CREDENTIAL_FOR_GENERATE", False
    )

    # Platform hard caps for provider-registered forwarding constraints.
    # These guardrails prevent a single service manifest from exhausting gateway resources.
    gateway_min_timeout_ms: int = _env_int("GATEWAY_MIN_TIMEOUT_MS", 300)
    gateway_max_timeout_ms: int = _env_int("GATEWAY_MAX_TIMEOUT_MS", 60000)
    gateway_min_request_bytes: int = _env_int("GATEWAY_MIN_REQUEST_BYTES", 256)
    gateway_max_request_bytes: int = _env_int("GATEWAY_MAX_REQUEST_BYTES", 262144)
    gateway_min_response_bytes: int = _env_int("GATEWAY_MIN_RESPONSE_BYTES", 256)
    gateway_max_response_bytes: int = _env_int("GATEWAY_MAX_RESPONSE_BYTES", 1048576)
    gateway_min_service_qps: int = _env_int("GATEWAY_MIN_SERVICE_QPS", 1)
    gateway_max_service_qps: int = _env_int("GATEWAY_MAX_SERVICE_QPS", 200)
    gateway_default_timeout_ms: int = _env_int("GATEWAY_DEFAULT_TIMEOUT_MS", 15000)
    # LLM endpoints need a longer synchronous window than ordinary APIs, but
    # must still be bounded so holds, HTTP workers, and provider pools cannot
    # be pinned forever.
    gateway_llm_default_timeout_ms: int = _env_int(
        "GATEWAY_LLM_DEFAULT_TIMEOUT_MS", 120000
    )
    gateway_llm_max_timeout_ms: int = _env_int("GATEWAY_LLM_MAX_TIMEOUT_MS", 300000)
    gateway_default_request_bytes: int = _env_int("GATEWAY_DEFAULT_REQUEST_BYTES", 4096)
    gateway_default_response_bytes: int = _env_int(
        "GATEWAY_DEFAULT_RESPONSE_BYTES", 2048
    )
    gateway_default_service_qps: int = _env_int("GATEWAY_DEFAULT_SERVICE_QPS", 50)
    # Withdraw ticket expiry seconds for EIP-712 signed claim payload.
    provider_withdraw_deadline_sec: int = _env_int(
        "PROVIDER_WITHDRAW_DEADLINE_SEC", 1800
    )
    # The reaper must wait past local ticket expiry before releasing locked funds.
    withdraw_ticket_expiry_buffer_sec: int = _env_int(
        "WITHDRAW_TICKET_EXPIRY_BUFFER_SEC", 900
    )
    # The chain head timestamp must also pass this margin past the ticket deadline.
    withdraw_rpc_finality_margin_sec: int = _env_int(
        "WITHDRAW_RPC_FINALITY_MARGIN_SEC", 300
    )
    # Background reaper that periodically releases expired provider withdrawal tickets.
    provider_withdraw_expiry_reaper_enabled: bool = _env_bool(
        "PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED", True
    )
    provider_withdraw_expiry_reaper_interval_sec: float = _env_float(
        "PROVIDER_WITHDRAW_EXPIRY_REAPER_INTERVAL_SEC", 30.0
    )
    withdrawal_timeout_alert_after_sec: int = max(
        60, _env_int("WITHDRAWAL_TIMEOUT_ALERT_AFTER_SEC", 900)
    )

    # Consumer withdrawal recovery watcher: reconciles owner-executed
    # ``SynapseCore.withdraw`` flows and cancels expired tickets.
    consumer_withdraw_processor_enabled: bool = _env_bool(
        "CONSUMER_WITHDRAW_PROCESSOR_ENABLED", True
    )
    # Withdrawal risk-engine thresholds.
    withdrawal_auto_single_limit_usdc: float = max(
        0.0, _env_float("WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC", 100.0)
    )
    withdrawal_auto_24h_limit_usdc: float = max(
        0.0, _env_float("WITHDRAWAL_AUTO_24H_LIMIT_USDC", 500.0)
    )
    withdrawal_window_hours: int = max(1, _env_int("WITHDRAWAL_WINDOW_HOURS", 24))
    # Comma-separated provider addresses always treated as high risk.
    withdrawal_high_risk_provider_addresses: set[str] = {
        addr.strip().lower()
        for addr in os.getenv("WITHDRAWAL_HIGH_RISK_PROVIDER_ADDRESSES", "").split(",")
        if addr.strip()
    }

    # Service health monitor controls for provider upstream availability checks.
    service_health_monitor_enabled: bool = _env_bool(
        "SERVICE_HEALTH_MONITOR_ENABLED", True
    )
    service_health_probe_interval_sec: float = _env_float(
        "SERVICE_HEALTH_PROBE_INTERVAL_SEC", 15.0
    )
    # Upper bound for one monitor tick as observed by the FastAPI event loop.
    service_health_monitor_step_timeout_sec: float = max(
        1.0, _env_float("SERVICE_HEALTH_MONITOR_STEP_TIMEOUT_SEC", 20.0)
    )
    service_health_probe_timeout_ms: int = _env_int(
        "SERVICE_HEALTH_PROBE_TIMEOUT_MS", 1500
    )
    service_health_max_concurrency: int = _env_int(
        "SERVICE_HEALTH_MAX_CONCURRENCY", 32
    )
    service_health_jitter_enabled: bool = _env_bool(
        "SERVICE_HEALTH_JITTER_ENABLED", True
    )
    service_health_startup_jitter_sec: float = _env_float(
        "SERVICE_HEALTH_STARTUP_JITTER_SEC", 10.0
    )
    service_health_jitter_strategy: str = (
        os.getenv("SERVICE_HEALTH_JITTER_STRATEGY", "stable").strip().lower()
        or "stable"
    )
    service_health_stale_after_sec: int = _env_int(
        "SERVICE_HEALTH_STALE_AFTER_SEC", 120
    )
    service_health_outage_after_sec: int = _env_int(
        "SERVICE_HEALTH_OUTAGE_AFTER_SEC", 1800
    )
    service_health_slow_lane_after_sec: int = _env_int(
        "SERVICE_HEALTH_SLOW_LANE_AFTER_SEC", 1800
    )
    service_health_slow_lane_interval_sec: int = _env_int(
        "SERVICE_HEALTH_SLOW_LANE_INTERVAL_SEC", 300
    )
    service_health_slow_lane_suspended_interval_sec: int = _env_int(
        "SERVICE_HEALTH_SLOW_LANE_SUSPENDED_INTERVAL_SEC", 300
    )
    forwarding_require_healthy_targets: bool = _env_bool(
        "FORWARDING_REQUIRE_HEALTHY_TARGETS", True
    )
    # Adaptive downstream invoke protection. Health probes use the separate
    # SERVICE_HEALTH_* scheduler; these limits protect provider invoke targets.
    downstream_adaptive_concurrency_enabled: bool = _env_bool(
        "DOWNSTREAM_ADAPTIVE_CONCURRENCY_ENABLED", True
    )
    downstream_adaptive_default_concurrency: int = _env_int(
        "DOWNSTREAM_ADAPTIVE_DEFAULT_CONCURRENCY", 8
    )
    downstream_adaptive_min_concurrency: int = _env_int(
        "DOWNSTREAM_ADAPTIVE_MIN_CONCURRENCY", 1
    )
    downstream_adaptive_max_concurrency: int = _env_int(
        "DOWNSTREAM_ADAPTIVE_MAX_CONCURRENCY", 64
    )
    downstream_adaptive_queue_limit: int = _env_int(
        "DOWNSTREAM_ADAPTIVE_QUEUE_LIMIT", 32
    )
    downstream_adaptive_latency_target_ms: int = _env_int(
        "DOWNSTREAM_ADAPTIVE_LATENCY_TARGET_MS", 1500
    )
    downstream_adaptive_window_sec: int = _env_int(
        "DOWNSTREAM_ADAPTIVE_WINDOW_SEC", 10
    )
    downstream_adaptive_decrease_factor: float = _env_float(
        "DOWNSTREAM_ADAPTIVE_DECREASE_FACTOR", 0.5
    )
    downstream_adaptive_circuit_open_sec: int = _env_int(
        "DOWNSTREAM_ADAPTIVE_CIRCUIT_OPEN_SEC", 30
    )
    downstream_adaptive_redis_enabled: bool = _env_bool(
        "DOWNSTREAM_ADAPTIVE_REDIS_ENABLED", True
    )
    downstream_adaptive_circuit_failure_threshold: int = _env_int(
        "DOWNSTREAM_ADAPTIVE_CIRCUIT_FAILURE_THRESHOLD", 5
    )
    service_health_history_enabled: bool = _env_bool(
        "SERVICE_HEALTH_HISTORY_ENABLED", True
    )
    service_health_history_retention_hours: int = (
        _service_health_history_retention_hours_default
    )
    service_health_history_prune_interval_sec: int = _env_int(
        "SERVICE_HEALTH_HISTORY_PRUNE_INTERVAL_SEC", 300
    )
    service_health_history_default_limit_per_target: int = _env_int(
        "SERVICE_HEALTH_HISTORY_DEFAULT_LIMIT_PER_TARGET", 50
    )

    # Server bind host for the main app process.
    host: str = os.getenv("HOST", "0.0.0.1")
    # Server bind port for the main app process.
    port: int = _env_int("PORT", 5000)
    # Dedicated host for gateway/provider_fastapi.py launcher compatibility.
    provider_api_host: str = os.getenv("PROVIDER_API_HOST", "127.0.0.1")
    # Dedicated port for gateway/provider_fastapi.py launcher compatibility.
    provider_api_port: int = _env_int("PROVIDER_API_PORT", 8000)

    # Standardized payment-layer error metadata.
    error_responses: dict[int, dict[str, str]] = {
        402: {"description": "Payment required or invalid payment proof"},
        403: {"description": "Payment does not match provider/service policy"},
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

    # ── Analytics Pipeline ────────────────────────────────────────
    analytics_kafka_bootstrap_servers: str = os.getenv(
        "ANALYTICS_KAFKA_BOOTSTRAP_SERVERS", ""
    )
    analytics_kafka_topic: str = os.getenv(
        "ANALYTICS_KAFKA_TOPIC", "synapse.analytics.events"
    )
    analytics_fallback_file: str = os.getenv(
        "ANALYTICS_FALLBACK_FILE", "logs/analytics_events.jsonl"
    )
    analytics_strict_kafka: bool = _env_bool("ANALYTICS_STRICT_KAFKA", False)
    analytics_transport: str = (
        os.getenv("ANALYTICS_TRANSPORT", "direct").strip().lower() or "direct"
    )
    analytics_outbox_batch_size: int = max(1, _env_int("ANALYTICS_OUTBOX_BATCH_SIZE", 500))
    analytics_outbox_max_attempts: int = max(1, _env_int("ANALYTICS_OUTBOX_MAX_ATTEMPTS", 8))
    analytics_outbox_retry_base_sec: int = max(1, _env_int("ANALYTICS_OUTBOX_RETRY_BASE_SEC", 5))

    # ── Async Email Notifications ────────────────────────────────
    email_transport: str = (
        os.getenv("EMAIL_TRANSPORT", "gmail_smtp").strip().lower() or "gmail_smtp"
    )
    gmail_smtp_host: str = os.getenv("GMAIL_SMTP_HOST", "smtp.gmail.com").strip() or "smtp.gmail.com"
    gmail_smtp_port: int = _env_int("GMAIL_SMTP_PORT", 587)
    gmail_smtp_username: str = os.getenv("GMAIL_SMTP_USERNAME", "").strip()
    gmail_smtp_app_password: str = os.getenv("GMAIL_SMTP_APP_PASSWORD", "").strip()
    email_from: str = os.getenv("EMAIL_FROM", gmail_smtp_username).strip()
    email_reply_to: str = os.getenv("EMAIL_REPLY_TO", "").strip()
    email_send_timeout_sec: float = max(1.0, _env_float("EMAIL_SEND_TIMEOUT_SEC", 10.0))
    email_max_per_minute: int = max(1, _env_int("EMAIL_MAX_PER_MINUTE", 60))
    email_gmail_daily_soft_limit: int = max(0, _env_int("EMAIL_GMAIL_DAILY_SOFT_LIMIT", 1500))
    email_gmail_daily_hard_limit: int = max(0, _env_int("EMAIL_GMAIL_DAILY_HARD_LIMIT", 1900))
    email_worker_batch_size: int = max(1, _env_int("EMAIL_WORKER_BATCH_SIZE", 50))
    email_outbox_max_attempts: int = max(1, _env_int("EMAIL_OUTBOX_MAX_ATTEMPTS", 8))
    email_outbox_retry_base_sec: int = max(1, _env_int("EMAIL_OUTBOX_RETRY_BASE_SEC", 30))
    public_gateway_base_url: str = os.getenv("PUBLIC_GATEWAY_BASE_URL", "").strip().rstrip("/")
    public_app_base_url: str = (
        os.getenv(
            "PUBLIC_APP_BASE_URL",
            {
                "local": "http://127.0.0.1:3000",
                "staging": "https://staging.synapse-network.ai",
                "production": "https://synapse-network.ai",
            }.get(environment, "https://synapse-network.ai"),
        )
        .strip()
        .rstrip("/")
    )
    email_verification_ttl_sec: int = max(300, _env_int("EMAIL_VERIFICATION_TTL_SEC", 86400))

    # ── Staging transaction notifications ───────────────────────
    transaction_lark_enabled: bool = _env_bool("TRANSACTION_LARK_ENABLED", False)
    transaction_lark_webhook_url: str = os.getenv("TRANSACTION_LARK_WEBHOOK_URL", "").strip()
    transaction_lark_secret: str = os.getenv("TRANSACTION_LARK_SECRET", "").strip()
    transaction_lark_timeout_sec: float = max(1.0, _env_float("TRANSACTION_LARK_TIMEOUT_SEC", 8.0))

    # ── In-App Notifications ────────────────────────────────────
    in_app_notification_cleanup_enabled: bool = _env_bool(
        "IN_APP_NOTIFICATION_CLEANUP_ENABLED", True
    )
    in_app_notification_cleanup_interval_sec: int = max(
        60, _env_int("IN_APP_NOTIFICATION_CLEANUP_INTERVAL_SEC", 86400)
    )
    in_app_notification_retention_days: int = max(
        1, _env_int("IN_APP_NOTIFICATION_RETENTION_DAYS", 90)
    )
    in_app_notification_security_retention_days: int = max(
        in_app_notification_retention_days,
        _env_int("IN_APP_NOTIFICATION_SECURITY_RETENTION_DAYS", 180),
    )
    in_app_notification_cleanup_batch_size: int = max(
        1, _env_int("IN_APP_NOTIFICATION_CLEANUP_BATCH_SIZE", 1000)
    )

    # ── Provider upstream HTTP client pool ───────────────────────
    provider_http_client_pool_enabled: bool = _env_bool("PROVIDER_HTTP_CLIENT_POOL_ENABLED", True)
    provider_http_client_max_connections: int = max(
        1, _env_int("PROVIDER_HTTP_CLIENT_MAX_CONNECTIONS", 256)
    )
    provider_http_client_max_keepalive_connections: int = max(
        1, _env_int("PROVIDER_HTTP_CLIENT_MAX_KEEPALIVE_CONNECTIONS", 64)
    )
    provider_http_client_connect_timeout_sec: float = max(
        0.05, _env_float("PROVIDER_HTTP_CLIENT_CONNECT_TIMEOUT_SEC", 1.0)
    )
    provider_http_client_write_timeout_sec: float = max(
        0.05, _env_float("PROVIDER_HTTP_CLIENT_WRITE_TIMEOUT_SEC", 2.0)
    )
    provider_http_client_pool_timeout_sec: float = max(
        0.01, _env_float("PROVIDER_HTTP_CLIENT_POOL_TIMEOUT_SEC", 0.05)
    )

    def _log_date_slug(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    @property
    def log_file_path(self) -> str:
        dated_directory = os.path.join(self.log_directory, self._log_date_slug())
        return os.path.abspath(os.path.join(dated_directory, self.log_file_name))

settings = Settings()
