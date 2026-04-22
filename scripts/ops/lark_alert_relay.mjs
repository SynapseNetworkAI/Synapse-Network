#!/usr/bin/env node
import crypto from "node:crypto";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

export const MAX_EXCERPT_LINES = 5;
export const MAX_EXCERPT_CHARS = 1000;
export const MAX_CARD_BYTES = 24 * 1024;
export const DEFAULT_RETRIES = 2;

export const ENDPOINTS = Object.freeze({
  "/lark/p0-war-room": {
    name: "p0-war-room",
    webhookEnv: "LARK_WEBHOOK_P0_WAR_ROOM",
    secretEnv: "LARK_SECRET_P0_WAR_ROOM",
  },
  "/lark/prod-alerts": {
    name: "prod-alerts",
    webhookEnv: "LARK_WEBHOOK_PROD_ALERTS",
    secretEnv: "LARK_SECRET_PROD_ALERTS",
  },
  "/lark/staging-drill": {
    name: "staging-drill",
    webhookEnv: "LARK_WEBHOOK_STAGING_DRILL",
    secretEnv: "LARK_SECRET_STAGING_DRILL",
  },
});

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function utf8Bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function truncateExcerpt(raw, maxLines = MAX_EXCERPT_LINES, maxChars = MAX_EXCERPT_CHARS) {
  const text = String(raw ?? "");
  const lineBounded = text.split(/\r?\n/).slice(-maxLines).join("\n");
  if (lineBounded.length <= maxChars) return lineBounded;
  return `${lineBounded.slice(0, Math.max(0, maxChars - 15))}... [Truncated]`;
}

export function redactSensitive(raw) {
  let text = String(raw ?? "");
  text = text.replace(/authorization\s*:\s*bearer\s+[^\r\n,]+/gi, "authorization=[REDACTED]");
  text = text.replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "bearer [REDACTED]");
  text = text.replace(/(authorization|bearer|token|secret|password|private[_-]?key|signature|cookie)\s*[:=]\s*[^,\s\\]+/gi, "$1=[REDACTED]");
  text = text.replace(/\b0x[a-fA-F0-9]{64,}\b/g, "[REDACTED_HEX]");
  text = text.replace(/\b0x([a-fA-F0-9]{4})[a-fA-F0-9]{32}([a-fA-F0-9]{4})\b/g, "0x$1...$2");
  return text;
}

function safeText(raw, maxChars = 1000) {
  return truncateExcerpt(redactSensitive(raw), MAX_EXCERPT_LINES, maxChars);
}

function labelValue(labels, key, fallback = "unknown") {
  const value = labels[key] ?? fallback;
  return safeText(value, 120) || fallback;
}

function summarizeLabels(labels) {
  return Object.entries(asObject(labels))
    .slice(0, 10)
    .map(([key, value]) => `${safeText(key, 60)}=${safeText(value, 120)}`)
    .join(", ");
}

export function normalizeAlertmanagerPayload(payload) {
  const source = asObject(payload);
  const alerts = Array.isArray(source.alerts) ? source.alerts : [];
  const primaryAlert = asObject(alerts[0]);
  const commonLabels = asObject(source.commonLabels);
  const commonAnnotations = asObject(source.commonAnnotations);
  const labels = { ...commonLabels, ...asObject(primaryAlert.labels) };
  const annotations = { ...commonAnnotations, ...asObject(primaryAlert.annotations) };
  const status = String(source.status || primaryAlert.status || "firing").toLowerCase();
  const alertCount = alerts.length || 1;

  return {
    status,
    alertCount,
    foldedCount: Math.max(0, alertCount - 1),
    groupKey: safeText(source.groupKey || "", 180),
    receiver: safeText(source.receiver || "", 120),
    externalURL: safeText(source.externalURL || "", 300),
    labels,
    annotations,
    primaryFingerprint: safeText(primaryAlert.fingerprint || source.groupKey || "", 180),
    startsAt: safeText(primaryAlert.startsAt || "", 80),
    endsAt: safeText(primaryAlert.endsAt || "", 80),
    generatorURL: safeText(primaryAlert.generatorURL || "", 300),
  };
}

function statusPrefix(status) {
  return status === "resolved" ? "✅ 恢复" : "🚨 故障";
}

function headerTemplate(status, severity) {
  if (status === "resolved") return "green";
  return severity === "p0" ? "red" : "orange";
}

