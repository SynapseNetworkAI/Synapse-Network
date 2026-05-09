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
UPTIME_REGIONS="${UPTIME_REGIONS:-usa-iowa,usa-oregon,asia-pacific}"
GATEWAY_PUBLIC_HOST="${GATEWAY_PUBLIC_HOST:-api-staging.synapse-network.ai}"
USER_FRONT_PUBLIC_HOST="${USER_FRONT_PUBLIC_HOST:-staging.synapse-network.ai}"
ADMIN_API_PUBLIC_HOST="${ADMIN_API_PUBLIC_HOST:-admin-api-staging.synapse-network.ai}"

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

upsert_uptime_check() {
  local display_name="$1"
  local host="$2"
  local path="$3"
  local existing
  existing="$(
    gcloud monitoring uptime list-configs \
      --project "$PROJECT_ID" \
      --filter="displayName=\"$display_name\"" \
      --format="value(name)" | head -n 1
  )"
  if [[ -z "$existing" ]]; then
    echo "[gcp-alerts] creating uptime check: $display_name -> https://$host$path" >&2
    gcloud monitoring uptime create "$display_name" \
      --project "$PROJECT_ID" \
      --resource-type=uptime-url \
      --resource-labels=host="$host",project_id="$PROJECT_ID" \
      --protocol=https \
      --path="$path" \
      --port=443 \
      --request-method=get \
      --period=1 \
      --timeout=10 \
      --regions="$UPTIME_REGIONS" \
      --validate-ssl=true \
      --status-classes=2xx \
      --user-labels=env=staging,system=synapse,route=staging-drill,managed_by=synapse-script \
      >/dev/null
    existing="$(
      gcloud monitoring uptime list-configs \
        --project "$PROJECT_ID" \
        --filter="displayName=\"$display_name\"" \
        --format="value(name)" | head -n 1
    )"
  else
    echo "[gcp-alerts] updating uptime check: $display_name ($existing)" >&2
    gcloud monitoring uptime update "$existing" \
      --project "$PROJECT_ID" \
      --path="$path" \
      --period=1 \
      --timeout=10 \
      --set-regions="$UPTIME_REGIONS" \
      --validate-ssl=true \
      --set-status-classes=2xx \
      --update-user-labels=env=staging,system=synapse,route=staging-drill,managed_by=synapse-script \
      >/dev/null
  fi

  if [[ -z "$existing" ]]; then
    echo "failed to create or locate uptime check: $display_name" >&2
    exit 1
  fi
  basename "$existing"
}

gateway_health_check_id="$(
  upsert_uptime_check "Synapse Staging Gateway Health Uptime" "$GATEWAY_PUBLIC_HOST" "/health"
)"
gateway_readiness_check_id="$(
  upsert_uptime_check "Synapse Staging Gateway Readiness Uptime" "$GATEWAY_PUBLIC_HOST" "/readiness"
)"
user_front_check_id="$(
  upsert_uptime_check "Synapse Staging User Front Uptime" "$USER_FRONT_PUBLIC_HOST" "/"
)"
admin_api_health_check_id="$(
  upsert_uptime_check "Synapse Staging Admin API Health Uptime" "$ADMIN_API_PUBLIC_HOST" "/health"
)"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

python3 - "$tmp_dir" "$PROJECT_ID" "$channel_name" "$GATEWAY_SERVICE_NAME" "$GATEWAY_ADMIN_SERVICE_NAME" "$REGION" "$gateway_health_check_id" "$gateway_readiness_check_id" "$user_front_check_id" "$admin_api_health_check_id" <<'PY'
import json
import pathlib
import sys

out = pathlib.Path(sys.argv[1])
project_id = sys.argv[2]
channel_name = sys.argv[3]
gateway_service = sys.argv[4]
gateway_admin_service = sys.argv[5]
region = sys.argv[6]
gateway_health_check_id = sys.argv[7]
gateway_readiness_check_id = sys.argv[8]
user_front_check_id = sys.argv[9]
admin_api_health_check_id = sys.argv[10]

