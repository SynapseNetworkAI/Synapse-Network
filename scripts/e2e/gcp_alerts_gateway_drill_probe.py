from __future__ import annotations

import argparse
import json
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient


LOCAL_DRILL_VALUE = "local-drill-value"


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


def _client():
    from src import app as gateway_app  # noqa: PLC0415 - probe patches app dependencies before creating TestClient.

    gateway_app.create_storage = lambda _settings: SimpleNamespace()
    gateway_app.run_v2_deposit_indexer = _background_loop_until_stopped
    gateway_app.run_service_health_monitor = _background_loop_until_stopped
    gateway_app.run_provider_withdraw_expiry_reaper = _background_loop_until_stopped
    gateway_app.run_consumer_withdraw_processor = _background_loop_until_stopped
    gateway_app.run_in_app_notification_cleanup = _background_loop_until_stopped
    gateway_app.settings.v2_indexer_enabled = False
    gateway_app.settings.service_health_monitor_enabled = False
    gateway_app.settings.provider_withdraw_expiry_reaper_enabled = False
    gateway_app.settings.consumer_withdraw_processor_enabled = False
    gateway_app.settings.in_app_notification_cleanup_enabled = False
    return gateway_app, TestClient(gateway_app.create_app(), base_url="https://gateway.local")


def _append(checks: list[dict[str, str]], name: str, ok: bool, detail: str = "") -> None:
    checks.append({"name": name, "status": "passed" if ok else "failed", "detail": detail})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    gateway_app, client = _client()
    checks: list[dict[str, str]] = []
    trace: list[dict[str, object]] = []
    with client:
        gateway_app.settings.environment = "staging"
        gateway_app.settings.staging_alert_drill_enabled = False
        gateway_app.settings.staging_alert_drill_token = LOCAL_DRILL_VALUE
        disabled = client.get(
            "/api/v1/ops/drills/http-500",
            headers={"X-Synapse-Drill-Token": LOCAL_DRILL_VALUE},
        )
        _append(checks, "gateway-drill-disabled-by-default", disabled.status_code == 404)
        trace.append({"scenario": "gateway-drill-disabled-by-default", "httpStatus": disabled.status_code})

        gateway_app.settings.staging_alert_drill_enabled = True
        wrong = client.get(
            "/api/v1/ops/drills/http-500",
            headers={"X-Synapse-Drill-Token": "wrong"},
        )
        _append(checks, "gateway-drill-rejects-wrong-token", wrong.status_code == 401)
        trace.append({"scenario": "gateway-drill-rejects-wrong-token", "httpStatus": wrong.status_code})

        ok = client.get(
            "/api/v1/ops/drills/http-500",
            headers={"X-Synapse-Drill-Token": LOCAL_DRILL_VALUE},
        )
        _append(checks, "gateway-drill-controlled-500", ok.status_code == 500)
        trace.append({"scenario": "gateway-drill-controlled-500", "httpStatus": ok.status_code})

        gateway_app.settings.environment = "prod"
        prod = client.get(
            "/api/v1/ops/drills/http-500",
            headers={"X-Synapse-Drill-Token": LOCAL_DRILL_VALUE},
        )
        _append(checks, "gateway-drill-refuses-prod", prod.status_code == 404)
        trace.append({"scenario": "gateway-drill-refuses-prod", "httpStatus": prod.status_code})

    Path(args.out).write_text(
        json.dumps({"checks": checks, "trace": trace}, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
