from __future__ import annotations

import pytest

from src import app as gateway_app


@pytest.fixture(autouse=True)
def reset_gateway_settings():
    snapshot = {
        "v2_indexer_enabled": gateway_app.settings.v2_indexer_enabled,
        "service_health_monitor_enabled": gateway_app.settings.service_health_monitor_enabled,
        "provider_withdraw_expiry_reaper_enabled": gateway_app.settings.provider_withdraw_expiry_reaper_enabled,
        "consumer_withdraw_processor_enabled": gateway_app.settings.consumer_withdraw_processor_enabled,
        "in_app_notification_cleanup_enabled": gateway_app.settings.in_app_notification_cleanup_enabled,
    }
    yield
    for key, value in snapshot.items():
        setattr(gateway_app.settings, key, value)