runbook = "docs/ops/13_Production_Monitoring_Alerting_and_Backup_Restore.md"
labels = {
    "env": "staging",
    "system": "synapse",
    "route": "staging-drill",
    "managed_by": "synapse-script",
}

scheduled_jobs = [
    {
        "job": "synapse-staging-deposit-indexer",
        "display": "Synapse Staging Deposit Indexer Freshness",
        "alertname": "synapse_staging_deposit_indexer_freshness",
        "duration": "1500s",
        "schedule": "every 10 minutes",
        "action": "Check Cloud Scheduler, deposit indexer logs, RPC, and Cloud SQL connectivity.",
    },
    {
        "job": "synapse-staging-consumer-withdraw-chain-recovery",
        "display": "Synapse Staging Consumer Withdraw Chain Recovery Freshness",
        "alertname": "synapse_staging_consumer_withdraw_chain_recovery_freshness",
        "duration": "1500s",
        "schedule": "every 10 minutes",
        "action": "Check Cloud Scheduler, consumer withdraw chain recovery logs, RPC, and pending REQUESTED rows.",
    },
    {
        "job": "synapse-staging-withdrawal-expiry-sweeper",
        "display": "Synapse Staging Withdrawal Expiry Sweeper Freshness",
        "alertname": "synapse_staging_withdrawal_expiry_sweeper_freshness",
        "duration": "1500s",
        "schedule": "every 10 minutes",
        "action": "Check Cloud Scheduler, expiry sweeper logs, manual-review backlog, and stale withdrawal release flows.",
    },
    {
        "job": "synapse-staging-notification-outbox-drain",
        "display": "Synapse Staging Notification Outbox Drain Freshness",
        "alertname": "synapse_staging_notification_outbox_drain_freshness",
        "duration": "1500s",
        "schedule": "every 10 minutes",
        "action": "Check internal notification trigger, fallback Cloud Scheduler, Gmail SMTP secrets, notification outbox rows, and delivery logs.",
    },
]

aggregation = {
    "alignmentPeriod": "300s",
    "perSeriesAligner": "ALIGN_RATE",
    "crossSeriesReducer": "REDUCE_SUM",
}

