#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const GENERATED_AT = new Date();
const RUN_ID = process.env.GMAIL_STAGING_E2E_RUN_ID || `gmail-staging-${Date.now().toString(36)}`;
const OUT_DIR = path.resolve(
  process.env.GMAIL_STAGING_E2E_EVIDENCE_DIR ||
    path.join(ROOT, "docs/evidence/staging/gmail", `${formatTimestamp(GENERATED_AT)}-gmail-staging-e2e`),
);

const CONFIRM = "I_UNDERSTAND_THIS_SENDS_STAGING_EMAIL";
const projectId = process.env.PROJECT_ID || process.env.GCP_PROJECT || "";
const region = process.env.REGION || "us-central1";
const jobName = process.env.GMAIL_STAGING_OUTBOX_JOB || "synapse-staging-notification-outbox-drain";
const recipientEmail = process.env.GMAIL_STAGING_E2E_RECIPIENT || process.env.GMAIL_SMTP_USERNAME || "";
const postgresDsn = process.env.STAGING_GMAIL_POSTGRES_DSN || process.env.POSTGRES_DSN || "";

fs.mkdirSync(OUT_DIR, { recursive: true });

function formatTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function redact(value) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[REDACTED]@")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/0x[a-fA-F0-9]{64,}/g, "0x[REDACTED]")
    .replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*[^,\s"']+/gi, "$1=[REDACTED]");
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function psql(sql) {
  return run("psql", [postgresDsn, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

function writeEvidence(report) {
  const reportPath = path.join(OUT_DIR, "report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      "# Gmail Staging Notification E2E Evidence",
      "",
      `- Status: \`${report.status}\``,
      `- Run ID: \`${report.runId}\``,
      `- Generated at: \`${report.generatedAt}\``,
      `- Recipient: \`${report.recipientEmailHash}\``,
      "",
      "## Steps",
      "",
      "| Step | Result | Detail |",
      "| --- | --- | --- |",
      ...report.steps.map((step) => `| ${step.name} | ${step.ok ? "PASS" : "FAIL"} | ${String(step.detail || step.error || "").replace(/\|/g, "\\|")} |`),
    ].join("\n") + "\n",
  );
}

function addStep(steps, name, ok, detail = "", error = "") {
  steps.push({ name, ok: Boolean(ok), detail: redact(detail), error: redact(error) });
}

async function main() {
  const steps = [];
  const notificationId = `${RUN_ID}-email`;
  const dedupeKey = `${RUN_ID}:deposit-confirmed`;
  const recipientEmailHash = crypto.createHash("sha256").update(recipientEmail || "missing").digest("hex");

  if (process.env.GMAIL_STAGING_E2E_CONFIRM !== CONFIRM) {
    addStep(steps, "confirmation", false, "", `GMAIL_STAGING_E2E_CONFIRM must equal ${CONFIRM}`);
  } else {
    addStep(steps, "confirmation", true, "operator confirmed staging email send");
  }
  if (!postgresDsn) addStep(steps, "postgres_dsn", false, "", "POSTGRES_DSN or STAGING_GMAIL_POSTGRES_DSN is required");
  else addStep(steps, "postgres_dsn", true, "configured");
  if (!recipientEmail) addStep(steps, "recipient_email", false, "", "GMAIL_STAGING_E2E_RECIPIENT or GMAIL_SMTP_USERNAME is required");
  else addStep(steps, "recipient_email", true, `sha256=${recipientEmailHash}`);

  if (!steps.some((step) => !step.ok)) {
    try {
      const payload = JSON.stringify({
        amount: "1.00 USDC",
        currency: "USDC",
        status: "confirmed",
        depositId: RUN_ID,
        txHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        actionUrl: "https://staging.synapse-network.ai/dashboard",
      }).replace(/'/g, "''");
      psql(`
        INSERT INTO synapse_notification_outbox (
          notification_id, dedupe_key, event_type, recipient_email, recipient_owner_id,
          priority, template_key, template_version, payload, status, next_attempt_at
        )
        VALUES (
          '${notificationId}', '${dedupeKey}', 'deposit.confirmed', '${recipientEmail.replace(/'/g, "''")}',
          'staging-e2e-owner', 'transactional', 'deposit_confirmed', 'v1',
          '${payload}'::jsonb, 'pending', NOW()
        )
        ON CONFLICT (dedupe_key) DO NOTHING;
      `);
      addStep(steps, "enqueue_outbox", true, `notificationId=${notificationId}`);
    } catch (error) {
      addStep(steps, "enqueue_outbox", false, "", error.stderr || error.message);
    }
  }

  if (!steps.some((step) => !step.ok)) {
    try {
      if (process.env.GMAIL_STAGING_SKIP_JOB === "1") {
        addStep(steps, "run_outbox_job", true, "skipped by GMAIL_STAGING_SKIP_JOB=1");
      } else {
        const args = ["run", "jobs", "execute", jobName, "--region", region, "--wait"];
        if (projectId) args.push("--project", projectId);
        const output = run("gcloud", args);
        addStep(steps, "run_outbox_job", true, output.slice(0, 800));
      }
    } catch (error) {
      addStep(steps, "run_outbox_job", false, "", error.stderr || error.message);
    }
  }

  if (!steps.some((step) => !step.ok)) {
    try {
      const result = psql(`
        SELECT COALESCE(
          (SELECT 'sent:' || notification_id FROM synapse_notification_delivery_log WHERE notification_id = '${notificationId}' LIMIT 1),
          (SELECT status || ':' || COALESCE(last_error, '') FROM synapse_notification_outbox WHERE notification_id = '${notificationId}' LIMIT 1),
          'missing'
        );
      `).trim();
      addStep(steps, "delivery_log", result.startsWith("sent:"), result);
    } catch (error) {
      addStep(steps, "delivery_log", false, "", error.stderr || error.message);
    }
  }

  const failed = steps.filter((step) => !step.ok);
  const report = {
    status: failed.length === 0 ? "success" : "failed",
    scriptVersion: "gmail-staging-e2e:v1",
    runId: RUN_ID,
    generatedAt: GENERATED_AT.toISOString(),
    finishedAt: new Date().toISOString(),
    environment: "staging",
    jobName,
    recipientEmailHash,
    notificationId,
    steps,
    failed,
  };
  writeEvidence(report);
  console.log(`[gmail-staging-e2e] evidence=${OUT_DIR}`);
  console.log(`[gmail-staging-e2e] status=${report.status} failed=${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  const report = {
    status: "failed",
    scriptVersion: "gmail-staging-e2e:v1",
    runId: RUN_ID,
    generatedAt: GENERATED_AT.toISOString(),
    finishedAt: new Date().toISOString(),
    environment: "staging",
    jobName,
    recipientEmailHash: "",
    notificationId: "",
    steps: [{ name: "runner", ok: false, error: redact(error.stack || error.message) }],
    failed: [{ name: "runner", ok: false, error: redact(error.stack || error.message) }],
  };
  writeEvidence(report);
  console.error(`[gmail-staging-e2e] failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
