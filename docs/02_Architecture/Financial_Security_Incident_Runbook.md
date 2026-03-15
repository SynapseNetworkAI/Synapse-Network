# Financial Security Incident Runbook

## 1. Purpose

This runbook defines incident response for financial API abuse, replay attacks, idempotency conflicts, and abnormal refund behavior.

## 2. Alert Rules (Baseline)

Trigger high-priority alert when any rule matches:

1. `FINANCE_RATE_LIMIT_HIT` exceeds 20 events in 5 minutes for same owner/action.
2. `DEPOSIT_REPLAY_DETECTED` exceeds 5 events in 10 minutes.
3. `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` exceeds 3 events in 10 minutes.
4. Refund intent creation spikes > 3x baseline in 15 minutes.

5. Redis idempotency claim conflict spikes (same key collisions) exceed baseline by 2x in 10 minutes.

## 3. Triage Checklist

1. Identify affected owner(s), endpoint(s), and action types from `GET /api/v1/finance/audit-logs` and system activity log exports.
2. Confirm whether traffic comes from single source IP/User-Agent or distributed sources.
3. Verify if anomaly is caused by client retry bug vs malicious replay pattern.
4. Check Redis health and latency when distributed controls are enabled.
5. Correlate `request_id/trace_id` across `synapse_audit_log` and `synapse_system_activity_log`.

## 4. Immediate Containment

1. Temporarily reduce `FINANCE_WRITE_RATE_LIMIT_PER_MIN` for environment.
2. If abuse persists, block offending API keys/session tokens at auth gateway.
3. For repeated replay/mismatch from same source, add temporary WAF/IP block.
4. If Redis unavailable, switch to degraded mode and increase backend monitoring frequency.

## 5. Investigation and Recovery

1. Export related audit logs and usage logs for impacted time window.
2. Verify ledger consistency for impacted owners.
3. Reconcile partial refund/deposit intents and mark final states.
4. Publish incident summary with root cause and permanent fix.

## 6. Post-Incident Actions

1. Add/adjust regression tests for exact failure mode.
2. Add monitoring dashboard panel and SLO error budget tracking.
3. Review whether thresholds in this runbook need tighter values.
4. Verify Lua-script fallback behavior during Redis degraded mode tests.
5. Verify domain routing correctness:
	- finance actions must land in `synapse_audit_log`
	- credential/service/session actions must land in `synapse_system_activity_log`

## 7. Ownership

1. Primary owner: Backend platform on-call.
2. Secondary owner: Security engineering.
3. Communication channel: incident bridge + engineering status page.