count_5m_aggregation = {
    "alignmentPeriod": "300s",
    "perSeriesAligner": "ALIGN_DELTA",
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
gateway_admin_5xx_filter = (
    'resource.type = "cloud_run_revision" '
    'AND metric.type = "run.googleapis.com/request_count" '
    f'AND resource.labels.service_name = "{gateway_admin_service}" '
    'AND metric.labels.response_code_class = "5xx"'
)
gateway_admin_all_filter = (
    'resource.type = "cloud_run_revision" '
    'AND metric.type = "run.googleapis.com/request_count" '
    f'AND resource.labels.service_name = "{gateway_admin_service}"'
)

def uptime_policy(display_name, check_id, documentation, alertname, severity):
    return policy(
        display_name,
        {
            "displayName": f"{display_name} failing",
            "conditionThreshold": {
                "filter": (
                    'resource.type = "uptime_url" '
                    'AND metric.type = "monitoring.googleapis.com/uptime_check/check_passed" '
                    f'AND metric.labels.check_id = "{check_id}"'
                ),
                "aggregations": [
                    {
                        "alignmentPeriod": "60s",
                        "perSeriesAligner": "ALIGN_FRACTION_TRUE",
                        "crossSeriesReducer": "REDUCE_MEAN",
                    }
                ],
                "comparison": "COMPARISON_LT",
                "thresholdValue": 1,
                "duration": "120s",
                "trigger": {"count": 1},
            },
        },
        documentation,
        {"alertname": alertname, "severity": severity},
    )

def cloud_run_job_failed_policy():
    return policy(
        "Synapse Staging Cloud Run Job Failed",
        {
            "displayName": "Any staging Cloud Run Job completed with non-success result",
            "conditionThreshold": {
                "filter": (
                    'resource.type = "cloud_run_job" '
                    'AND metric.type = "run.googleapis.com/job/completed_execution_count" '
                    f'AND resource.labels.location = "{region}" '
                    'AND metric.labels.result != "succeeded"'
                ),
                "aggregations": [
                    {
                        "alignmentPeriod": "300s",
                        "perSeriesAligner": "ALIGN_DELTA",
                        "crossSeriesReducer": "REDUCE_SUM",
                    }
                ],
                "comparison": "COMPARISON_GT",
                "thresholdValue": 0,
                "duration": "0s",
                "trigger": {"count": 1},
            },
        },
        "\n".join([
            "Business scenario: A staging Cloud Run Job execution failed.",
            "Impact: Deposit indexing, withdrawal processing, notification drain, cleanup, or migrations may be stale.",
            "Trigger: Cloud Run job completed_execution_count with result != succeeded.",
            "Action: Check the failed job execution logs, Cloud Scheduler trigger, image digest, and Secret Manager injection.",
            f"Runbook: {runbook}",
            "[NO_ACTION_REQUIRED] only for planned staging drills.",
        ]),
        {"alertname": "synapse_staging_cloud_run_job_failed", "severity": "p1"},
    )

def cloud_run_job_freshness_policy(job):
    return policy(
        job["display"],
        {
            "displayName": f"{job['job']} has no recent successful execution",
            "conditionAbsent": {
                "filter": (
                    'resource.type = "cloud_run_job" '
                    'AND metric.type = "run.googleapis.com/job/completed_execution_count" '
                    f'AND resource.labels.location = "{region}" '
                    f'AND resource.labels.job_name = "{job["job"]}" '
                    'AND metric.labels.result = "succeeded"'
                ),
                "aggregations": [
                    {
                        "alignmentPeriod": "300s",
                        "perSeriesAligner": "ALIGN_DELTA",
                        "crossSeriesReducer": "REDUCE_SUM",
                    }
                ],
                "duration": job["duration"],
                "trigger": {"count": 1},
            },
        },
        "\n".join([
            f"Business scenario: Scheduled job `{job['job']}` has no recent successful execution.",
            f"Expected cadence: {job['schedule']}.",
            "Impact: Scheduled settlement/notification maintenance may be stalled even while Gateway /health is green.",
            f"Trigger: No successful Cloud Run Job execution for {job['duration']}.",
            f"Action: {job['action']}",
            f"Runbook: {runbook}",
            "[NO_ACTION_REQUIRED] only for planned staging drills.",
        ]),
        {"alertname": job["alertname"], "severity": "p1"},
    )

write = {
    "cloud-run-job-failed.json": cloud_run_job_failed_policy(),
    "gateway-uptime-health.json": uptime_policy(
        "Synapse Staging Gateway Health Uptime Down",
        gateway_health_check_id,
        "\n".join([
            "Business scenario: Public Gateway /health is unreachable from GCP uptime probes.",
            "Impact: DNS, TLS, Cloud Run routing, IAM, or Gateway process may be down.",
            "Trigger: uptime_check/check_passed < 1 for 2 minutes.",
            "Action: Check custom domain mapping, Cloud Run revision readiness, IAM/public access, and Gateway logs.",
            f"Runbook: {runbook}",
            "[NO_ACTION_REQUIRED] only for planned staging drills.",
        ]),
        "synapse_staging_gateway_health_uptime_down",
        "p1",
    ),
    "gateway-uptime-readiness.json": uptime_policy(
        "Synapse Staging Gateway Readiness Uptime Down",
        gateway_readiness_check_id,
        "\n".join([
            "Business scenario: Public Gateway /readiness is failing from GCP uptime probes.",
            "Impact: Gateway process may be live but dependencies or monitors are unhealthy.",
            "Trigger: uptime_check/check_passed < 1 for 2 minutes.",
            "Action: Check readiness body, Cloud SQL, RPC, background monitors, and recent deploys.",
            f"Runbook: {runbook}",
            "[NO_ACTION_REQUIRED] only for planned staging drills.",
        ]),
        "synapse_staging_gateway_readiness_uptime_down",
        "p1",
    ),
    "user-front-uptime.json": uptime_policy(
        "Synapse Staging User Front Uptime Down",
        user_front_check_id,
        "\n".join([
            "Business scenario: Public user-front staging site is unreachable.",
            "Impact: Browser dogfood and user-facing staging flows are unavailable.",
            "Trigger: uptime_check/check_passed < 1 for 2 minutes.",
            "Action: Check Cloud Run user-front service, domain mapping, TLS, and recent deploy.",
            f"Runbook: {runbook}",
            "[NO_ACTION_REQUIRED] only for planned staging drills.",
        ]),
        "synapse_staging_user_front_uptime_down",
        "p2",
    ),
    "admin-api-uptime-health.json": uptime_policy(
        "Synapse Staging Admin API Health Uptime Down",
        admin_api_health_check_id,
        "\n".join([
            "Business scenario: Public admin API /health is unreachable.",
            "Impact: Admin-front login/review/control-plane flows may be unavailable.",
            "Trigger: uptime_check/check_passed < 1 for 2 minutes.",
            "Action: Check gateway-admin Cloud Run service, domain mapping, admin DB migration, and logs.",
            f"Runbook: {runbook}",
            "[NO_ACTION_REQUIRED] only for planned staging drills.",
        ]),
        "synapse_staging_admin_api_health_uptime_down",
        "p1",
    ),
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
        {"alertname": "synapse_staging_gateway_5xx_rate_high", "severity": "p1"},
    ),
    "gateway-5xx-count.json": policy(
        "Synapse Staging Gateway 5xx Count High",
        {
            "displayName": "Gateway 5xx count >= 5 in 5 minutes",
            "conditionThreshold": {
                "filter": gateway_5xx_filter,
                "aggregations": [count_5m_aggregation],
                "comparison": "COMPARISON_GT",
                "thresholdValue": 4,
                "duration": "0s",
                "trigger": {"count": 1},
            },
        },
        "\n".join([
            "Business scenario: Low-traffic staging still produced at least 5 Gateway 5xx responses.",
            "Impact: Ratio alerts can be insensitive when staging traffic is sparse.",
            "Trigger: Cloud Run Gateway 5xx count >= 5 in a 5 minute window.",
            "Action: Check Gateway logs, drill endpoint usage, recent deploy, and Cloud SQL/RPC health.",
            f"Runbook: {runbook}",
            "[NO_ACTION_REQUIRED] for planned staging 500 drills.",
        ]),
        {"alertname": "synapse_staging_gateway_5xx_count_high", "severity": "p1"},
    ),
    "gateway-admin-5xx.json": policy(
        "Synapse Staging Gateway-admin 5xx Rate High",
        {
            "displayName": "Gateway-admin 5xx ratio > 5% for 5 minutes",
            "conditionThreshold": {
                "filter": gateway_admin_5xx_filter,
                "denominatorFilter": gateway_admin_all_filter,
                "aggregations": [aggregation],
                "denominatorAggregations": [aggregation],
                "comparison": "COMPARISON_GT",
                "thresholdValue": 0.05,
                "duration": "300s",
                "trigger": {"count": 1},
            },
        },
        "\n".join([
            "Business scenario: Gateway-admin API 5xx rate is above staging safety threshold.",
            "Impact: Admin login, withdrawal review, reconciliation, or GCP alert receiver may be unavailable.",
            "Trigger: Cloud Run request_count 5xx / all requests > 5% for 5 minutes.",
            "Action: Check gateway-admin logs, admin DB migration state, session/cookie config, and recent deploy.",
            f"Runbook: {runbook}",
            "[NO_ACTION_REQUIRED] for planned staging drills.",
        ]),
        {"alertname": "synapse_staging_gateway_admin_5xx_rate_high", "severity": "p1"},
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
        {"alertname": "synapse_staging_withdrawal_timeout", "severity": "p1"},
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
        {"alertname": "synapse_staging_reconciliation_drift", "severity": "p0"},
        {"autoClose": "1800s", "notificationRateLimit": {"period": "300s"}},
    ),
    "provider-upstream-unavailable.json": policy(
        "Synapse Staging Provider Upstream Unavailable",
        {
            "displayName": "Provider upstream unavailable structured log observed",
            "conditionMatchedLog": {
                "filter": (
                    'resource.type="cloud_run_revision" '
                    f'AND resource.labels.location="{region}" '
                    f'AND resource.labels.service_name="{gateway_service}" '
                    'AND (textPayload:"alert_trigger=PROVIDER_UPSTREAM_UNAVAILABLE" '
                    'OR jsonPayload.alert_trigger="PROVIDER_UPSTREAM_UNAVAILABLE")'
                )
            },
        },
        "\n".join([
            "Business scenario: Gateway has no healthy provider upstream for a requested service.",
            "Impact: Marketplace can be up while invoke/discovery paths fail for one or more providers.",
            "Trigger: Gateway emitted alert_trigger=PROVIDER_UPSTREAM_UNAVAILABLE.",
            "Action: Check provider runtime health, service health snapshots, force-probe output, and provider deploy.",
            f"Runbook: {runbook}",
            "[NO_ACTION_REQUIRED] only when generated by an explicit staging drill.",
        ]),
        {"alertname": "synapse_staging_provider_upstream_unavailable", "severity": "p2"},
        {"autoClose": "1800s", "notificationRateLimit": {"period": "300s"}},
    ),
    "chain-rpc-unavailable.json": policy(
        "Synapse Staging Chain RPC Unavailable",
        {
            "displayName": "Chain RPC unavailable structured log observed",
            "conditionMatchedLog": {
                "filter": (
                    'resource.type="cloud_run_revision" '
                    f'AND resource.labels.location="{region}" '
                    f'AND resource.labels.service_name="{gateway_service}" '
                    'AND (textPayload:"alert_trigger=CHAIN_RPC_UNAVAILABLE" '
                    'OR jsonPayload.alert_trigger="CHAIN_RPC_UNAVAILABLE")'
                )
            },
        },
        "\n".join([
            "Business scenario: Gateway cannot reach Arbitrum Sepolia RPC for signing/indexing/withdrawal state.",
            "Impact: Withdraw tickets, chain state checks, or deposit indexing may stall.",
            "Trigger: Gateway emitted alert_trigger=CHAIN_RPC_UNAVAILABLE.",
            "Action: Check Alchemy/Infura/QuickNode status, secret value, chainId 421614, and fallback RPC plan.",
            f"Runbook: {runbook}",
            "[NO_ACTION_REQUIRED] only when generated by an explicit staging drill.",
        ]),
        {"alertname": "synapse_staging_chain_rpc_unavailable", "severity": "p1"},
        {"autoClose": "1800s", "notificationRateLimit": {"period": "300s"}},
    ),
}

