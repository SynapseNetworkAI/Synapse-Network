from __future__ import annotations

import argparse
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient


LOCAL_RECEIVER_VALUE = "local-receiver-value"
USERNAME = "synapse-gcp-alert"


class LarkSink(BaseHTTPRequestHandler):
    messages: list[dict[str, Any]] = []

    def do_POST(self) -> None:  # noqa: N802 - stdlib hook name.
        length = int(self.headers.get("content-length") or "0")
        raw = self.rfile.read(length).decode("utf-8")
        if self.path == "/fail":
            self.send_response(500)
            self.end_headers()
            self.wfile.write(b"fail")
            return
        LarkSink.messages.append(
            {
                "path": self.path,
                "headers": dict(self.headers),
                "body": json.loads(raw or "{}"),
            }
        )
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *_args: object) -> None:
        return


def _payload() -> dict[str, Any]:
    return {
        "incident": {
            "incident_id": "local-gcp-alert-probe",
            "state": "open",
            "policy_name": "Synapse Staging Gateway 5xx Rate High",
            "condition_name": "Gateway 5xx ratio > 5%",
            "summary": "[LARK_E2E_TEST][NO_ACTION_REQUIRED] local receiver probe",
            "resource": {
                "type": "cloud_run_revision",
                "labels": {"service_name": "synapse-staging-gateway"},
            },
            "metadata": {
                "user_labels": {
                    "severity": "p1",
                    "system": "gateway",
                    "env": "staging",
                    "route": "staging-drill",
                    "business_scenario": "Local GCP alert receiver can relay to fake Lark.",
                    "impact": "NO_ACTION_REQUIRED local drill.",
                    "trigger": "Synthetic local payload.",
                    "action": "Keep this local-only probe green before staging.",
                }
            },
        }
    }


def _configure_env(webhook: str) -> None:
    os.environ.update(
        {
            "ADMIN_GATEWAY_ENV_FILE": "",
            "ADMIN_GATEWAY_ALLOWED_ORIGINS": "http://localhost:4000",
            "EXECUTION_WORKER_ENABLED": "false",
            "GCP_ALERT_RECEIVER_ENABLED": "true",
            "GCP_ALERT_RECEIVER_TOKEN": LOCAL_RECEIVER_VALUE,
            "GCP_ALERT_RECEIVER_USERNAME": USERNAME,
            "GCP_ALERT_DEFAULT_ROUTE": "staging-drill",
            "LARK_WEBHOOK_STAGING_DRILL": webhook,
            "LARK_WEBHOOK_P0_WAR_ROOM": webhook,
            "LARK_WEBHOOK_PROD_ALERTS": webhook,
        }
    )


def _reload_settings(webhook: str) -> None:
    from src.core.config import get_settings  # noqa: PLC0415 - env must be set before app settings load.

    os.environ["LARK_WEBHOOK_STAGING_DRILL"] = webhook
    get_settings.cache_clear()


def _append(checks: list[dict[str, Any]], name: str, ok: bool, detail: str = "") -> None:
    checks.append({"name": name, "status": "passed" if ok else "failed", "detail": detail})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", 0), LarkSink)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    success_webhook = f"http://127.0.0.1:{server.server_port}/lark"
    fail_webhook = f"http://127.0.0.1:{server.server_port}/fail"
    _configure_env(success_webhook)

    from src.app import create_app  # noqa: PLC0415 - probe configures env before importing app.
    from src.core.config import get_settings  # noqa: PLC0415 - probe configures env before importing settings.

    get_settings.cache_clear()
    checks: list[dict[str, Any]] = []
    trace: list[dict[str, Any]] = []
    try:
        with TestClient(create_app(), base_url="https://gateway-admin.local") as client:
            missing = client.post("/api/v1/ops/webhooks/gcp-alert-receiver", json=_payload())
            _append(checks, "receiver-rejects-missing-token", missing.status_code == 401)
            trace.append({"scenario": "receiver-rejects-missing-token", "httpStatus": missing.status_code})

            wrong = client.post(
                "/api/v1/ops/webhooks/gcp-alert-receiver",
                headers={"X-Synapse-Gcp-Alert-Token": "wrong"},
                json=_payload(),
            )
            _append(checks, "receiver-rejects-wrong-token", wrong.status_code == 401)
            trace.append({"scenario": "receiver-rejects-wrong-token", "httpStatus": wrong.status_code})

            header = client.post(
                "/api/v1/ops/webhooks/gcp-alert-receiver",
                headers={"X-Synapse-Gcp-Alert-Token": LOCAL_RECEIVER_VALUE},
                json=_payload(),
            )
            _append(checks, "receiver-accepts-header-token", header.status_code == 200)
            trace.append({"scenario": "receiver-accepts-header-token", "httpStatus": header.status_code})

            basic = client.post(
                "/api/v1/ops/webhooks/gcp-alert-receiver",
                auth=(USERNAME, LOCAL_RECEIVER_VALUE),
                json=_payload(),
            )
            _append(checks, "receiver-accepts-basic-auth", basic.status_code == 200)
            trace.append({"scenario": "receiver-accepts-basic-auth", "httpStatus": basic.status_code})

            message = LarkSink.messages[-1]["body"] if LarkSink.messages else {}
            card_text = json.dumps(message, ensure_ascii=False)
            _append(
                checks,
                "fake-lark-card-business-context",
                "Local GCP alert receiver can relay" in card_text
                and "NO_ACTION_REQUIRED" in card_text
                and "local-receiver-value" not in card_text,
            )
            trace.append({"scenario": "fake-lark-card-business-context", "card": message})

            secret_payload = _payload()
            secret_payload["incident"]["summary"] = "authorization: Bearer local-secret-token"
            secret_payload["incident"]["metadata"]["user_labels"]["private_key"] = "0x" + "a" * 64
            redacted = client.post(
                "/api/v1/ops/webhooks/gcp-alert-receiver",
                headers={"X-Synapse-Gcp-Alert-Token": LOCAL_RECEIVER_VALUE},
                json=secret_payload,
            )
            secret_card = json.dumps(LarkSink.messages[-1]["body"], ensure_ascii=False)
            _append(
                checks,
                "receiver-redacts-secret-like-values",
                redacted.status_code == 200
                and "local-secret-token" not in secret_card
                and "aaaaaaaaaaaaaaaa" not in secret_card,
            )
            trace.append({"scenario": "receiver-redacts-secret-like-values", "httpStatus": redacted.status_code})

            _reload_settings(fail_webhook)
            failure = client.post(
                "/api/v1/ops/webhooks/gcp-alert-receiver",
                headers={"X-Synapse-Gcp-Alert-Token": LOCAL_RECEIVER_VALUE},
                json=_payload(),
            )
            _append(checks, "lark-failure-returns-502", failure.status_code == 502)
            trace.append({"scenario": "lark-failure-returns-502", "httpStatus": failure.status_code})
    finally:
        server.shutdown()
        thread.join(timeout=2)

    Path(args.out).write_text(
        json.dumps({"checks": checks, "trace": trace}, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
