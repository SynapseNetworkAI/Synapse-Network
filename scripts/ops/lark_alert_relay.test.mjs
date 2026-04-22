import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLarkMessage,
  getEndpointConfig,
  redactSensitive,
  signLarkRequest,
  truncateExcerpt,
} from "./lark_alert_relay.mjs";

function alertPayload({
  count = 1,
  status = "firing",
  severity = "p1",
  system = "gateway",
  env = "prod",
  message = "Gateway 5xx",
  businessScenario,
  impact,
  trigger,
  action,
} = {}) {
  const alerts = Array.from({ length: count }, (_, index) => ({
    status,
    labels: {
      alertname: `SynapseGateway5xxRateHigh-${index}`,
      severity,
      system,
      env,
    },
    annotations: {
      summary: index === 0 ? message : `Folded alert ${index}`,
      business_scenario: businessScenario,
      impact,
      trigger,
      action,
      runbook: "docs/ops/13_Production_Monitoring_Alerting_and_Backup_Restore.md",
      dashboard: "https://grafana.example.test/d/synapse",
    },
    fingerprint: `fp-${index}`,
    startsAt: "2026-04-22T00:00:00Z",
    endsAt: status === "resolved" ? "2026-04-22T00:05:00Z" : "0001-01-01T00:00:00Z",
    generatorURL: "https://prometheus.example.test/graph",
  }));

  return {
    status,
    groupKey: "{}:{alertname=\"SynapseGateway5xxRateHigh\"}",
    commonLabels: { severity, system, env, alertname: "SynapseGateway5xxRateHigh" },
    commonAnnotations: { summary: message },
    alerts,
  };
}

function cardText(message) {
  return JSON.stringify(message);
}

test("truncates excerpts by line count and character count", () => {
  const longLine = "x".repeat(10_000);
  const result = truncateExcerpt(["a", "b", "c", "d", "e", longLine].join("\n"));
  assert.ok(result.length <= 1000);
  assert.ok(result.endsWith("... [Truncated]"));
  assert.equal(result.includes("a\n"), false);
});

test("redacts obvious sensitive values and shortens wallet addresses", () => {
  const input = [
    "authorization: Bearer should-not-leak",
    "token=abc123",
    "signature=0x" + "a".repeat(130),
    "wallet=0x" + "b".repeat(40),
  ].join("\n");
  const result = redactSensitive(input);
  assert.match(result, /authorization=\[REDACTED\]/);
  assert.match(result, /token=\[REDACTED\]/);
  assert.match(result, /signature=\[REDACTED\]/);
  assert.match(result, /0xbbbb\.\.\.bbbb/);
  assert.doesNotMatch(result, /abc123/);
  assert.doesNotMatch(result, /should-not-leak/);
});

test("renders firing cards with fault title", () => {
  const { message } = buildLarkMessage(alertPayload({ severity: "p0", system: "finance" }));
  const text = cardText(message);
  assert.match(text, /🚨 故障/);
  assert.match(text, /Action/);
  assert.equal(message.card.header.template, "red");
});

test("renders resolved cards with recovery title and green template", () => {
  const { message } = buildLarkMessage(alertPayload({ status: "resolved" }));
  const text = cardText(message);
  assert.match(text, /✅ 恢复/);
  assert.equal(message.card.header.template, "green");
});

test("folds Alertmanager batches instead of expanding every alert", () => {
  const { message, normalized } = buildLarkMessage(alertPayload({ count: 100 }));
  const text = cardText(message);
  assert.equal(normalized.alertCount, 100);
  assert.equal(normalized.foldedCount, 99);
  assert.match(text, /另外 99 条同组告警已折叠/);
  assert.match(text, /SynapseGateway5xxRateHigh-0/);
  assert.doesNotMatch(text, /Folded alert 99/);
});

test("renders business context annotations when present", () => {
  const { message } = buildLarkMessage(alertPayload({
    businessScenario: "Gateway invoke 核心链路失败率升高",
    impact: "Consumer agent 可能无法完成 quote/invoke",
    trigger: "5 分钟窗口内 gateway 5xx 超过阈值",
    action: "检查 provider health 和 DB pool",
  }));
  const text = cardText(message);
  assert.match(text, /Business scenario/);
  assert.match(text, /Gateway invoke 核心链路失败率升高/);
  assert.match(text, /Impact/);
  assert.match(text, /Consumer agent 可能无法完成 quote\/invoke/);
  assert.match(text, /Trigger/);
  assert.match(text, /5 分钟窗口内 gateway 5xx 超过阈值/);
  assert.match(text, /Action/);
  assert.match(text, /检查 provider health 和 DB pool/);
});

test("omits empty business context placeholders", () => {
  const { message } = buildLarkMessage(alertPayload());
  const text = cardText(message);
  assert.doesNotMatch(text, /Business scenario.*not configured/);
  assert.doesNotMatch(text, /Impact.*not configured/);
  assert.doesNotMatch(text, /Trigger.*not configured/);
});

test("compact mode keeps essential fields under the configured byte cap", () => {
  const payload = alertPayload({ count: 100, message: "x".repeat(20_000) });
  const { message, compact } = buildLarkMessage(payload, { maxCardBytes: 900 });
  const text = cardText(message);
  assert.equal(compact, true);
  assert.ok(Buffer.byteLength(text, "utf8") < 900);
  assert.match(text, /Runbook/);
  assert.match(text, /Fingerprint/);
});

test("endpoint config determines destination without inspecting alert labels", () => {
  const env = {
    LARK_WEBHOOK_PROD_ALERTS: "https://relay.example.test/prod",
    LARK_SECRET_PROD_ALERTS: "secret",
  };
  const config = getEndpointConfig("/lark/prod-alerts", env);
  assert.equal(config.name, "prod-alerts");
  assert.equal(config.webhook, "https://relay.example.test/prod");
});

test("computes deterministic Lark signing payload", () => {
  assert.equal(signLarkRequest("secret", 123456), signLarkRequest("secret", 123456));
  assert.notEqual(signLarkRequest("secret", 123456), signLarkRequest("secret-2", 123456));
});