for job in scheduled_jobs:
    write[f"{job['job']}-freshness.json"] = cloud_run_job_freshness_policy(job)

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
    local response_file="$tmp_dir/policy-response.json"
    if ! curl -sS --fail-with-body \
      -H "Authorization: Bearer $access_token" \
      -H "Content-Type: application/json" \
      --data-binary "@$file_path" \
      "https://monitoring.googleapis.com/v3/projects/$PROJECT_ID/alertPolicies" \
      -o "$response_file"; then
      echo "failed to create policy: $display_name" >&2
      cat "$response_file" >&2 || true
      exit 1
    fi
  else
    echo "[gcp-alerts] updating policy: $display_name ($existing)"
    local response_file="$tmp_dir/policy-response.json"
    if ! curl -sS --fail-with-body -X PATCH \
      -H "Authorization: Bearer $access_token" \
      -H "Content-Type: application/json" \
      --data-binary "@$file_path" \
      "https://monitoring.googleapis.com/v3/$existing?updateMask=display_name,conditions,combiner,enabled,notification_channels,documentation,alert_strategy,user_labels" \
      -o "$response_file"; then
      echo "failed to update policy: $display_name ($existing)" >&2
      cat "$response_file" >&2 || true
      exit 1
    fi
  fi
}

delete_policy_if_exists() {
  local display_name="$1"
  local existing
  existing="$(
    gcloud alpha monitoring policies list \
      --project "$PROJECT_ID" \
      --filter="displayName=\"$display_name\"" \
      --format="value(name)" | head -n 1
  )"
  if [[ -z "$existing" ]]; then
    return 0
  fi
  echo "[gcp-alerts] deleting superseded policy: $display_name ($existing)"
  gcloud alpha monitoring policies delete "$existing" \
    --project "$PROJECT_ID" \
    --quiet >/dev/null
}

