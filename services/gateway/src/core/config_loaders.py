"""Private loader helpers for config.py.

All functions here are implementation details of the settings bootstrap process.
They are re-exported through config.py so that existing test references like
``config._gateway_root_dir()`` continue to work without change.
"""
import json
import os
from urllib.parse import quote, urlsplit, urlunsplit

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


def _canonical_environment_name(raw_environment: str | None) -> str:
    normalized = str(raw_environment or "local").strip().lower()
    aliases = {
        "local": "local",
        "dev": "local",
        "development": "local",
        "stage": "staging",
        "staging": "staging",
        "prod": "prod",
        "production": "prod",
        "test": "test",
    }
    return aliases.get(normalized, normalized or "local")


def _environment_file_candidates(raw_environment: str | None) -> list[str]:
    normalized = str(raw_environment or "local").strip().lower()
    alias_candidates = {
        "local": [ENV_FILE_LOCAL],
        "development": [ENV_FILE_DEVELOPMENT, ENV_FILE_DEV, ENV_FILE_LOCAL],
        "dev": [ENV_FILE_DEV, ENV_FILE_DEVELOPMENT, ENV_FILE_LOCAL],
        "staging": [ENV_FILE_STAGING, ENV_FILE_STAGE],
        "stage": [ENV_FILE_STAGE, ENV_FILE_STAGING],
        "prod": [ENV_FILE_PROD, ENV_FILE_PRODUCTION],
        "production": [ENV_FILE_PRODUCTION, ENV_FILE_PROD],
        "test": [ENV_FILE_TEST],
    }
    if normalized in alias_candidates:
        return alias_candidates[normalized]

    canonical = _canonical_environment_name(normalized)
    canonical_candidates = {
        "local": [ENV_FILE_LOCAL],
        "staging": [ENV_FILE_STAGING, ENV_FILE_STAGE],
        "prod": [ENV_FILE_PROD, ENV_FILE_PRODUCTION],
        "test": [ENV_FILE_TEST],
    }
    return canonical_candidates.get(canonical, [f".env.{normalized}"])


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


def _load_usdc_address_from_contract_config() -> str:
    """Fallback: read USDC token address from frontend contract config."""
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
        value = payload.get("MockUSDC") or payload.get("USDC") or ""
        return str(value).strip()
    except Exception:
        return ""


def _gateway_root_dir() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _repo_root_dir() -> str:
    return os.path.abspath(os.path.join(_gateway_root_dir(), "..", ".."))


def _resolve_env_file_path(env_file: str) -> str:
    if os.path.isabs(env_file):
        return env_file

    gateway_path = os.path.join(_gateway_root_dir(), env_file)
    if os.path.exists(gateway_path):
        return gateway_path

    return os.path.join(_repo_root_dir(), env_file)


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

    repo_root = _repo_root_dir()
    gateway_root = _gateway_root_dir()

    base_env_candidates = [
        os.path.join(gateway_root, ".env"),
        os.path.join(repo_root, ".env"),
    ]
    for base_env_path in base_env_candidates:
        if os.path.exists(base_env_path):
            load_dotenv(base_env_path, override=False)
            break

    runtime_env = os.getenv("ENVIRONMENT", "local")
    candidates = _environment_file_candidates(runtime_env)

    for env_file in candidates:
        env_path = _resolve_env_file_path(env_file)
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


def _env_int_strict_range(
    name: str,
    default: int,
    *,
    minimum: int,
    maximum: int,
    fatal_code: str,
    guidance: str,
) -> int:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        value = default
    else:
        try:
            value = int(str(raw).strip())
        except Exception as exc:
            raise RuntimeError(  # noqa: TRY003 - startup errors must include operator-ready remediation.
                f"FATAL {fatal_code}: {name} must be an integer between {minimum} and {maximum}.\n"
                f"Agent fix: {guidance}"
            ) from exc
    if value < minimum or value > maximum:
        raise RuntimeError(  # noqa: TRY003 - startup errors must include operator-ready remediation.
            f"FATAL {fatal_code}: {name}={value} is outside the safe range {minimum}..{maximum}.\n"
            f"Agent fix: {guidance}"
        )
    return value


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


def _resolve_postgres_dsn(
    raw_dsn: str,
    *,
    user: str,
    password: str,
    host: str,
    port: int,
    database: str,
) -> str:
    dsn = str(raw_dsn or "").strip()
    password = str(password or "").strip()

    if not dsn:
        if not host or not database or not user:
            return ""
        encoded_user = quote(user, safe="")
        encoded_password = quote(password, safe="")
        auth = f"{encoded_user}:{encoded_password}@" if password else f"{encoded_user}@"
        return f"postgresql://{auth}{host}:{int(port)}/{database}"

    if not dsn.startswith(("postgresql://", "postgres://")):
        return dsn

    if not password:
        return dsn

    parsed = urlsplit(dsn)
    if not parsed.hostname or not parsed.username:
        return dsn

    encoded_user = quote(parsed.username, safe="")
    encoded_password = quote(password, safe="")
    host_part = parsed.hostname
    if parsed.port:
        host_part = f"{host_part}:{parsed.port}"
    netloc = f"{encoded_user}:{encoded_password}@{host_part}"
    return urlunsplit(
        (parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment)
    )


def _redis_auth_fragment(username: str, password: str) -> str:
    encoded_user = quote(str(username or "").strip(), safe="")
    encoded_password = quote(str(password or "").strip(), safe="")
    if encoded_user and encoded_password:
        return f"{encoded_user}:{encoded_password}@"
    if encoded_password:
        return f":{encoded_password}@"
    if encoded_user:
        return f"{encoded_user}@"
    return ""


def _build_redis_url_from_components(
    *,
    username: str,
    password: str,
    host: str,
    port: int,
    db: int,
) -> str:
    if not host:
        return ""
    return f"redis://{_redis_auth_fragment(username, password)}{host}:{int(port)}/{max(0, int(db))}"


def _normalize_redis_input_url(raw_url: str) -> str:
    value = str(raw_url or "").strip()
    if not value:
        return ""
    if "://" not in value:
        return f"redis://{value}"
    return value


def _resolve_redis_url(
    raw_url: str,
    *,
    username: str,
    password: str,
    host: str,
    port: int,
    db: int,
) -> str:
    url = _normalize_redis_input_url(raw_url)
    username = str(username or "").strip()
    password = str(password or "").strip()

    if not url:
        return _build_redis_url_from_components(
            username=username,
            password=password,
            host=host,
            port=port,
            db=db,
        )

    parsed = urlsplit(url)
    if parsed.scheme not in {"redis", "rediss"}:
        return url

    hostname = parsed.hostname
    if not hostname:
        return url

    final_user = username or (parsed.username or "")
    final_password = password or (parsed.password or "")
    final_port = parsed.port or int(port)
    path = parsed.path if parsed.path and parsed.path != "/" else f"/{max(0, int(db))}"

    auth = _redis_auth_fragment(final_user, final_password)
    netloc = f"{auth}{hostname}:{final_port}"
    return urlunsplit((parsed.scheme, netloc, path, parsed.query, parsed.fragment))