function buildContent(normalized, { compact = false } = {}) {
  const { status, labels, annotations, foldedCount } = normalized;
  const severity = labelValue(labels, "severity");
  const system = labelValue(labels, "system");
  const env = labelValue(labels, "env");
  const alertname = labelValue(labels, "alertname", "alert");
  const summary = safeText(annotations.summary || annotations.description || "No summary provided.", compact ? 380 : 700);
  const businessScenario = safeText(annotations.business_scenario || annotations.businessScenario || "", compact ? 220 : 420);
  const impact = safeText(annotations.impact || "", compact ? 220 : 420);
  const trigger = safeText(annotations.trigger || "", compact ? 220 : 420);
  const action = safeText(annotations.action || "", compact ? 260 : 520);
  const rawExcerpt = annotations.error_excerpt || annotations.error || annotations.message || annotations.description || "";
  const excerpt = safeText(rawExcerpt, compact ? 300 : MAX_EXCERPT_CHARS);
  const runbook = safeText(annotations.runbook || "not configured", 300);
  const dashboard = safeText(annotations.dashboard || annotations.grafana || normalized.generatorURL || normalized.externalURL || "not configured", 300);
  const labelsSummary = summarizeLabels(labels);

  const lines = [
    `**Alert**: ${alertname}`,
    `**Status**: ${status}`,
    `**Severity/System/Env**: ${severity} / ${system} / ${env}`,
    `**Summary**: ${summary}`,
  ];

  if (businessScenario) {
    lines.push(`**Business scenario**: ${businessScenario}`);
  }

  if (impact) {
    lines.push(`**Impact**: ${impact}`);
  }

  if (trigger) {
    lines.push(`**Trigger**: ${trigger}`);
  }

  if (action) {
    lines.push(`**Action**: ${action}`);
  } else if (severity === "p0" && status !== "resolved") {
    lines.push("**Action**: 先冻结高危操作，再查账务一致性。");
  }

  if (!compact && excerpt) {
    lines.push(`**Error excerpt**:\n${excerpt}`);
  }

  if (foldedCount > 0) {
    lines.push(`**Folded**: 另外 ${foldedCount} 条同组告警已折叠，请打开 Alertmanager/Grafana 查看完整列表。`);
  }

  lines.push(
    `**Alert count**: ${normalized.alertCount}`,
    `**Fingerprint**: ${normalized.primaryFingerprint || "n/a"}`,
    `**Runbook**: ${runbook}`,
    `**Dashboard**: ${dashboard}`,
  );

  if (!compact && labelsSummary) {
    lines.push(`**Common labels**: ${labelsSummary}`);
  }

  if (normalized.groupKey) {
    lines.push(`**Group key**: ${normalized.groupKey}`);
  }

  return lines.join("\n\n");
}

function buildCard(normalized, { compact = false } = {}) {
  const severity = labelValue(normalized.labels, "severity");
  const system = labelValue(normalized.labels, "system");
  const env = labelValue(normalized.labels, "env");
  const alertname = labelValue(normalized.labels, "alertname", "alert");
  const title = `[${statusPrefix(normalized.status)}][${severity.toUpperCase()}][${system}][${env}] ${alertname}`;

  return {
    config: { wide_screen_mode: true },
    header: {
      template: headerTemplate(normalized.status, severity),
      title: {
        tag: "plain_text",
        content: title,
      },
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: buildContent(normalized, { compact }),
        },
      },
    ],
  };
}

export function buildLarkMessage(payload, options = {}) {
  const maxCardBytes = options.maxCardBytes ?? MAX_CARD_BYTES;
  const normalized = normalizeAlertmanagerPayload(payload);
  let compact = false;
  let message = { msg_type: "interactive", card: buildCard(normalized, { compact }) };

  if (utf8Bytes(message) > maxCardBytes) {
    compact = true;
    message = { msg_type: "interactive", card: buildCard(normalized, { compact }) };
  }

  if (utf8Bytes(message) > maxCardBytes) {
    const labels = normalized.labels;
    const alertname = labelValue(labels, "alertname", "alert");
    const severity = labelValue(labels, "severity");
    const system = labelValue(labels, "system");
    const env = labelValue(labels, "env");
    const title = `[${statusPrefix(normalized.status)}][${severity.toUpperCase()}][${system}][${env}] ${alertname}`;
    message = {
      msg_type: "interactive",
      card: {
        config: { wide_screen_mode: true },
        header: {
          template: headerTemplate(normalized.status, severity),
          title: { tag: "plain_text", content: title },
        },
        elements: [
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: [
                `**Alert count**: ${normalized.alertCount}`,
                `**Folded**: 另外 ${normalized.foldedCount} 条同组告警已折叠。`,
                `**Runbook**: ${safeText(normalized.annotations.runbook || "not configured", 300)}`,
                `**Fingerprint**: ${normalized.primaryFingerprint || "n/a"}`,
              ].join("\n\n"),
            },
          },
        ],
      },
    };
  }

  return { message, normalized, compact };
}

export function signLarkRequest(secret, timestamp = Math.floor(Date.now() / 1000)) {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto.createHmac("sha256", stringToSign).update("").digest("base64");
}

export function getEndpointConfig(endpointPath, env = process.env) {
  const endpoint = ENDPOINTS[endpointPath];
  if (!endpoint) {
    throw new Error(`unknown_lark_endpoint:${endpointPath}`);
  }
  const webhook = env[endpoint.webhookEnv] || "";
  const secret = env[endpoint.secretEnv] || "";
  if (!webhook) {
    throw new Error(`missing_lark_webhook:${endpoint.webhookEnv}`);
  }
  return { ...endpoint, webhook, secret };
}

export async function sendLarkAlert(endpointPath, payload, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const retries = Number(options.retries ?? env.LARK_ALERT_RELAY_MAX_RETRIES ?? DEFAULT_RETRIES);
  const endpoint = getEndpointConfig(endpointPath, env);
  const timestamp = Math.floor(Date.now() / 1000);
  const built = buildLarkMessage(payload);
  const body = endpoint.secret
    ? { timestamp: String(timestamp), sign: signLarkRequest(endpoint.secret, timestamp), ...built.message }
    : built.message;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint.webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) return { ok: true, compact: built.compact, status: response.status };
      lastError = new Error(`lark_webhook_http_${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) await sleep(250 * (attempt + 1));
  }

  throw lastError;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

export function createServer(options = {}) {
  return http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (request.method !== "POST" || !ENDPOINTS[request.url || ""]) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    try {
      const body = await readRequestBody(request);
      const payload = JSON.parse(body || "{}");
      const result = await sendLarkAlert(request.url || "", payload, options);
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "lark_alert_failed", detail: String(error?.message || error) }));
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.LARK_ALERT_RELAY_PORT || 8787);
  const host = process.env.LARK_ALERT_RELAY_HOST || "0.0.0.0";
  createServer().listen(port, host, () => {
    console.log(`lark-alert-relay listening on ${host}:${port}`);
  });
}
