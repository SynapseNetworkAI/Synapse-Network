#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";

export function moneyCandidates(value) {
  const amount = Number(value || 0);
  const fixed6 = amount.toFixed(6);
  const fixed2 = amount.toFixed(2);
  const whole = amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const formatted2 = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return [...new Set([fixed6, fixed2, whole, formatted2].filter(Boolean))];
}

export async function readBodyText(page) {
  return page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
}

export async function waitForAnyText(page, candidates, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastBody = "";
  while (Date.now() < deadline) {
    lastBody = await readBodyText(page);
    const found = candidates.find((candidate) => lastBody.includes(candidate));
    if (found) return found;
    await page.waitForTimeout(500);
  }
  throw new Error(
    `${label} did not find any of ${candidates.join(", ")}. body=${lastBody.slice(0, 1200)}`
  );
}

export async function installAuth(context, auth, { chainId, rpcUrl }) {
  const wagmiStore = {
    state: {
      chainId,
      connections: {
        __type: "Map",
        value: [
          [
            "injected",
            {
              accounts: [auth.address],
              chainId,
              connector: { id: "injected", name: "Injected", type: "injected", uid: "injected" },
            },
          ],
        ],
      },
      current: "injected",
      status: "connected",
    },
    version: 2,
  };
  await context.addInitScript(
    ({ address, token, expiresAt, injectedChainId, injectedRpcUrl, wagmi }) => {
      const session = {
        wallet: String(address).toLowerCase(),
        token,
        expiresAt,
      };
      const chainHex = `0x${Number(injectedChainId).toString(16)}`;
      const listeners = {};
      localStorage.setItem("synapse_lang", "en");
      localStorage.setItem("a2a_selected_role", "CONSUMER");
      localStorage.setItem(`a2a_role_${String(address).toLowerCase()}`, "CONSUMER");
      localStorage.setItem("a2a_auth_session", JSON.stringify(session));
      localStorage.setItem("wagmi.store", JSON.stringify(wagmi));
      localStorage.setItem("wagmi.recentConnectorId", JSON.stringify("injected"));
      localStorage.setItem("wagmi.injected.connected", JSON.stringify(true));
      localStorage.removeItem("wagmi.injected.disconnected");
      window.ethereum = {
        isMetaMask: true,
        chainId: chainHex,
        networkVersion: String(injectedChainId),
        selectedAddress: address,
        _metamask: { isUnlocked: () => Promise.resolve(true) },
        isConnected: () => true,
        request: async (args) => {
          const method = args?.method;
          const params = args?.params || [];
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
          if (method === "eth_chainId") return chainHex;
          if (method === "net_version") return String(injectedChainId);
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "wallet_requestPermissions")
            return [{ parentCapability: "eth_accounts" }];
          const response = await fetch(injectedRpcUrl, {
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
          if (payload.error) throw new Error(payload.error.message || "RPC request failed");
          return payload.result;
        },
        on: (event, cb) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(cb);
        },
        removeListener: (event, cb) => {
          if (listeners[event]) {
            listeners[event] = listeners[event].filter((listener) => listener !== cb);
          }
        },
        removeAllListeners: () => {},
      };
      setTimeout(() => {
        window.dispatchEvent(new Event("ethereum#initialized"));
      }, 0);
    },
    {
      address: auth.address,
      token: auth.token,
      expiresAt: auth.expiresAt,
      injectedChainId: chainId,
      injectedRpcUrl: rpcUrl,
      wagmi: wagmiStore,
    }
  );
}

export async function captureScreenshot(page, outDir, evidence, name, metadata = {}) {
  const relative = `screenshots/${name}`;
  const absolute = path.join(outDir, relative);
  await page.screenshot({ path: absolute, fullPage: false });
  evidence.screenshots.push(relative);
  evidence.screenshotEvidence[relative] = metadata;
}

export async function assertBillingRowStatus(page, baseUrl, txHash, expectedStatus, amountUsdc) {
  await page.goto(`${baseUrl}/dashboard/billing`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  const amountMatches = moneyCandidates(amountUsdc);
  const deadline = Date.now() + 30000;
  let lastBody = "";
  while (Date.now() < deadline) {
    const linkRow = page
      .locator(`a[href*="${txHash}"]`)
      .locator("xpath=ancestor::tr")
      .first();
    if (await linkRow.isVisible().catch(() => false)) {
      const text = await linkRow.innerText();
      if (
        text.includes(expectedStatus) &&
        amountMatches.some((candidate) => text.includes(candidate))
      ) {
        return text;
      }
    }
    const genericRow = page
      .locator("tr")
      .filter({ hasText: "Deposit" })
      .filter({ hasText: expectedStatus })
      .first();
    if (await genericRow.isVisible().catch(() => false)) {
      const text = await genericRow.innerText();
      if (amountMatches.some((candidate) => text.includes(candidate))) {
        return text;
      }
    }
    lastBody = await readBodyText(page);
    await page.waitForTimeout(500);
  }
  throw new Error(
    `billing row ${txHash} expected ${expectedStatus}; body=${lastBody.slice(0, 1200)}`
  );
}

export async function assertCreditsPage(page, baseUrl, expectedAvailable, expectedPending) {
  await page.goto(`${baseUrl}/dashboard/billing/credits`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitForAnyText(page, moneyCandidates(expectedAvailable), "credits spendable");
  const bodyText = await readBodyText(page);
  if (!bodyText.includes("Spendable credits")) {
    throw new Error(`Credits page missing Spendable credits label: ${bodyText.slice(0, 1200)}`);
  }
  const pendingCandidate = moneyCandidates(expectedPending).find((candidate) =>
    bodyText.includes(candidate)
  );
  return {
    pendingMatched: pendingCandidate || "",
    bodyText: bodyText.slice(0, 1600),
  };
}

export function queryGatewayLogs(projectId, serviceName, startIso, txHash, depositIntentId = "") {
  const identifiers = [
    txHash ? `textPayload:"${txHash.toLowerCase()}"` : "",
    depositIntentId ? `textPayload:"${depositIntentId}"` : "",
  ].filter(Boolean);
  const filter = [
    'resource.type="cloud_run_revision"',
    `resource.labels.service_name="${serviceName}"`,
    `timestamp>="${startIso}"`,
    identifiers.length > 1 ? `(${identifiers.join(" OR ")})` : identifiers[0],
    '(textPayload:"ALCHEMY_DEPOSIT_WEBHOOK_RECEIVED" OR textPayload:"DEPOSIT_CREDITED" OR textPayload:"deposit credited")',
  ]
    .filter(Boolean)
    .join(" AND ");
  const raw = execFileSync(
    "gcloud",
    ["logging", "read", filter, `--project=${projectId}`, "--format=json", "--limit=50"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const rows = JSON.parse(raw || "[]");
  return rows
    .map((row) => ({
      timestamp: row.timestamp || row.receiveTimestamp || "",
      textPayload: row.textPayload || "",
      revision:
        row.resource?.labels?.revision_name ||
        row.labels?.revision_name ||
        "",
    }))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function queryDepositIndexerJobLogs(projectId, startIso) {
  const filter = [
    'resource.type="cloud_run_job"',
    'resource.labels.job_name="synapse-staging-deposit-indexer"',
    `timestamp>="${startIso}"`,
  ].join(" AND ");
  const raw = execFileSync(
    "gcloud",
    ["logging", "read", filter, `--project=${projectId}`, "--format=json", "--limit=20"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return JSON.parse(raw || "[]");
}
