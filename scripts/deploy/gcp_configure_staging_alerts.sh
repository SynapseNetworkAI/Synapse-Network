#!/usr/bin/env bash

set -euo pipefail

PROJECT_ID="${1:-}"
RECEIVER_URL="${2:-}"
REGION="${REGION:-us-central1}"
GATEWAY_SERVICE_NAME="${GATEWAY_SERVICE_NAME:-synapse-staging-gateway}"
GATEWAY_ADMIN_SERVICE_NAME="${GATEWAY_ADMIN_SERVICE_NAME:-synapse-staging-gateway-admin}"
CHANNEL_DISPLAY_NAME="${CHANNEL_DISPLAY_NAME:-Synapse Staging Lark Gateway-admin Receiver}"
RECEIVER_USERNAME="${GCP_ALERT_RECEIVER_USERNAME:-synapse-gcp-alert}"
RECEIVER_TOKEN="${GCP_ALERT_RECEIVER_TOKEN:-}"

if [[ -z "$PROJECT_ID" || -z "$RECEIVER_URL" ]]; then
  echo "Usage: GCP_ALERT_RECEIVER_TOKEN=<token> bash scripts/deploy/gcp_configure_staging_alerts.sh <project-id> <receiver-url>" >&2
  exit 2
fi

if [[ -z "$RECEIVER_TOKEN" ]]; then
  echo "missing GCP_ALERT_RECEIVER_TOKEN" >&2
  echo "Agent fix: set the same token injected into gateway-admin as GCP_ALERT_RECEIVER_TOKEN." >&2
  exit 2
fi

for tool in gcloud curl python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "missing required tool: $tool" >&2
    exit 2
  fi
done

echo "[gcp-alerts] project=$PROJECT_ID"
echo "[gcp-alerts] receiver=$RECEIVER_URL"
gcloud config set project "$PROJECT_ID" >/dev/null
gcloud services enable monitoring.googleapis.com logging.googleapis.com --project "$PROJECT_ID" >/dev/null

channel_name="$(
  gcloud alpha monitoring channels list \
    --project "$PROJECT_ID" \
    --filter="displayName=\"$CHANNEL_DISPLAY_NAME\"" \
    --format="value(name)" | head -n 1
)"

if [[ -z "$channel_name" ]]; then
  echo "[gcp-alerts] creating webhook notification channel"
  gcloud alpha monitoring channels create \
    --project "$PROJECT_ID" \
    --display-name="$CHANNEL_DISPLAY_NAME" \
    --description="Routes staging GCP Monitoring alerts to gateway-admin, which relays to Lark." \
    --type=webhook_basicauth \
    --user-labels=env=staging,system=synapse,managed_by=synapse-script \
    --channel-labels=url="$RECEIVER_URL",username="$RECEIVER_USERNAME",password="$RECEIVER_TOKEN" \
    >/dev/null
  channel_name="$(
    gcloud alpha monitoring channels list \
      --project "$PROJECT_ID" \
      --filter="displayName=\"$CHANNEL_DISPLAY_NAME\"" \
      --format="value(name)" | head -n 1
  )"
else
  echo "[gcp-alerts] reusing webhook notification channel: $channel_name"
fi

if [[ -z "$channel_name" ]]; then
  echo "failed to create or locate notification channel" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

python3 - "$tmp_dir" "$PROJECT_ID" "$channel_name" "$GATEWAY_SERVICE_NAME" "$GATEWAY_ADMIN_SERVICE_NAME" "$REGION" <<'PY'
import json
import pathlib
import sys

out = pathlib.Path(sys.argv[1])
project_id = sys.argv[2]
channel_name = sys.argv[3]
gateway_service = sys.argv[4]
gateway_admin_service = sys.argv[5]
region = sys.argv[6]

runbook = "docs/ops/13_Production_Monitoring_Alerting_and_Backup_Restore.md"
labels = {
    "env": "staging",
    "system": "synapse",
    "route": "staging-drill",
    "managed_by": "synapse-script",
}

aggregation = {
    "alignmentPeriod": "300s",
    "perSeriesAligner": "ALIGN_RATE",
    "crossSeriesReducer": "REDUCE_SUM",
}

def policy(display_name, condition, documentation, extra_labels=None, alert_strategy=None):
    user_labels = dict(labels)
    if extra_labels:
        user_labels.update(extra_labels)
    return {
        "displayName": display_name,
        "combiner": "OR",
        "enabled": True,
        "notificationChannels": [channel_name],
        "documentation": {
            "mimeType": "text/markdown",
            "content": documentation,
        },
        "conditions": [condition],
        "alertStrategy": alert_strategy or {"autoClose": "1800s"},
        "userLabels": user_labels,
    }

gateway_5xx_filter = (
    'resource.type = "cloud_run_revision" '
    'AND metric.type = "run.googleapis.com/request_count" '
    f'AND resource.labels.service_name = "{gateway_service}" '
    'AND metric.labels.response_code_class = "5xx"'
)
gateway_all_filter = (
    'resource.type = "cloud_run_revision" '
    'AND metric.type = "run.googleapis.com/request_count" '
    f'AND resource.labels.service_name = "{gateway_service}"'
)

