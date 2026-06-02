import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { ethers } from "ethers";

export function createHttpJsonHelpers({ traceRows, apiEvidence }) {
  async function getJson(name, url, options) {
    const startedAt = Date.now();
    const response = await fetch(url, { method: "GET", ...(options || {}) });
    const text = await response.text();
    const payload = parseJson(text);
    traceRows.push({
      name,
      method: "GET",
      url,
      status: response.status,
      durationMs: Date.now() - startedAt,
      response: payload,
    });
    apiEvidence[name] = { status: response.status, payload };
    if (!response.ok) {
      throw new Error(
        `${name} failed (${response.status}): ${text.slice(0, 500)}`
      );
    }
    return payload;
  }

  async function postJson(name, url, body, options = {}) {
    const startedAt = Date.now();
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    const response = await fetch(url, {
      method: "POST",
      ...options,
      headers,
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const payload = parseJson(text);
    traceRows.push({
      name,
      method: "POST",
      url,
      status: response.status,
      durationMs: Date.now() - startedAt,
      request: body,
      response: payload,
    });
    apiEvidence[name] = { status: response.status, request: body, payload };
    if (!response.ok) {
      throw new Error(
        `${name} failed (${response.status}): ${text.slice(0, 500)}`
      );
    }
    return payload;
  }

  return { getJson, postJson };
}

export function createEvidenceRecorders({
  outDir,
  report,
  traceRows,
  apiEvidence,
  sqlEvidence,
  txEvidence,
  logEvidence,
  reportMetadata,
}) {
  function recordSummary(message) {
    report.summary.push(message);
    console.log(message);
  }

  function recordFailure(name, error) {
    const detail = error instanceof Error ? error.message : String(error);
    report.failures.push({ name, detail });
    console.error(`FAIL ${name}: ${detail}`);
  }

  function finalize(status) {
    report.status = report.failures.length ? "failed" : status;
    const traceJsonl =
      traceRows.map((row) => JSON.stringify(row)).join("\n") +
      (traceRows.length ? "\n" : "");
    fs.writeFileSync(path.join(outDir, "trace.jsonl"), traceJsonl, "utf8");
    fs.writeFileSync(
      path.join(outDir, "api-evidence.json"),
      JSON.stringify(apiEvidence, null, 2)
    );
    fs.writeFileSync(
      path.join(outDir, "sql-evidence.json"),
      JSON.stringify(sqlEvidence, null, 2)
    );
    fs.writeFileSync(
      path.join(outDir, "tx-evidence.json"),
      JSON.stringify(txEvidence, null, 2)
    );
    fs.writeFileSync(
      path.join(outDir, "log-evidence.json"),
      JSON.stringify(logEvidence, null, 2)
    );
    fs.writeFileSync(
      path.join(outDir, "report.json"),
      JSON.stringify(report, null, 2)
    );
    fs.writeFileSync(
      path.join(outDir, "report.md"),
      buildReportMarkdown({
        report,
        metadata: reportMetadata(),
      }),
      "utf8"
    );
    console.log(`evidence written to ${outDir}`);
  }

  return { recordSummary, recordFailure, finalize };
}

export function createBrowserCaptureHelpers({ config, outDir, report }) {
  async function captureScreenshots(consumerAuth, providerAuth) {
    const browser = await chromium.launch({ headless: true });
    try {
      const consumerContext = await browser.newContext();
      await installBrowserAuth(
        consumerContext,
        consumerAuth,
        "CONSUMER",
        config
      );
      const consumerPage = await consumerContext.newPage();
      await capturePage(consumerPage, {
        name: "consumer-billing-credits",
        url: `${config.frontendBase}/dashboard/billing/credits`,
        expectedTexts: ["Billing", "Credits"],
      });
      await consumerContext.close();

      const providerContext = await browser.newContext();
      await installBrowserAuth(
        providerContext,
        providerAuth,
        "PROVIDER",
        config
      );
      const providerPage = await providerContext.newPage();
      await capturePage(providerPage, {
        name: "provider-withdraw",
        url: `${config.frontendBase}/provider/withdraw`,
        expectedTexts: ["Withdraw", "USDC"],
      });
      await providerContext.close();
    } finally {
      await browser.close();
    }
  }

  async function captureConsumerWithdrawalScreenshots(consumerAuth) {
    const browser = await chromium.launch({ headless: true });
    try {
      const consumerContext = await browser.newContext();
      await installBrowserAuth(
        consumerContext,
        consumerAuth,
        "CONSUMER",
        config
      );
      const consumerPage = await consumerContext.newPage();
      await capturePage(consumerPage, {
        name: "consumer-billing-credits",
        url: `${config.frontendBase}/dashboard/billing/credits`,
        expectedTexts: ["Billing", "Credits"],
      });
      await capturePage(consumerPage, {
        name: "consumer-billing-payments",
        url: `${config.frontendBase}/dashboard/billing`,
        expectedTexts: ["Billing", "Payments"],
      });
      await consumerContext.close();
    } finally {
      await browser.close();
    }
  }

  async function capturePage(page, item) {
    const response = await page.goto(item.url, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    const body = await page.locator("body").innerText({ timeout: 10000 });
    for (const text of item.expectedTexts) {
      if (!body.includes(text)) {
        throw new Error(
          `${
            item.name
          } missing expected text ${text}; body excerpt=${body.slice(0, 500)}`
        );
      }
    }
    const relativePath = `screenshots/${item.name}.png`;
    await page.screenshot({
      path: path.join(outDir, relativePath),
      fullPage: true,
    });
    report.screenshots.push({
      name: item.name,
      url: item.url,
      status: response?.status() || 0,
      path: relativePath,
    });
  }

  return { captureScreenshots, captureConsumerWithdrawalScreenshots };
}

export async function collectProdLogs({
  root,
  logEvidence,
  report,
  recordFailure,
}) {
  const services = [
    "synapse-prod-gateway",
    "synapse-prod-user-front",
    "synapse-prod-gateway-admin",
  ];
  for (const service of services) {
    try {
      logEvidence.services[service] = {
        latestReadyRevisionName: execFileSync(
          "gcloud",
          [
            "run",
            "services",
            "describe",
            service,
            "--project",
            "synapse-network-prod",
            "--region",
            "us-central1",
            "--format=value(status.latestReadyRevisionName)",
          ],
          { cwd: root, encoding: "utf8" }
        ).trim(),
      };
    } catch {
      logEvidence.services[service] = {
        latestReadyRevisionName: "",
      };
    }
  }
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const filter =
    `resource.type="cloud_run_revision" severity>=ERROR timestamp>="${since}" ` +
    `(resource.labels.service_name="synapse-prod-gateway" OR ` +
    `resource.labels.service_name="synapse-prod-user-front" OR ` +
    `resource.labels.service_name="synapse-prod-gateway-admin")`;
  try {
    const raw = execFileSync(
      "gcloud",
      [
        "logging",
        "read",
        filter,
        "--project",
        "synapse-network-prod",
        "--limit",
        "50",
        "--format=json",
      ],
      { cwd: root, encoding: "utf8" }
    );
    logEvidence.errors = JSON.parse(raw || "[]");
    if (logEvidence.errors.length > 0) {
      recordFailure(
        "prodLogs",
        new Error(`found ${logEvidence.errors.length} ERROR log entries`)
      );
    }
  } catch (error) {
    report.warnings.push(`log query failed: ${String(error.message || error)}`);
  }
}

export async function runCloudRunJobAndWait({ root, jobName, recordSummary }) {
  const executionName = execFileSync(
    "gcloud",
    [
      "run",
      "jobs",
      "execute",
      jobName,
      "--project",
      "synapse-network-prod",
      "--region",
      "us-central1",
      "--format=value(metadata.name)",
    ],
    { cwd: root, encoding: "utf8" }
  )
    .trim()
    .split(/\s+/)
    .at(-1);
  if (!executionName) {
    throw new Error(`failed to start Cloud Run job ${jobName}`);
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(5000);
    const execution = JSON.parse(
      execFileSync(
        "gcloud",
        [
          "run",
          "jobs",
          "executions",
          "describe",
          executionName,
          "--project",
          "synapse-network-prod",
          "--region",
          "us-central1",
          "--format=json",
        ],
        { cwd: root, encoding: "utf8" }
      ) || "{}"
    );
    const completed = Array.isArray(execution.status?.conditions)
      ? execution.status.conditions.find((item) => item.type === "Completed")
      : null;
    if (completed?.status === "True") {
      recordSummary(`${jobName} completed via ${executionName}`);
      return execution;
    }
    if (completed?.status === "False") {
      throw new Error(
        `${jobName} execution ${executionName} failed: ${
          completed.message || completed.reason || "unknown"
        }`
      );
    }
  }
  throw new Error(`${jobName} execution did not complete within timeout`);
}

export function authHeaders(auth) {
  return {
    Authorization: `Bearer ${auth.token}`,
    "X-User-Address": auth.address,
  };
}

export function credentialHeaders(token) {
  return {
    "X-Credential": token,
    "Content-Type": "application/json",
  };
}

export function buildIdempotencyKey(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto
    .randomUUID()
    .replaceAll("-", "")}`.slice(0, 120);
}

export function moneyLt(left, right) {
  return moneyToMicros(left) < moneyToMicros(right);
}

export function moneyGt(left, right) {
  return moneyToMicros(left) > moneyToMicros(right);
}

export function moneyGte(left, right) {
  return moneyToMicros(left) >= moneyToMicros(right);
}

export function moneyMin(left, right) {
  return moneyLt(left, right)
    ? normalizeMoneyString(left)
    : normalizeMoneyString(right);
}

export function normalizeMoneyString(value) {
  return ethers.formatUnits(ethers.parseUnits(String(value || "0"), 6), 6);
}

export function ensureHex32(value) {
  const raw = String(value || "");
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function moneyToMicros(value) {
  return ethers.parseUnits(normalizeMoneyString(value), 6);
}

function buildReportMarkdown({ report, metadata }) {
  return [
    "# Prod Small-Value E2E Rehearsal",
    "",
    `- Status: ${report.status}`,
    ...metadata.map((item) => `- ${item.label}: ${item.value}`),
    "",
    "## Summary",
    "",
    ...report.summary.map((item) => `- ${item}`),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length
      ? report.warnings.map((item) => `- ${item}`)
      : ["- none"]),
    "",
    "## Failures",
    "",
    ...(report.failures.length
      ? report.failures.map((item) => `- ${item.name}: ${item.detail}`)
      : ["- none"]),
    "",
    "## Screenshots",
    "",
    ...(report.screenshots.length
      ? report.screenshots.map((item) => `- ${item.path}`)
      : ["- none"]),
    "",
  ].join("\n");
}

async function installBrowserAuth(context, auth, role, config) {
  await context.addInitScript(
    ({ address, token, expiresAt, chainId, rpcUrl, role }) => {
      const store = {
        state: {
          connections: {
            __type: "Map",
            value: [
              [
                "injected",
                {
                  accounts: [address],
                  chainId,
                  connector: {
                    id: "injected",
                    name: "Injected",
                    type: "injected",
                    uid: "injected",
                  },
                },
              ],
            ],
          },
          chainId,
          current: "injected",
          status: "connected",
        },
        version: 2,
      };
      localStorage.setItem("synapse_lang", "en");
      localStorage.setItem("a2a_selected_role", role);
      localStorage.setItem(`a2a_role_${String(address).toLowerCase()}`, role);
      localStorage.setItem(
        "a2a_auth_session",
        JSON.stringify({
          wallet: String(address).toLowerCase(),
          token,
          expiresAt,
        })
      );
      localStorage.setItem("wagmi.store", JSON.stringify(store));
      localStorage.setItem(
        "wagmi.recentConnectorId",
        JSON.stringify("injected")
      );
      localStorage.setItem("wagmi.injected.connected", JSON.stringify(true));
      const chainHex = `0x${Number(chainId).toString(16)}`;
      window.ethereum = {
        isMetaMask: true,
        chainId: chainHex,
        selectedAddress: address,
        isConnected: () => true,
        request: async (args) => {
          const method = args?.method;
          if (method === "eth_requestAccounts" || method === "eth_accounts") {
            return [address];
          }
          if (method === "eth_chainId") return chainHex;
          const response = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: Date.now(),
              method,
              params: args?.params || [],
            }),
          });
          const payload = await response.json();
          if (payload.error)
            throw new Error(payload.error.message || "RPC failed");
          return payload.result;
        },
        on: () => {},
        removeListener: () => {},
      };
    },
    {
      address: auth.address,
      token: auth.token,
      expiresAt: auth.expiresAt,
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
      role,
    }
  );
}
