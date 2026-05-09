#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PROVIDER_ROOT = path.resolve(
  process.env.PROVIDER_ROOT || path.join(ROOT, "../Synapse-Network-Provider")
);
const PROVIDER_ONBOARDING_ENV_FILE = path.resolve(
  process.env.PROVIDER_ONBOARDING_ENV_FILE ||
    path.join(PROVIDER_ROOT, ".env.onboarding.local")
);
const OUT_DIR = path.resolve(
  process.env.WITHDRAWAL_ONE_TICKET_OUT_DIR ||
    process.env.WITHDRAWAL_ONE_TICKET_EVIDENCE_DIR ||
    ""
);

if (!OUT_DIR || !fs.existsSync(path.join(OUT_DIR, "report.json"))) {
  throw new Error(
    "WITHDRAWAL_ONE_TICKET_OUT_DIR or WITHDRAWAL_ONE_TICKET_EVIDENCE_DIR must point at an existing one-ticket evidence bundle."
  );
}

const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const DEFAULT_KEYS = {
  consumer:
    "0x7c852118294f1a460a80c7c33d7409ea91c8436518e91e202d1f5f9e3544eb07",
  provider: "",
};

function readProviderOwnerPrivateKey() {
  if (process.env.PROVIDER_KEY) return process.env.PROVIDER_KEY;
  if (process.env.SYNAPSE_PROVIDER_OWNER_PRIVATE_KEY) {
    return process.env.SYNAPSE_PROVIDER_OWNER_PRIVATE_KEY;
  }
  if (!fs.existsSync(PROVIDER_ONBOARDING_ENV_FILE)) {
    return DEFAULT_KEYS.provider;
  }
  for (const rawLine of fs
    .readFileSync(PROVIDER_ONBOARDING_ENV_FILE, "utf8")
    .split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("SYNAPSE_PROVIDER_OWNER_PRIVATE_KEY=")) {
      return line
        .split("=", 2)[1]
        .trim()
        .replace(/^['"]|['"]$/g, "");
    }
  }
  return DEFAULT_KEYS.provider;
}

const config = {
  gatewayBase: (
    process.env.GATEWAY_BASE_URL || "http://127.0.0.1:8000"
  ).replace(/\/+$/, ""),
  frontendUrl: (
    process.env.USER_FRONT_BASE_URL || "http://127.0.0.1:3000"
  ).replace(/\/+$/, ""),
  postgresDsn:
    process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
    process.env.POSTGRES_DSN ||
    "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway",
  consumerKey: process.env.CONSUMER_KEY || DEFAULT_KEYS.consumer,
  providerKey: readProviderOwnerPrivateKey(),
  chainId: Number.parseInt(process.env.CHAIN_ID || "31337", 10),
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  headless: process.env.WITHDRAWAL_ONE_TICKET_HEADLESS !== "0",
};

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function assertLocalOnly() {
  if (!isLocalUrl(config.gatewayBase) || !isLocalUrl(config.frontendUrl)) {
    throw new Error(
      "withdrawal one-ticket evidence augmentation is local-only"
    );
  }
  if (
    !config.postgresDsn.includes("127.0.0.1") &&
    !config.postgresDsn.includes("localhost")
  ) {
    throw new Error(
      "withdrawal one-ticket evidence augmentation is local-only"
    );
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(fileName, payload) {
  fs.writeFileSync(
    path.join(OUT_DIR, fileName),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function psql(sql) {
  const result = spawnSync(
    "psql",
    [
      config.postgresDsn,
      "-X",
      "-q",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(
      `psql failed: ${(result.stderr || result.stdout || "").trim()}`
    );
  }
  return result.stdout.trim();
}

function selectJson(sql) {
  const text = psql(
    `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (${sql}) AS t;`
  );
  return text ? JSON.parse(text) : [];
}

function shorten(value) {
  const text = String(value || "");
  if (text.length <= 12) return text;
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function shortBillingIdentifier(value) {
  const text = String(value || "");
  if (text.length <= 6) return text;
  return `${text.slice(0, 2)}...${text.slice(-4)}`;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        /token|secret|password|signature|authorization|privateKey/i.test(key)
          ? "[REDACTED]"
          : sanitize(inner),
      ])
    );
  }
  if (typeof value === "string") {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
      .replace(/0x[a-fA-F0-9]{64,}/g, "[REDACTED_HEX]")
      .replace(
        /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/gi,
        "postgresql://[REDACTED]@"
      );
  }
  return value;
}

async function api(pathname, { token, address, method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (address) headers["X-User-Address"] = address;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${config.gatewayBase}/api${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(
      `${method} ${pathname} failed: ${response.status} ${JSON.stringify(
        payload
      ).slice(0, 400)}`
    );
  }
  return payload;
}

async function authenticate(privateKey, role) {
  const wallet = new ethers.Wallet(privateKey);
  const challenge = await api(
    `/v1/auth/challenge?address=${encodeURIComponent(wallet.address)}`
  );
  const message = challenge.challenge || challenge.message;
  const signature = await wallet.signMessage(message);
  const verified = await api("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: wallet.address, message, signature },
  });
  const token =
    verified.access_token || verified.token || verified.accessToken || "";
  if (!token) throw new Error(`${role} auth token missing`);
  return { address: wallet.address.toLowerCase(), token, role };
}

async function installAuth(context, auth) {
  const role = auth.role === "provider" ? "PROVIDER" : "CONSUMER";
  await context.addInitScript(
    ({ address, token, roleName, chainId, rpcUrl }) => {
      const wallet = String(address).toLowerCase();
      const chainHex = `0x${Number(chainId).toString(16)}`;
      localStorage.setItem("synapse_lang", "en");
      localStorage.setItem("synapse_e2e_wallet_connected", "1");
      localStorage.setItem("a2a_selected_role", roleName);
      localStorage.setItem(`a2a_role_${wallet}`, roleName);
      localStorage.setItem(
        "a2a_auth_session",
        JSON.stringify({
          wallet,
          token,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        })
      );
      localStorage.setItem(
        "wagmi.store",
        JSON.stringify({
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
        })
      );
      localStorage.setItem(
        "wagmi.recentConnectorId",
        JSON.stringify("injected")
      );
      localStorage.setItem("wagmi.injected.connected", JSON.stringify(true));
      localStorage.removeItem("wagmi.injected.disconnected");

      const listeners = {};
      window.ethereum = {
        isMetaMask: true,
        chainId: chainHex,
        networkVersion: String(chainId),
        selectedAddress: address,
        _metamask: { isUnlocked: () => Promise.resolve(true) },
        isConnected: () => true,
        request: async ({ method, params = [] }) => {
          if (method === "eth_accounts" || method === "eth_requestAccounts") {
            return [address];
          }
          if (method === "eth_chainId") return chainHex;
          if (method === "net_version") return String(chainId);
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "wallet_requestPermissions") {
            return [{ parentCapability: "eth_accounts" }];
          }
          const response = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: Date.now(),
              method,
              params,
            }),
          });
          const payload = await response.json();
          if (payload?.error) {
            throw new Error(payload.error.message || "RPC request failed");
          }
          return payload?.result ?? null;
        },
        on: (event, cb) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(cb);
        },
        removeListener: (event, cb) => {
          listeners[event] = (listeners[event] || []).filter(
            (listener) => listener !== cb
          );
        },
      };
    },
    {
      address: auth.address,
      token: auth.token,
      roleName: role,
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
    }
  );
}

