"""Service health service: public API re-export module.

Implementation is split across:
  - service_health_utils.py   — utility, persistence, and history helpers
  - service_health_probe.py   — probe, refresh, and monitor functions

All symbols are re-exported here so that existing callers continue to work
unchanged, including tests that monkeypatch attributes via this module.
"""
from src.core.config import settings  # noqa: F401 — re-exported for monkeypatching
from src.services.platform.service_health_utils import (  # noqa: F401
    DEFAULT_HEALTH_PATH,
    _now_ms,
    _should_prune_history,
    append_health_history_rows,
    build_probe_history_rows,
    build_probe_url,
    effective_runtime_status,
    get_healthy_target_urls,
    is_health_stale,
    is_service_discoverable,
    prune_health_history,
    public_discover_status,
    public_health_summary,
    seed_service_health_from_persisted_rows,
    sync_service_target_health_table,
)
from src.services.platform.service_health_probe import (  # noqa: F401
    probe_service_health,
    refresh_all_service_health,
    run_service_health_monitor,
)
