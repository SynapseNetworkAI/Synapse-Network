import os
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

os.environ.setdefault("ADMIN_GATEWAY_USE_INMEMORY_STORE", "true")
os.environ.setdefault("EXECUTION_WORKER_ENABLED", "false")

from src.api import deps  # noqa: E402
from src.core.config import get_settings  # noqa: E402

get_settings.cache_clear()
deps.get_store.cache_clear()
deps.get_auth_service.cache_clear()
deps.get_admin_config_service.cache_clear()
deps.get_approval_service.cache_clear()
deps.get_gateway_dashboard_projection_repository.cache_clear()
deps.get_analytics_dashboard_repository.cache_clear()
deps.get_dashboard_service.cache_clear()
deps.get_provider_withdraw_review_repository.cache_clear()
deps.get_provider_withdraw_review_adapter.cache_clear()
deps.get_provider_withdraw_review_service.cache_clear()
deps.get_audit_service.cache_clear()
deps.get_execution_service.cache_clear()
deps.get_gateway_execution_adapter.cache_clear()
deps.get_execution_worker.cache_clear()