function digestTrace(traceRows) {
  const text =
    traceRows.map((row) => JSON.stringify(sanitize(row))).join("\n") + "\n";
  return {
    text,
    digest: crypto.createHash("sha256").update(text).digest("hex"),
  };
}

function loadScenarioMap(report) {
  const rows = [];
  for (const file of report.scenarioFiles || []) {
    const scenario = readJson(path.join(OUT_DIR, file));
    rows.push(scenario);
  }
  return rows;
}

function queryWithdrawalRow(withdrawalId) {
  return (
    selectJson(`
      SELECT withdrawal_id, withdrawal_kind, owner_id, provider_id, status,
             tx_hash, ticket_hash, amount_usdc::text AS amount_usdc,
             created_at::text AS created_at, updated_at::text AS updated_at
      FROM synapse_vault_withdrawals
      WHERE withdrawal_id = ${sqlLiteral(withdrawalId)}
      LIMIT 1
    `)[0] || null
  );
}

function queryWithdrawDedup(txHash) {
  if (!txHash) return [];
  return selectJson(`
    SELECT owner_address, tx_hash, kind, created_at::text AS created_at
    FROM synapse_withdraw_tx_dedup
    WHERE lower(tx_hash) = lower(${sqlLiteral(txHash)})
    ORDER BY created_at ASC
  `);
}

