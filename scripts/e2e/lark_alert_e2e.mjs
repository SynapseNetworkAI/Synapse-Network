#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLarkMessage,
  ENDPOINTS,
  getEndpointConfig,
  redactSensitive,
  sendLarkAlert,
  truncateExcerpt,
} from "../ops/lark_alert_relay.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_ROOT = path.join(ROOT, "docs/evidence/alerts/lark");
const RUN_ID = process.env.LARK_ALERT_E2E_RUN_ID || `lark-e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const GENERATED_AT = new Date();
const OUTPUT_DIR = path.join(EVIDENCE_ROOT, `${formatTimestamp(GENERATED_AT)}-lark-e2e`);
const REQUIRED_WEBHOOKS = [
  "LARK_WEBHOOK_P0_WAR_ROOM",
  "LARK_WEBHOOK_PROD_ALERTS",
  "LARK_WEBHOOK_STAGING_DRILL",
];

function formatTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function writeJson(fileName, value) {
  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

function safeResponseText(raw) {
  return truncateExcerpt(redactSensitive(raw || ""), 5, 800);
}

function alertPayload({
  scenario,
  endpoint,
  status = "firing",
  severity = "p1",
  system = "gateway",
  env = "prod",
  alertCount = 1,
  message = "Lark E2E probe",
  businessScenario,
  impact,
  trigger,
  action,
  includeSensitiveProbe = false,
}) {
  const startsAt = new Date().toISOString();
  const endsAt = status === "resolved" ? new Date().toISOString() : "0001-01-01T00:00:00Z";
  const alerts = Array.from({ length: alertCount }, (_, index) => ({
    status,
    labels: {
      alertname: scenario,
      severity,
      system,
      env,
      runId: RUN_ID,
      is_drill: "true",
      lark_e2e: "true",
    },
    annotations: {
      summary: `[LARK_E2E_TEST][NO_ACTION_REQUIRED] ${message} (${status}) runId=${RUN_ID}`,
      description: `[LARK_E2E_TEST][NO_ACTION_REQUIRED] This is a real Lark webhook delivery probe for ${endpoint}. No production action is required.`,
      business_scenario: businessScenario,
      impact,
      trigger,
      action,
      error_excerpt: includeSensitiveProbe
        ? [
            "line 1",
            "line 2",
            "authorization: Bearer should-not-leak",
            `signature=0x${"a".repeat(130)}`,
            "single-line-stack=" + "x".repeat(12_000),
          ].join("\n")
        : `LARK_E2E_TEST ${scenario} ${status}`,
      runbook: "docs/ops/13_Production_Monitoring_Alerting_and_Backup_Restore.md",
      dashboard: "https://grafana.example.invalid/d/synapse-lark-e2e",
    },
    fingerprint: `${RUN_ID}-${scenario}-${status}-${index}`,
    startsAt,
    endsAt,
    generatorURL: "https://prometheus.example.invalid/graph?g0.expr=lark_e2e",
  }));

  return {
    receiver: ENDPOINTS[endpoint]?.name || endpoint,
    status,
    groupKey: `{}/{alertname="${scenario}",runId="${RUN_ID}"}`,
    externalURL: "https://alertmanager.example.invalid/#/alerts",
    commonLabels: {
      alertname: scenario,
      severity,
      system,
      env,
      runId: RUN_ID,
      is_drill: "true",
      lark_e2e: "true",
    },
    commonAnnotations: {
      summary: `[LARK_E2E_TEST][NO_ACTION_REQUIRED] ${message} (${status}) runId=${RUN_ID}`,
      business_scenario: businessScenario,
      impact,
      trigger,
      action,
    },
    alerts,
  };
}

function scenarios() {
  return [
    {
      name: "p0-firing",
      endpoint: "/lark/p0-war-room",
      payload: alertPayload({
        scenario: "SynapseLarkE2EP0LedgerDelta",
        endpoint: "/lark/p0-war-room",
        status: "firing",
        severity: "p0",
        system: "finance",
        env: "prod",
        message: "P0 delivery probe only; do not freeze real operations",
        businessScenario: "Ledger/Vault 对账出现非零 delta",
        impact: "可能存在资金账实不一致；这是 E2E 测试，不要冻结真实操作。",
        trigger: "ledger/vault unexplained delta > 0",
        action: "真实事故时冻结高危资金操作，拉取 reconciliation report；本次 LARK_E2E_TEST 不需要生产动作。",
      }),
    },
    {
      name: "p0-resolved",
      endpoint: "/lark/p0-war-room",
      payload: alertPayload({
        scenario: "SynapseLarkE2EP0LedgerDelta",
        endpoint: "/lark/p0-war-room",
        status: "resolved",
        severity: "p0",
        system: "finance",
        env: "prod",
        message: "P0 recovery delivery probe only",
        businessScenario: "Ledger/Vault 对账恢复",
        impact: "资金对账告警已恢复到阈值内；这是 E2E 测试恢复消息。",
        trigger: "ledger/vault unexplained delta 回到 0.000000",
        action: "真实事故时确认 reconciliation report 和 incident closure；本次 LARK_E2E_TEST 不需要生产动作。",
      }),
    },
    {
      name: "prod-firing",
      endpoint: "/lark/prod-alerts",
      payload: alertPayload({
        scenario: "SynapseLarkE2EGatewayCorePath",
        endpoint: "/lark/prod-alerts",
        status: "firing",
        severity: "p1",
        system: "gateway",
        env: "prod",
        message: "Gateway invoke 核心链路失败率升高",
        businessScenario: "Gateway invoke 核心链路失败率升高",
        impact: "Consumer agent 可能无法完成 quote/invoke，Provider 收入事件可能延迟入账。",
        trigger: "5 分钟窗口内 gateway 5xx 或 invoke failure rate 超过阈值。",
        action: "先查看 Gateway error dashboard，再检查 provider health、DB pool、Kafka/ClickHouse lag。",
      }),
    },
    {
      name: "prod-resolved",
      endpoint: "/lark/prod-alerts",
      payload: alertPayload({
        scenario: "SynapseLarkE2EGatewayCorePath",
        endpoint: "/lark/prod-alerts",
        status: "resolved",
        severity: "p1",
        system: "gateway",
        env: "prod",
        message: "Gateway invoke 核心链路恢复",
        businessScenario: "Gateway invoke 核心链路恢复",
        impact: "Gateway invoke 核心链路已恢复到阈值内。",
        trigger: "5 分钟窗口内 gateway 5xx 和 invoke failure rate 回到阈值内。",
        action: "确认同一 runId 没有残留 firing 告警，检查是否需要关闭 incident。",
      }),
    },
    {
      name: "staging-firing",
      endpoint: "/lark/staging-drill",
      payload: alertPayload({
        scenario: "SynapseLarkE2EDrillAlert",
        endpoint: "/lark/staging-drill",
        status: "firing",
        severity: "drill",
        system: "drill",
        env: "staging",
        message: "Staging drill delivery probe",
        businessScenario: "Staging drill 告警路由验证",
        impact: "验证 drill 不会进入生产告警群；这是演练消息，不是生产故障。",
        trigger: "Lark Alert E2E runner 向 staging drill endpoint 发送 firing probe。",
        action: "确认消息只出现在 Staging 演练群，并检查卡片脱敏/截断是否正常。",
        includeSensitiveProbe: true,
      }),
    },
    {
      name: "staging-resolved",
      endpoint: "/lark/staging-drill",
      payload: alertPayload({
        scenario: "SynapseLarkE2EDrillAlert",
        endpoint: "/lark/staging-drill",
        status: "resolved",
        severity: "drill",
        system: "drill",
        env: "staging",
        message: "Staging drill recovery probe",
        businessScenario: "Staging drill 告警恢复验证",
        impact: "验证 resolved 绿色恢复卡片可达；这是演练消息。",
        trigger: "Lark Alert E2E runner 向 staging drill endpoint 发送 resolved probe。",
        action: "确认恢复消息只出现在 Staging 演练群。",
      }),
    },
    {
      name: "staging-batch-folding",
      endpoint: "/lark/staging-drill",
      payload: alertPayload({
        scenario: "SynapseLarkE2EBatchFolding",
        endpoint: "/lark/staging-drill",
        status: "firing",
        severity: "drill",
        system: "drill",
        env: "staging",
        alertCount: 100,
        message: "Grouped Alertmanager payload folding probe",
        businessScenario: "Alertmanager 同组告警折叠",
        impact: "验证 100 条同组告警不会撑爆 Lark 卡片，值班人员仍能看到首条和折叠数量。",
        trigger: "同一 groupKey 下收到 100 条告警 payload。",
        action: "确认卡片只展示首条详情，并显示另外 99 条已折叠。",
      }),
    },
  ];
}

function configuredManifest() {
  return {
    generatedAt: GENERATED_AT.toISOString(),
    runId: RUN_ID,
    environment: process.env.LARK_ALERT_E2E_ENV || "local",
    endpoints: Object.fromEntries(Object.entries(ENDPOINTS).map(([endpoint, config]) => [
      endpoint,
      {
        name: config.name,
        webhookEnv: config.webhookEnv,
        secretEnv: config.secretEnv,
        webhookConfigured: Boolean(process.env[config.webhookEnv]),
        secretConfigured: Boolean(process.env[config.secretEnv]),
      },
    ])),
  };
}

async function sendScenario(scenario) {
  let responseText = "";
  const fetchImpl = async (...args) => {
    const response = await globalThis.fetch(...args);
    try {
      responseText = await response.clone().text();
    } catch {
      responseText = "";
    }
    return response;
  };

  const preview = buildLarkMessage(scenario.payload);
  const result = await sendLarkAlert(scenario.endpoint, scenario.payload, {
    fetchImpl,
    retries: Number(process.env.LARK_ALERT_E2E_RETRIES || process.env.LARK_ALERT_RELAY_MAX_RETRIES || "1"),
  });

  return {
    name: scenario.name,
    endpoint: scenario.endpoint,
    status: preview.normalized.status,
    severity: preview.normalized.labels.severity,
    system: preview.normalized.labels.system,
    env: preview.normalized.labels.env,
    businessScenario: preview.normalized.annotations.business_scenario || preview.normalized.annotations.businessScenario || "",
    impact: preview.normalized.annotations.impact || "",
    trigger: preview.normalized.annotations.trigger || "",
    action: preview.normalized.annotations.action || "",
    alertCount: preview.normalized.alertCount,
    foldedCount: preview.normalized.foldedCount,
    compact: result.compact,
    httpStatus: result.status,
    ok: result.ok === true,
    larkResponseSummary: safeResponseText(responseText),
    expected: {
      hasLarkE2eMarker: true,
      hasNoActionMarker: true,
    },
    actual: {
      hasLarkE2eMarker: JSON.stringify(preview.message).includes("LARK_E2E_TEST"),
      hasNoActionMarker: JSON.stringify(preview.message).includes("NO_ACTION_REQUIRED"),
      containsSensitiveProbe: /should-not-leak|a{64,}|authorization: Bearer/i.test(JSON.stringify(preview.message)),
    },
  };
}

function validateEnvironment(failed) {
  for (const envName of REQUIRED_WEBHOOKS) {
    if (!process.env[envName]) {
      failed.push(`missing required webhook env ${envName}`);
    }
  }

  for (const endpoint of Object.keys(ENDPOINTS)) {
    try {
      getEndpointConfig(endpoint);
    } catch (error) {
      failed.push(error.message);
    }
  }
}

function writeReport({ startedAt, finishedAt, sentMessages, failed, manifest }) {
  const report = {
    status: failed.length === 0 ? "success" : "failed",
    generatedAt: finishedAt,
    startedAt,
    finishedAt,
    runId: RUN_ID,
    environment: manifest.environment,
    sentCount: sentMessages.length,
    failed,
    endpoints: manifest.endpoints,
    requiredScenarios: scenarios().map((scenario) => scenario.name),
    scenarios: sentMessages.map((message) => ({
      name: message.name,
      endpoint: message.endpoint,
      status: message.status,
      alertCount: message.alertCount,
      foldedCount: message.foldedCount,
      ok: message.ok,
      httpStatus: message.httpStatus,
    })),
  };

  const markdown = [
    "# Lark Alert E2E Evidence",
    "",
    `- Status: ${report.status}`,
    `- Run ID: ${RUN_ID}`,
    `- Started At: ${startedAt}`,
    `- Finished At: ${finishedAt}`,
    `- Sent Messages: ${sentMessages.length}`,
    "",
    "## Endpoint Configuration",
    "",
    "| Endpoint | Webhook Configured | Secret Configured |",
    "| --- | --- | --- |",
    ...Object.entries(manifest.endpoints).map(([endpoint, config]) =>
      `| ${endpoint} | ${config.webhookConfigured ? "yes" : "no"} | ${config.secretConfigured ? "yes" : "no"} |`,
    ),
    "",
    "## Message Results",
    "",
    "| Scenario | Endpoint | Status | Alerts | Folded | HTTP | Result |",
    "| --- | --- | --- | ---: | ---: | ---: | --- |",
    ...sentMessages.map((message) =>
      `| ${message.name} | ${message.endpoint} | ${message.status} | ${message.alertCount} | ${message.foldedCount} | ${message.httpStatus ?? "n/a"} | ${message.ok ? "pass" : "fail"} |`,
    ),
    "",
    "## Failures",
    "",
    failed.length ? failed.map((item) => `- ${item}`).join("\n") : "- none",
    "",
  ].join("\n");

  writeJson("environment-manifest.json", manifest);
  writeJson("sent-messages.json", sentMessages);
  writeJson("report.json", report);
  fs.writeFileSync(path.join(OUTPUT_DIR, "report.md"), markdown);
  return report;
}

async function main() {
  const startedAt = new Date().toISOString();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const failed = [];
  const sentMessages = [];
  const manifest = configuredManifest();
  validateEnvironment(failed);

  if (failed.length === 0) {
    for (const scenario of scenarios()) {
      try {
        const sent = await sendScenario(scenario);
        sentMessages.push(sent);
        if (!sent.ok) failed.push(`${scenario.name} did not return ok`);
        if (!sent.actual.hasLarkE2eMarker || !sent.actual.hasNoActionMarker) {
          failed.push(`${scenario.name} missing LARK_E2E_TEST or NO_ACTION_REQUIRED marker`);
        }
        if (sent.actual.containsSensitiveProbe) {
          failed.push(`${scenario.name} rendered sensitive probe content`);
        }
      } catch (error) {
        failed.push(`${scenario.name}: ${error.message}`);
        sentMessages.push({
          name: scenario.name,
          endpoint: scenario.endpoint,
          ok: false,
          error: truncateExcerpt(redactSensitive(error.stack || error.message), 5, 800),
        });
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const report = writeReport({ startedAt, finishedAt, sentMessages, failed, manifest });
  console.log(`[lark-alert-e2e] evidence: ${OUTPUT_DIR}`);
  console.log(`[lark-alert-e2e] status=${report.status} sent=${sentMessages.length} failed=${failed.length}`);
  if (failed.length > 0) process.exit(1);
}

await main();
