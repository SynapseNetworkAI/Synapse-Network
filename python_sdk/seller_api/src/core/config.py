import json
import os


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

class Settings:
    # Runtime mode flag used by the gateway for environment-specific behavior.
    environment: str = os.getenv("ENVIRONMENT", "development")
    # RPC endpoint used by chain-facing flows (deposit indexer, receipt checks).
    rpc_url: str = os.getenv("RPC_URL", "http://127.0.0.1:8545")
    # Listener contract for deposit events; falls back to frontend contract config.
    router_address: str = os.getenv("ROUTER_ADDRESS", "").strip() or _load_router_address_from_contract_config() or "0x0000000000000000000000000000000000000000"
    # Minimum block confirmations before crediting a deposit intent.
    v2_deposit_confirmations: int = int(os.getenv("V2_DEPOSIT_CONFIRMATIONS", "1"))
    # Poll interval for the background deposit indexer loop.
    v2_indexer_poll_interval_sec: float = float(os.getenv("V2_INDEXER_POLL_INTERVAL_SEC", "2"))
    # Reserved block batch size for indexer scaling upgrades.
    v2_indexer_block_batch: int = int(os.getenv("V2_INDEXER_BLOCK_BATCH", "100"))
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
    # API bind host.
    host: str = os.getenv("HOST", "0.0.0.1")
    # API bind port.
    port: int = int(os.getenv("PORT", "5000"))

settings = Settings()