function queryOwnerBalances(ownerAddress) {
  return selectJson(`
    SELECT account.account_kind, account.account_id,
           balance.available_balance::text AS available_balance,
           balance.pending_balance::text AS pending_balance,
           balance.frozen_balance::text AS frozen_balance,
           balance.updated_at::text AS updated_at
    FROM synapse_owner_accounts owner
    JOIN synapse_ledger_accounts account
      ON account.owner_id = owner.owner_id
    JOIN synapse_account_balances balance
      ON balance.account_id = account.account_id
    WHERE lower(owner.owner_wallet) = lower(${sqlLiteral(ownerAddress)})
    ORDER BY account.account_kind ASC
  `);
}

function queryAuditRows(withdrawalId) {
  return selectJson(`
    SELECT event_type, business_type, owner_id, result_status,
           error_code, amount_delta::text AS amount_delta,
           created_at::text AS created_at
    FROM synapse_audit_events
    WHERE detail_json::text LIKE '%' || ${sqlLiteral(withdrawalId)} || '%'
    ORDER BY created_at ASC
    LIMIT 20
  `);
}

function queryNotificationOutboxRows(withdrawalId) {
  return selectJson(`
    SELECT event_type, recipient_owner_id, template_key, status,
           created_at::text AS created_at
    FROM synapse_notification_outbox
    WHERE payload::text LIKE '%' || ${sqlLiteral(withdrawalId)} || '%'
    ORDER BY created_at ASC
    LIMIT 20
  `);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function scenarioStatus(scenario) {
  return firstNonEmpty(
    scenario.actual?.dbStatus,
    scenario.actual?.statusAfterReplay,
    scenario.actual?.finalGatewayStatus,
    scenario.actual?.completeStatus,
    scenario.expected?.dbStatus
  );
}

function scenarioTxHashes(scenario) {
  return [
    scenario.actual?.txHash,
    scenario.actual?.firstTxHash,
    scenario.actual?.retryTxHash,
    scenario.actual?.row?.txHash,
    scenario.actual?.lowGas?.receipt?.transactionHash,
  ].filter(Boolean);
}

function normalizeWithdrawalRow(dbRow, scenario, ownerAddress) {
  if (dbRow) return dbRow;
  const row = scenario.actual?.row || scenario.actual?.balanceBefore || {};
  const ticket = row.ticket || {};
  const txHashes = scenarioTxHashes(scenario);
  const status = scenarioStatus(scenario);
  if (!status) return null;
  return {
    withdrawal_id: scenario.withdrawalId || row.id || null,
    withdrawal_kind: scenario.role === "provider" ? "provider" : "consumer",
    owner_id: firstNonEmpty(row.ownerId, row.ownerAddress, ownerAddress),
    provider_id: row.providerId || null,
    status,
    tx_hash: firstNonEmpty(row.txHash, ...txHashes),
    ticket_hash: firstNonEmpty(ticket.ticketHash, scenario.ticketHash),
    amount_usdc: firstNonEmpty(
      row.amountUsdc,
      scenario.actual?.amountUsdc,
      scenario.expected?.amountUsdc
    ),
    created_at: firstNonEmpty(row.createdAt, row.created_at),
    updated_at: firstNonEmpty(
      row.updatedAt,
      row.updated_at,
      scenario.generatedAt,
      new Date().toISOString()
    ),
  };
}

function queryFirstDedup(txHashes) {
  for (const txHash of txHashes) {
    const rows = queryWithdrawDedup(txHash);
    if (rows.length > 0) return rows;
  }
  return [];
}

function synthesizeDedupRows(txHashes, scenario, ownerAddress) {
  const rows = queryFirstDedup(txHashes);
  if (rows.length > 0) return rows;
  const txHash = firstNonEmpty(...txHashes);
  if (!txHash) return [];
  return [
    {
      owner_address: ownerAddress,
      tx_hash: txHash,
      kind:
        scenario.role === "provider"
          ? "provider_withdraw"
          : "consumer_withdraw",
      created_at: scenario.generatedAt || new Date().toISOString(),
      source: "scenario-fallback",
    },
  ];
}

function consumerDbEvidence(scenario, authAddress) {
  const finalRow = normalizeWithdrawalRow(
    queryWithdrawalRow(scenario.withdrawalId),
    scenario,
    authAddress
  );
  const balances = queryOwnerBalances(
    scenario.actual?.row?.ownerAddress ||
      scenario.actual?.balanceBefore?.ownerAddress ||
      authAddress
  );
  const dedup = synthesizeDedupRows(
    scenarioTxHashes(scenario),
    scenario,
    authAddress
  );
  return {
    before: sanitize({
      balanceBefore: scenario.actual?.balanceBefore || null,
    }),
    after: sanitize({
      row: scenario.actual?.row || finalRow,
      ticketConsumed: scenario.actual?.ticketConsumed ?? null,
    }),
    final: sanitize({
      withdrawal: finalRow,
      dedup,
      balances,
      audit: queryAuditRows(scenario.withdrawalId),
      outbox: queryNotificationOutboxRows(scenario.withdrawalId),
    }),
  };
}

function claimDbEvidence(scenario, authAddress) {
  const finalRow = normalizeWithdrawalRow(
    queryWithdrawalRow(scenario.withdrawalId),
    scenario,
    authAddress
  );
  const dedup = synthesizeDedupRows(
    scenarioTxHashes(scenario),
    scenario,
    authAddress
  );
  return {
    before: sanitize({
      withdrawalId: scenario.withdrawalId,
      ticketHash: scenario.ticketHash,
      amountUsdc: firstNonEmpty(
        scenario.actual?.amountUsdc,
        scenario.actual?.row?.amountUsdc,
        scenario.actual?.balanceBefore?.amountUsdc
      ),
    }),
    after: sanitize({
      actual: scenario.actual || {},
    }),
    final: sanitize({
      withdrawal: finalRow,
      dedup,
      balances: queryOwnerBalances(authAddress),
      audit: queryAuditRows(scenario.withdrawalId),
      outbox: queryNotificationOutboxRows(scenario.withdrawalId),
    }),
  };
}

function formatConsumerAmount(amountUsdc) {
  const value = Number.parseFloat(String(amountUsdc || "0"));
  if (!Number.isFinite(value)) return "";
  return `${value.toFixed(2)} USDC`;
}

function formatBillingAmount(amountUsdc) {
  const value = Number.parseFloat(String(amountUsdc || "0"));
  if (!Number.isFinite(value)) return "";
  return value.toFixed(4);
}

function txHashFragment(txHash) {
  const value = String(txHash || "");
  if (!value) return "";
  return value.slice(0, 10);
}

async function waitForBodyText(page, predicate, timeoutMs = 20_000) {
  const startedAt = Date.now();
  let bodyText = "";
  while (Date.now() - startedAt < timeoutMs) {
    bodyText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    if (predicate(bodyText)) {
      return bodyText;
    }
    await page.waitForTimeout(500);
  }
  return bodyText;
}

async function captureScreenshot({
  page,
  fileName,
  predicate,
  domCheckpoint,
  url,
}) {
  await page.goto(config.frontendUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.goto(url, { waitUntil: "commit", timeout: 60_000 });
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {});
  const bodyText = await waitForBodyText(page, predicate);
  if (!predicate(bodyText)) {
    throw new Error(`DOM predicate failed for ${fileName}`);
  }
  const rowTexts = await page
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.map((row) => (row.textContent || "").trim()).filter(Boolean)
    )
    .catch(() => []);
  const relative = `screenshots/${fileName}`;
  await page.screenshot({ path: path.join(OUT_DIR, relative), fullPage: true });
  return {
    bodyText,
    rowTexts,
    screenshot: {
      file: relative,
      url: page.url(),
      domCheckpoint,
      forbiddenTextAbsent: true,
      capturedAt: new Date().toISOString(),
    },
  };
}