upsert_policy "Synapse Staging Gateway 5xx Rate High" "$tmp_dir/gateway-5xx.json"
upsert_policy "Synapse Staging Gateway 5xx Count High" "$tmp_dir/gateway-5xx-count.json"
upsert_policy "Synapse Staging Gateway-admin 5xx Rate High" "$tmp_dir/gateway-admin-5xx.json"
upsert_policy "Synapse Staging Cloud Run Job Failed" "$tmp_dir/cloud-run-job-failed.json"
delete_policy_if_exists "Synapse Staging Gateway Maintenance Batch Freshness"
delete_policy_if_exists "Synapse Staging Consumer Withdraw Processor Freshness"
delete_policy_if_exists "Synapse Staging Provider Withdraw Reaper Freshness"
upsert_policy "Synapse Staging Deposit Indexer Freshness" "$tmp_dir/synapse-staging-deposit-indexer-freshness.json"
upsert_policy "Synapse Staging Consumer Withdraw Chain Recovery Freshness" "$tmp_dir/synapse-staging-consumer-withdraw-chain-recovery-freshness.json"
upsert_policy "Synapse Staging Withdrawal Expiry Sweeper Freshness" "$tmp_dir/synapse-staging-withdrawal-expiry-sweeper-freshness.json"
upsert_policy "Synapse Staging Notification Outbox Drain Freshness" "$tmp_dir/synapse-staging-notification-outbox-drain-freshness.json"
upsert_policy "Synapse Staging Gateway Health Uptime Down" "$tmp_dir/gateway-uptime-health.json"
upsert_policy "Synapse Staging Gateway Readiness Uptime Down" "$tmp_dir/gateway-uptime-readiness.json"
upsert_policy "Synapse Staging User Front Uptime Down" "$tmp_dir/user-front-uptime.json"
upsert_policy "Synapse Staging Admin API Health Uptime Down" "$tmp_dir/admin-api-uptime-health.json"
upsert_policy "Synapse Staging Withdrawal Timeout" "$tmp_dir/withdrawal-timeout.json"
upsert_policy "Synapse Staging Reconciliation Drift" "$tmp_dir/reconciliation-drift.json"
upsert_policy "Synapse Staging Provider Upstream Unavailable" "$tmp_dir/provider-upstream-unavailable.json"
upsert_policy "Synapse Staging Chain RPC Unavailable" "$tmp_dir/chain-rpc-unavailable.json"

echo "[gcp-alerts] ready"
echo "Notification channel: $channel_name"
echo "Policies:"
gcloud alpha monitoring policies list \
  --project "$PROJECT_ID" \
  --filter='displayName:"Synapse Staging"' \
  --format="table(displayName,name,enabled)"
echo "Uptime checks:"
gcloud monitoring uptime list-configs \
  --project "$PROJECT_ID" \
  --filter='displayName:"Synapse Staging"' \
  --format="table(displayName,name,monitoredResource.labels.host,httpCheck.path,period)"
echo "Scheduled jobs:"
gcloud scheduler jobs list \
  --project "$PROJECT_ID" \
  --location "$REGION" \
  --filter='name:synapse-staging-' \
  --format="table(name.basename(),schedule,timeZone,state,httpTarget.uri)"
