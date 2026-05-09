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
        "consumer_withdraw_chain_recovery_enabled": gateway_app.settings.consumer_withdraw_chain_recovery_enabled,
        "withdrawal_expiry_sweeper_enabled": gateway_app.settings.withdrawal_expiry_sweeper_enabled,
        "in_app_notification_cleanup_enabled": gateway_app.settings.in_app_notification_cleanup_enabled,
        "service_health_event_cleanup_enabled": gateway_app.settings.service_health_event_cleanup_enabled,
        "environment": gateway_app.settings.environment,
        "consumer_withdraw_maturity_enforcement_enabled": gateway_app.settings.consumer_withdraw_maturity_enforcement_enabled,
        "provider_withdraw_maturity_enforcement_enabled": gateway_app.settings.provider_withdraw_maturity_enforcement_enabled,
        "staging_alert_drill_enabled": gateway_app.settings.staging_alert_drill_enabled,
        "staging_alert_drill_token": gateway_app.settings.staging_alert_drill_token,
        "internal_trigger_secret": gateway_app.settings.internal_trigger_secret,
        "notification_outbox_trigger_enabled": gateway_app.settings.notification_outbox_trigger_enabled,
    }
    gateway_app.settings.consumer_withdraw_maturity_enforcement_enabled = True
    gateway_app.settings.provider_withdraw_maturity_enforcement_enabled = True
    yield
    for key, value in snapshot.items():
        setattr(gateway_app.settings, key, value)
