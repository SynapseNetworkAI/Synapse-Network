"""Service health service: public API re-export module.

Implementation is split across:
  - service_health_utils.py   — utility and persistence helpers
  - service_health_history.py — history append and pruning helpers
  - service_health_tiers.py   — probe tier and slow lane scheduling
  - service_health_probe.py   — probe and refresh functions
  - service_health_scheduler.py — background monitor scheduling

All symbols are re-exported here so that existing callers continue to work
unchanged, including tests that monkeypatch attributes via this module.
"""
from src.core.config import settings  # noqa: F401  # reason: re-exported for monkeypatching
from src.services.platform.service_health_utils import (  # noqa: F401  # reason: compatibility re-export module
    DEFAULT_HEALTH_PATH,
    _now_ms,
    build_probe_url,
    effective_runtime_status,
    get_healthy_target_urls,
    is_health_stale,
    is_service_discoverable,
    public_discover_status,
    public_health_summary,
    seed_service_health_from_persisted_rows,
    service_control_status,
    is_service_probeable,
    sync_service_target_health_table,
)
from src.services.platform.service_health_history import (  # noqa: F401  # reason: compatibility re-export module
    _should_prune_history,
    append_health_history_rows,
    build_probe_history_rows,
    cleanup_service_health_events_once,
    prune_health_history,
)
from src.services.platform.service_health_tiers import (  # noqa: F401  # reason: compatibility re-export module
    latest_service_health_checked_at,
    service_probe_interval_ms,
    service_probe_jitter_key,
    service_probe_tier,
    should_probe_service_now,
)
from src.services.platform.service_health_probe import (  # noqa: F401  # reason: compatibility re-export module
    force_probe_service_health,
    probe_service_health,
    refresh_all_service_health,
)
from src.services.platform.service_health_offline import (  # noqa: F401  # reason: compatibility re-export module
    ServiceOfflineCandidate,
    mark_offline_candidates,
    should_quarantine_offline,
)
from src.services.platform.service_health_scheduler import (  # noqa: F401  # reason: compatibility re-export module
    run_service_health_monitor,
)
