"""Deprecated compatibility layer.

All new code should import `settings` from `src.core.config`.
This module remains only to preserve legacy constant imports.
"""

from src.core.config import settings

# Compatibility aliases (read-only values sourced from centralized settings).
RUNTIME_STORAGE_DIR = settings.runtime_storage_dir
RPC_URL = settings.rpc_url
SELLER_ADDRESS = settings.seller_address
EXPECTED_PRICE = settings.expected_price
ROUTER_ADDRESS = settings.router_address
MIN_CONFIRMATIONS = settings.min_confirmations
PAYMENT_TTL_SEC = settings.payment_ttl_sec
ALLOWED_TOKEN_ADDRESSES = settings.allowed_token_addresses
SERVICE_PRICES_JSON = settings.service_prices_json
PAYMENT_TIMEOUT_MESSAGE = settings.payment_timeout_message
INVALID_ADDRESS_MESSAGE = settings.invalid_address_message
SERVICE_REGISTRY_PATH = settings.service_registry_path
AGENT_REGISTRY_PATH = settings.agent_registry_path
AUTH_SECRET = settings.auth_secret
AUTH_TOKEN_TTL_SEC = settings.auth_token_ttl_sec
AUTH_CHALLENGE_TTL_SEC = settings.auth_challenge_ttl_sec
ALLOW_LEGACY_AUTH = settings.allow_legacy_auth
AGENT_CREDENTIALS_PATH = settings.agent_credentials_path
AUDIT_LOG_PATH = settings.audit_log_path
BALANCE_LEDGER_PATH = settings.balance_ledger_path
USAGE_LOG_PATH = settings.usage_log_path
DEPOSIT_INTENTS_PATH = settings.deposit_intents_path
DEPOSIT_EVENT_CURSOR_PATH = settings.deposit_event_cursor_path
DEPOSIT_EVENT_PROCESSED_PATH = settings.deposit_event_processed_path
REFUND_INTENTS_PATH = settings.refund_intents_path
ROUTER_CONFIG_PATH = settings.router_config_path
V2_DEPOSIT_CONFIRMATIONS = settings.v2_deposit_confirmations
V2_INDEXER_POLL_INTERVAL_SEC = settings.v2_indexer_poll_interval_sec
V2_INDEXER_BLOCK_BATCH = settings.v2_indexer_block_batch
AGENT_CREDENTIAL_DEFAULT_TTL_SEC = settings.agent_credential_default_ttl_sec
AGENT_CREDENTIAL_MAX_TTL_SEC = settings.agent_credential_max_ttl_sec
AGENT_CREDENTIAL_MAX_CALLS_DEFAULT = settings.agent_credential_max_calls_default
OWNER_RATE_LIMIT_PER_MIN = settings.owner_rate_limit_per_min
AGENT_RATE_LIMIT_PER_MIN = settings.agent_rate_limit_per_min
SERVICE_RATE_LIMIT_PER_MIN = settings.service_rate_limit_per_min
RATE_LIMIT_WINDOW_SEC = settings.rate_limit_window_sec
REQUIRE_AGENT_CREDENTIAL_FOR_GENERATE = settings.require_agent_credential_for_generate
SERVICE_PRICES = settings.service_prices
ERROR_RESPONSES = settings.error_responses
SERVICE_REGISTRY_RESPONSES = settings.service_registry_responses
AUTH_RESPONSES = settings.auth_responses
WALLET_ROLES_PATH = settings.wallet_roles_path
PROVIDER_SECRETS_PATH = settings.provider_secrets_path
