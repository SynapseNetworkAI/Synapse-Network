import json
import os

RPC_URL = os.getenv("RPC_URL", "http://127.0.0.1:8545")
SELLER_ADDRESS = os.getenv("SELLER_ADDRESS", "0x0000000000000000000000000000000000000000")
EXPECTED_PRICE = int(os.getenv("EXPECTED_PRICE", "1000000000000000000"))
ROUTER_ADDRESS = os.getenv("ROUTER_ADDRESS", "0x0000000000000000000000000000000000000000")
MIN_CONFIRMATIONS = int(os.getenv("MIN_CONFIRMATIONS", "1"))
PAYMENT_TTL_SEC = int(os.getenv("PAYMENT_TTL_SEC", "600"))
ALLOWED_TOKEN_ADDRESSES = {
    addr.strip().lower()
    for addr in os.getenv("ALLOWED_TOKEN_ADDRESSES", "").split(",")
    if addr.strip()
}
SERVICE_PRICES_JSON = os.getenv("SERVICE_PRICES_JSON", "{}")
PAYMENT_TIMEOUT_MESSAGE = "Payment confirmation timed out"
INVALID_ADDRESS_MESSAGE = "address is invalid"

SERVICE_REGISTRY_PATH = os.getenv(
    "SERVICE_REGISTRY_PATH",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "service_registry.json"),
)

AGENT_REGISTRY_PATH = os.getenv(
    "AGENT_REGISTRY_PATH",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "agent_registry.json"),
)

AUTH_SECRET = os.getenv("AUTH_SECRET", "dev-secret-change-me")
AUTH_TOKEN_TTL_SEC = int(os.getenv("AUTH_TOKEN_TTL_SEC", "3600"))
AUTH_CHALLENGE_TTL_SEC = int(os.getenv("AUTH_CHALLENGE_TTL_SEC", "300"))
ALLOW_LEGACY_AUTH = os.getenv("ALLOW_LEGACY_AUTH", "1") == "1"

AGENT_CREDENTIALS_PATH = os.getenv(
    "AGENT_CREDENTIALS_PATH",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "agent_credentials.json"),
)
AUDIT_LOG_PATH = os.getenv(
    "AUDIT_LOG_PATH",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "audit_log.jsonl"),
)
BALANCE_LEDGER_PATH = os.getenv(
    "BALANCE_LEDGER_PATH",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "balance_ledger.json"),
)
USAGE_LOG_PATH = os.getenv(
    "USAGE_LOG_PATH",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "usage_log.json"),
)
DEPOSIT_INTENTS_PATH = os.getenv(
    "DEPOSIT_INTENTS_PATH",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "deposit_intents.json"),
)
DEPOSIT_EVENT_CURSOR_PATH = os.getenv(
    "DEPOSIT_EVENT_CURSOR_PATH",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "deposit_event_cursor.json"),
)
DEPOSIT_EVENT_PROCESSED_PATH = os.getenv(
    "DEPOSIT_EVENT_PROCESSED_PATH",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "deposit_event_processed.json"),
)
REFUND_INTENTS_PATH = os.getenv(
    "REFUND_INTENTS_PATH",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "refund_intents.json"),
)
ROUTER_CONFIG_PATH = os.getenv(
    "ROUTER_CONFIG_PATH",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "router_config.json"),
)
V2_DEPOSIT_CONFIRMATIONS = int(os.getenv("V2_DEPOSIT_CONFIRMATIONS", "1"))
V2_INDEXER_POLL_INTERVAL_SEC = float(os.getenv("V2_INDEXER_POLL_INTERVAL_SEC", "2"))
V2_INDEXER_BLOCK_BATCH = int(os.getenv("V2_INDEXER_BLOCK_BATCH", "100"))

AGENT_CREDENTIAL_DEFAULT_TTL_SEC = int(os.getenv("AGENT_CREDENTIAL_DEFAULT_TTL_SEC", "3600"))
AGENT_CREDENTIAL_MAX_TTL_SEC = int(os.getenv("AGENT_CREDENTIAL_MAX_TTL_SEC", "259200"))
AGENT_CREDENTIAL_MAX_CALLS_DEFAULT = int(os.getenv("AGENT_CREDENTIAL_MAX_CALLS_DEFAULT", "1000"))
OWNER_RATE_LIMIT_PER_MIN = int(os.getenv("OWNER_RATE_LIMIT_PER_MIN", "240"))
AGENT_RATE_LIMIT_PER_MIN = int(os.getenv("AGENT_RATE_LIMIT_PER_MIN", "600"))
SERVICE_RATE_LIMIT_PER_MIN = int(os.getenv("SERVICE_RATE_LIMIT_PER_MIN", "1200"))
RATE_LIMIT_WINDOW_SEC = int(os.getenv("RATE_LIMIT_WINDOW_SEC", "60"))
REQUIRE_AGENT_CREDENTIAL_FOR_GENERATE = os.getenv("REQUIRE_AGENT_CREDENTIAL_FOR_GENERATE", "0") == "1"

try:
    SERVICE_PRICES = {k: int(v) for k, v in json.loads(SERVICE_PRICES_JSON).items()}
except Exception:
    SERVICE_PRICES = {}

ERROR_RESPONSES = {
    402: {"description": "Payment required or invalid payment proof"},
    403: {"description": "Payment does not match seller/service policy"},
    408: {"description": "Payment confirmation timed out"},
    409: {"description": "Replay detected"},
    422: {"description": "Required serviceId missing"},
    500: {"description": "Provider API misconfiguration"},
}

SERVICE_REGISTRY_RESPONSES = {
    401: {"description": "Unauthorized"},
    403: {"description": "Forbidden (owner mismatch)"},
    400: {"description": "Invalid service registration payload"},
    404: {"description": "Service record not found"},
    500: {"description": "Service registry persistence error"},
}

AUTH_RESPONSES = {
    401: {"description": "Unauthorized"},
    400: {"description": "Invalid auth payload"},
}