write = {
    "gateway-5xx.json": policy(
        "Synapse Staging Gateway 5xx Rate High",
        {
            "displayName": "Gateway 5xx ratio > 5% for 5 minutes",
            "conditionThreshold": {
                "filter": gateway_5xx_filter,
                "denominatorFilter": gateway_all_filter,
                "aggregations": [aggregation],
                "denominatorAggregations": [aggregation],
                "comparison": "COMPARISON_GT",
                "thresholdValue": 0.05,
                "duration": "300s",
                "trigger": {"count": 1},
            },
        },
        "\n".join([
            "Business scenario: Gateway API 5xx rate is above staging safety threshold.",
            "Impact: User deposit/withdraw/API paths may be unavailable.",
            "Trigger: Cloud Run request_count 5xx / all requests > 5% for 5 minutes.",
            "Action: Check Gateway logs, recent deploy, Cloud SQL connectivity, and RPC status.",
            f"Runbook: {runbook}",
            "[NO_ACTION_REQUIRED] for planned staging drills.",
        ]),
        {"alertname": "SynapseStagingGateway5xxRateHigh", "severity": "p1"},
    ),
    "withdrawal-timeout.json": policy(
        "Synapse Staging Withdrawal Timeout",
        {
            "displayName": "Withdrawal timeout structured log observed",
            "conditionMatchedLog": {
                "filter": (
                    'resource.type="cloud_run_revision" '
                    f'AND resource.labels.location="{region}" '
                    f'AND (resource.labels.service_name="{gateway_service}" '
                    f'OR resource.labels.service_name="{gateway_admin_service}") '
                    'AND (textPayload:"alert_trigger=WITHDRAWAL_TIMEOUT" '
                    'OR jsonPayload.alert_trigger="WITHDRAWAL_TIMEOUT")'
                )
            },
        },
        "\n".join([
            "Business scenario: Withdrawal queue has pending work older than the staging timeout.",
            "Impact: Funds may be stuck waiting for signing, claim, or manual review.",
            "Trigger: Gateway/Gateway-admin emitted alert_trigger=WITHDRAWAL_TIMEOUT.",
            "Action: Check withdrawal review queue, consumer withdraw processor, and provider reaper.",
            f"Runbook: {runbook}",
            "[NO_ACTION_REQUIRED] only when generated by an explicit staging drill.",
        ]),
        {"alertname": "SynapseStagingWithdrawalTimeout", "severity": "p1"},
        {"autoClose": "1800s", "notificationRateLimit": {"period": "300s"}},
    ),
    "reconciliation-drift.json": policy(
        "Synapse Staging Reconciliation Drift",
        {
            "displayName": "Reconciliation drift structured log observed",
            "conditionMatchedLog": {
                "filter": (
                    'resource.type="cloud_run_revision" '
                    f'AND resource.labels.location="{region}" '
                    f'AND resource.labels.service_name="{gateway_service}" '
                    'AND (textPayload:"alert_trigger=RECONCILIATION_DRIFT" '
                    'OR jsonPayload.alert_trigger="RECONCILIATION_DRIFT")'
                )
            },
        },
        "\n".join([
            "Business scenario: Ledger/vault reconciliation drift is non-zero.",
            "Impact: Internal ledger and on-chain vault may not reconcile.",
            "Trigger: Gateway emitted alert_trigger=RECONCILIATION_DRIFT.",
            "Action: Freeze public release, inspect deposit indexer, ledger rows, and chain tx evidence.",
            f"Runbook: {runbook}",
            "[NO_ACTION_REQUIRED] only when generated by an explicit staging drill.",
        ]),
        {"alertname": "SynapseStagingReconciliationDrift", "severity": "p0"},
        {"autoClose": "1800s", "notificationRateLimit": {"period": "300s"}},
    ),
}

for name, payload in write.items():
    (out / name).write_text(json.dumps(payload, indent=2), encoding="utf-8")
PY

access_token="$(gcloud auth print-access-token)"

upsert_policy() {
  local display_name="$1"
  local file_path="$2"
  local existing
  existing="$(
    gcloud alpha monitoring policies list \
      --project "$PROJECT_ID" \
      --filter="displayName=\"$display_name\"" \
      --format="value(name)" | head -n 1
  )"
  if [[ -z "$existing" ]]; then
    echo "[gcp-alerts] creating policy: $display_name"
    curl -sSf \
      -H "Authorization: Bearer $access_token" \
      -H "Content-Type: application/json" \
      --data-binary "@$file_path" \
      "https://monitoring.googleapis.com/v3/projects/$PROJECT_ID/alertPolicies" \
      >/dev/null
  else
    echo "[gcp-alerts] updating policy: $display_name ($existing)"
    curl -sSf -X PATCH \
      -H "Authorization: Bearer $access_token" \
      -H "Content-Type: application/json" \
      --data-binary "@$file_path" \
      "https://monitoring.googleapis.com/v3/$existing?updateMask=display_name,conditions,combiner,enabled,notification_channels,documentation,alert_strategy,user_labels" \
      >/dev/null
  fi
}

upsert_policy "Synapse Staging Gateway 5xx Rate High" "$tmp_dir/gateway-5xx.json"
upsert_policy "Synapse Staging Withdrawal Timeout" "$tmp_dir/withdrawal-timeout.json"
upsert_policy "Synapse Staging Reconciliation Drift" "$tmp_dir/reconciliation-drift.json"

echo "[gcp-alerts] ready"
echo "Notification channel: $channel_name"
echo "Policies:"
gcloud alpha monitoring policies list \
  --project "$PROJECT_ID" \
  --filter='displayName:"Synapse Staging"' \
  --format="table(displayName,name,enabled)"