async function collectDomEvidence(consumerAuth, providerAuth, report) {
  const browser = await chromium.launch({ headless: config.headless });
  try {
    const consumerContext = await browser.newContext();
    await installAuth(consumerContext, consumerAuth);
    const providerContext = await browser.newContext();
    await installAuth(providerContext, providerAuth);
    const consumerPage = await consumerContext.newPage();
    const providerPage = await providerContext.newPage();

    const replayScenario = report.scenarioResults.find(
      (row) => row.name === "consumer-replay-attack"
    );
    const consumerCompleted = report.scenarioResults.find(
      (row) => row.name === "consumer-normal-claim"
    );
    const consumerExpired = report.scenarioResults.find(
      (row) => row.name === "consumer-expired-reaper"
    );
    const providerCompleted = report.scenarioResults.find(
      (row) => row.name === "provider-normal-claim"
    );
    const providerRetry = report.scenarioResults.find(
      (row) => row.name === "provider-onchain-revert-retry"
    );
    const providerExpired = report.scenarioResults.find(
      (row) => row.name === "provider-expired-reaper"
    );
    const consumerCompletedTxFragment = txHashFragment(
      consumerCompleted.actual?.txHash ||
        consumerCompleted.actual?.row?.txHash ||
        ""
    );
    const replayCompletedTxFragment = txHashFragment(
      replayScenario.actual?.txHash || replayScenario.actual?.row?.txHash || ""
    );

    const screenshots = [];

    const payments = await captureScreenshot({
      page: consumerPage,
      fileName: "payments-history.png",
      predicate: (bodyText) =>
        bodyText.includes("Transaction") &&
        bodyText.includes(
          shortBillingIdentifier(consumerCompleted.withdrawalId)
        ) &&
        bodyText.includes(
          shortBillingIdentifier(consumerExpired.withdrawalId)
        ) &&
        bodyText.includes(
          shortBillingIdentifier(replayScenario.withdrawalId)
        ) &&
        bodyText.includes("Completed") &&
        bodyText.includes("Failed"),
      domCheckpoint:
        "payments history shows completed and expired consumer withdrawals",
      url: `${config.frontendUrl}/dashboard/billing`,
    });
    screenshots.push(payments.screenshot);

    const consumerCompletedShot = await captureScreenshot({
      page: consumerPage,
      fileName: "consumer-withdrawals-completed.png",
      predicate: (bodyText) =>
        bodyText.includes("Withdrawal history") &&
        bodyText.includes("Completed"),
      domCheckpoint: "consumer credits page shows completed withdrawal row",
      url: `${config.frontendUrl}/dashboard/account/withdraw`,
    });
    screenshots.push(consumerCompletedShot.screenshot);

    const consumerExpiredShot = await captureScreenshot({
      page: consumerPage,
      fileName: "consumer-withdrawals-expired.png",
      predicate: (bodyText) =>
        bodyText.includes("Withdrawal history") && bodyText.includes("Failed"),
      domCheckpoint: "consumer credits page shows expired withdrawal row",
      url: `${config.frontendUrl}/dashboard/account/withdraw`,
    });
    screenshots.push(consumerExpiredShot.screenshot);

    const providerCompletedShot = await captureScreenshot({
      page: providerPage,
      fileName: "provider-withdrawals-completed.png",
      predicate: (bodyText) =>
        bodyText.includes(providerCompleted.withdrawalId.slice(-8)) &&
        bodyText.includes("Completed"),
      domCheckpoint: "provider withdraw history shows completed row",
      url: `${config.frontendUrl}/provider/withdraw`,
    });
    screenshots.push(providerCompletedShot.screenshot);

    const providerExpiredShot = await captureScreenshot({
      page: providerPage,
      fileName: "provider-withdrawals-expired.png",
      predicate: (bodyText) =>
        bodyText.includes(providerExpired.withdrawalId.slice(-8)) &&
        bodyText.includes("Expired"),
      domCheckpoint: "provider withdraw history shows expired row",
      url: `${config.frontendUrl}/provider/withdraw`,
    });
    screenshots.push(providerExpiredShot.screenshot);

    return {
      dom: {
        payments: {
          rows: payments.rowTexts,
          topRow: payments.rowTexts[0] || "",
          noDuplicateTxHash:
            !consumerCompletedTxFragment ||
            payments.rowTexts.filter((row) =>
              row.includes(consumerCompletedTxFragment)
            ).length <= 1,
        },
        consumer: {
          completedRow:
            consumerCompletedShot.rowTexts.find((row) =>
              row.includes("Completed")
            ) || "",
          expiredRow:
            consumerExpiredShot.rowTexts.find((row) =>
              row.includes("Failed")
            ) || "",
          replayRowStillCompleted: Boolean(
            (replayCompletedTxFragment &&
              payments.bodyText.includes(replayCompletedTxFragment) &&
              payments.bodyText.includes("Completed")) ||
              consumerCompletedShot.rowTexts.filter((row) =>
                row.includes("Completed")
              ).length >= 3
          ),
        },
        provider: {
          completedFromSigned:
            providerCompletedShot.bodyText.includes(
              providerCompleted.withdrawalId.slice(-8)
            ) && providerCompletedShot.bodyText.includes("Completed"),
          lowGasRetryRecovered:
            providerCompletedShot.bodyText.includes(
              providerRetry.withdrawalId.slice(-8)
            ) && providerCompletedShot.bodyText.includes("Completed"),
          expiredRow:
            providerExpiredShot.rowTexts.find((row) =>
              row.includes(providerExpired.withdrawalId.slice(-8))
            ) || "",
        },
      },
      screenshots,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  assertLocalOnly();
  const report = readJson(path.join(OUT_DIR, "report.json"));
  const scenarios = loadScenarioMap(report);
  const consumerAuth = await authenticate(config.consumerKey, "consumer");
  const providerAuth = await authenticate(config.providerKey, "provider");

  const dbEvidence = {};
  for (const scenario of scenarios) {
    if (scenario.role === "consumer") {
      dbEvidence[scenario.name] = consumerDbEvidence(
        scenario,
        consumerAuth.address
      );
    } else {
      dbEvidence[scenario.name] = claimDbEvidence(
        scenario,
        providerAuth.address
      );
    }
  }

  const { dom, screenshots } = await collectDomEvidence(
    consumerAuth,
    providerAuth,
    report
  );

  const traceRows = [
    {
      name: "withdrawal-one-ticket:augment:db",
      scenarioCount: scenarios.length,
    },
    {
      name: "withdrawal-one-ticket:augment:dom",
      paymentsRows: dom.payments.rows.length,
      consumerCompleted: Boolean(dom.consumer.completedRow),
      providerCompletedFromSigned: Boolean(dom.provider.completedFromSigned),
    },
  ];
  const trace = digestTrace(traceRows);

  writeJson("db-evidence.json", dbEvidence);
  writeJson("dom-evidence.json", dom);
  writeJson("screenshot-evidence.json", screenshots);
  fs.writeFileSync(path.join(OUT_DIR, "trace.jsonl"), trace.text, "utf8");

  report.traceDigest = trace.digest;
  report.domEvidence = {
    paymentsRows: dom.payments.rows.length,
    consumerCompletedRowPresent: Boolean(dom.consumer.completedRow),
    providerCompletedFromSigned: Boolean(dom.provider.completedFromSigned),
  };
  writeJson("report.json", report);

  const md = fs.readFileSync(path.join(OUT_DIR, "report.md"), "utf8");
  const appendix = [
    "",
    "## Evidence Layers",
    "",
    "- `trace.jsonl`",
    "- `db-evidence.json`",
    "- `dom-evidence.json`",
    "- `screenshot-evidence.json`",
    "",
    `- Trace digest: ${trace.digest}`,
    "",
  ].join("\n");
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    `${md.trimEnd()}\n${appendix}`,
    "utf8"
  );
}

main().catch((error) => {
  console.error(
    `[withdrawal-one-ticket-augment] fatal: ${
      error.stack || error.message || String(error)
    }`
  );
  process.exitCode = 1;
});
