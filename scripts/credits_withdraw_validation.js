#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { ethers } = require("ethers");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://127.0.0.1:3000";
const GATEWAY_URL = process.env.GATEWAY_URL || "http://127.0.0.1:8000/api";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
const DEPOSIT_USDC = process.env.DEPOSIT_USDC || "10.0";

const DEPLOYER_KEY = process.env.DEPLOYER_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const BUYER_KEY = process.env.BUYER_KEY || ethers.Wallet.createRandom().privateKey;

const REPO_ROOT = (() => {
  let current = __dirname;
  for (let index = 0; index < 5; index += 1) {
    if (fs.existsSync(path.join(current, "package.json")) && fs.existsSync(path.join(current, "services"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return process.cwd();
})();

const CONTRACT_CONFIG_PATH = path.join(REPO_ROOT, "services/user-front/src/contract-config.json");
const SYNAPSECORE_ABI_PATH = path.join(REPO_ROOT, "services/user-front/src/SynapseCoreABI.json");
const USDC_ABI_PATH = path.join(REPO_ROOT, "services/user-front/src/MockUSDCABI.json");
const SCREENSHOT_DIR = path.join(REPO_ROOT, "tmp/screens");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function ok(message) {
  console.log(`  ${GREEN}✓${RESET} ${message}`);
}

function warn(message) {
  console.log(`  ${YELLOW}!${RESET} ${message}`);
}

function fail(message) {
  console.error(`  ${RED}✗${RESET} ${message}`);
}

function section(title) {
  console.log(`\n${BOLD}${title}${RESET}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNonceError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("nonce has already been used") || message.includes("nonce too low");
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function apiGet(pathname, token, address) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (address) headers["X-User-Address"] = address;
  const response = await fetch(`${GATEWAY_URL}${pathname}`, { headers });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function apiPost(pathname, payload, token, address, idempotencyKey) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (address) headers["X-User-Address"] = address;
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`${GATEWAY_URL}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function authenticate(privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address.toLowerCase();
  const challengeResponse = await fetch(`${GATEWAY_URL}/v1/auth/challenge?address=${address}`);
  if (!challengeResponse.ok) {
    throw new Error(`challenge failed: ${challengeResponse.status}`);
  }
  const challengeBody = await challengeResponse.json();
  const signature = await wallet.signMessage(challengeBody.challenge);
  const verify = await apiPost(
    "/v1/auth/verify",
    { wallet_address: address, signature, message: challengeBody.challenge },
    null,
    null,
    null
  );
  const token = verify.body.token || verify.body.access_token;
  if (!verify.response.ok || !token) {
    throw new Error(`verify failed: ${verify.response.status} ${JSON.stringify(verify.body)}`);
  }
  ok(`Authenticated ${address}`);
  return { token, address };
}

async function fundOnChain(privateKey, amountUsdc) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const buyerForUsdc = new ethers.Wallet(privateKey, provider);
  const buyerForCore = new ethers.Wallet(privateKey, provider);
  const buyerAddress = buyerForCore.address;

  const contractConfig = loadJson(CONTRACT_CONFIG_PATH);
  const coreAbi = loadJson(SYNAPSECORE_ABI_PATH);
  const usdcAbi = loadJson(USDC_ABI_PATH);

  const usdcAddress = ethers.getAddress(contractConfig.MockUSDC);
  const coreAddress = ethers.getAddress(contractConfig.SynapseCore);
  const amount = ethers.parseUnits(amountUsdc, 18);
  const usdcDeployer = new ethers.Contract(usdcAddress, usdcAbi, deployer);
  const usdcBuyer = new ethers.Contract(usdcAddress, usdcAbi, buyerForUsdc);
  const coreBuyer = new ethers.Contract(coreAddress, coreAbi, buyerForCore);

  async function getLatestNonce(address) {
    return provider.getTransactionCount(address, "pending");
  }

  async function sendWithNonceRetry(label, factory) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await factory();
      } catch (error) {
        if (!isNonceError(error) || attempt === 4) {
          throw error;
        }
        warn(`${label} nonce collision, retrying...`);
        await sleep(300);
      }
    }

    throw new Error(`${label} failed after retries`);
  }

  const nativeBalance = await provider.getBalance(buyerAddress);
  if (nativeBalance < ethers.parseEther("0.05")) {
    const topUpTx = await sendWithNonceRetry("top-up", async () =>
      deployer.sendTransaction({
        to: buyerAddress,
        value: ethers.parseEther("1.0"),
        nonce: await getLatestNonce(deployer.address),
      })
    );
    await topUpTx.wait();
    ok(`Funded buyer with 1.0 ETH for gas`);
  }

  const mintTx = await sendWithNonceRetry("mint", async () =>
    usdcDeployer.mint(buyerAddress, amount, {
      nonce: await getLatestNonce(deployer.address),
    })
  );
  await mintTx.wait();
  ok(`Minted ${amountUsdc} USDC`);

  const approveTx = await sendWithNonceRetry("approve", async () =>
    usdcBuyer.approve(coreAddress, amount, {
      nonce: await getLatestNonce(buyerAddress),
    })
  );
  await approveTx.wait();
  ok(`Approved SynapseCore`);

  await sleep(500);

  const depositTx = await sendWithNonceRetry("deposit", async () =>
    coreBuyer.deposit(amount, {
      nonce: await getLatestNonce(buyerAddress),
    })
  );
  await depositTx.wait();
  ok(`Deposited on-chain: ${depositTx.hash}`);
  return depositTx.hash;
}

async function waitForGatewayDeposit(token, address, txHash, amountUsdc) {
  const intentKey = `credits-deposit-${Date.now()}`;
  const intent = await apiPost(
    "/v1/balance/deposit/intent",
    { txHash, amountUsdc: Number.parseFloat(amountUsdc) },
    token,
    address,
    intentKey
  );
  if (!intent.response.ok) {
    throw new Error(`deposit intent failed: ${intent.response.status} ${JSON.stringify(intent.body)}`);
  }
  ok(`Deposit intent submitted`);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(2000);
    const sync = await apiGet(`/v1/balance/deposit/sync?txHash=${txHash}`, token, address);
    const syncStatus = String(sync.body.status || "").toUpperCase();
    if (sync.body.confirmed || syncStatus === "CONFIRMED") {
      ok(`Gateway confirmed deposit`);
      return;
    }
    const balance = await apiGet("/v1/balance", token, address);
    const available = Number(balance.body?.balance?.consumerAvailableBalance ?? 0);
    if (available >= Number.parseFloat(amountUsdc) - 0.01) {
      ok(`Balance synced to ${available.toFixed(2)} USDC`);
      return;
    }
  }

  throw new Error(`deposit sync timeout for ${txHash}`);
}

async function getBalanceSnapshot(token, address) {
  const balance = await apiGet("/v1/balance", token, address);
  if (!balance.response.ok) {
    throw new Error(`balance fetch failed: ${balance.response.status}`);
  }
  return {
    available: Number(balance.body?.balance?.consumerAvailableBalance ?? 0),
    pending: Number(balance.body?.balance?.consumerPendingBalance ?? 0),
    raw: balance.body,
  };
}

function buildInitScript(authSession, address) {
  return `
(function() {
  try {
    localStorage.setItem("a2a_auth_session", ${JSON.stringify(authSession)});
    localStorage.setItem("a2a_selected_role", "consumer");
    localStorage.setItem("a2a_role_${address}", "consumer");
  } catch (error) {}

  try {
    localStorage.setItem("wagmi.injected.connected", "true");
    localStorage.removeItem("wagmi.injected.disconnected");
    localStorage.setItem("wagmi.recentConnectorId", JSON.stringify("injected"));
  } catch (error) {}

  const ADDRESS = ${JSON.stringify(address)};
  const CHAIN_ID = ${CHAIN_ID};
  const listeners = {};

  const provider = {
    isMetaMask: true,
    selectedAddress: ADDRESS,
    chainId: "0x" + CHAIN_ID.toString(16),
    networkVersion: String(CHAIN_ID),
    on(event, handler) {
      (listeners[event] = listeners[event] || []).push(handler);
    },
    removeListener(event, handler) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((fn) => fn !== handler);
    },
    removeAllListeners(event) {
      if (event) {
        listeners[event] = [];
        return;
      }
      Object.keys(listeners).forEach((key) => { delete listeners[key]; });
    },
    emit(event, ...args) {
      (listeners[event] || []).forEach((handler) => handler(...args));
    },
    isConnected() {
      return true;
    },
    async request({ method, params = [] }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ADDRESS];
      if (method === "eth_chainId") return "0x" + CHAIN_ID.toString(16);
      if (method === "net_version") return String(CHAIN_ID);
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "wallet_addEthereumChain") return null;
      if (method === "eth_blockNumber") return "0x1388";
      if (method === "eth_getBalance") return "0x8AC7230489E80000";
      if (method === "personal_sign" || method === "eth_sign") {
        const message = params[0];
        if (window.__walletSign__) return window.__walletSign__(message);
        return "0x" + "0".repeat(130);
      }
      if (method === "eth_signTypedData_v4") {
        const message = params[1];
        if (window.__walletSign__) return window.__walletSign__(message);
        return "0x" + "0".repeat(130);
      }
      return null;
    },
    async send(method, params = []) {
      if (typeof method === "object") {
        const result = await this.request(method);
        return { jsonrpc: "2.0", id: method.id, result };
      }
      return this.request({ method, params });
    },
    sendAsync(payload, callback) {
      this.request(payload)
        .then((result) => callback(null, { jsonrpc: "2.0", id: payload.id, result }))
        .catch(callback);
    },
    enable: async function() {
      return [ADDRESS];
    },
  };

  try {
    Object.defineProperty(window, "ethereum", { value: provider, writable: true, configurable: true });
  } catch (error) {
    window.ethereum = provider;
  }

  window.dispatchEvent(new Event("ethereum#initialized"));
})();
`;
}

async function waitForCreditsReady(page) {
  await page.goto(`${FRONTEND_URL}/dashboard/billing/credits`, { waitUntil: "domcontentloaded" });

  await page
    .waitForFunction(
      () => localStorage.getItem("wagmi.store")?.includes('"status":"connected"') ?? false,
      { timeout: 15000 }
    )
    .catch(() => null);

  await page.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const withdrawButton = buttons.find((button) => button.textContent?.trim() === "Withdraw");
    return Boolean(withdrawButton && !withdrawButton.disabled);
  }, { timeout: 30000 });

  await page.waitForTimeout(1500);
}

async function waitForBillingWithdrawRecord(page) {
  await page.goto(`${FRONTEND_URL}/dashboard/billing`, { waitUntil: "domcontentloaded" });

  // Wait for the loading state to clear
  await page
    .waitForFunction(
      () => !document.body.innerText.includes("Loading payments..."),
      { timeout: 20000 }
    )
    .catch(() => null);

  // Wait for at least one Withdraw row to appear in the table
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return text.includes("Withdraw") && !text.includes("Loading payments...");
    },
    { timeout: 20000 }
  ).catch(() => {
    warn("Withdraw row not found in billing page within timeout");
  });

  await page.waitForTimeout(1000);
}

async function waitForBalanceText(page, balanceText) {
  await page.waitForFunction(
    (expectedBalance) => document.body.innerText.includes(expectedBalance),
    balanceText,
    { timeout: 30000 }
  );
}

async function waitForRenderedRemainingBalance(page, balanceText) {
  await page.waitForFunction(
    (expectedBalance) => {
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = globalThis.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
      };

      const cards = Array.from(document.querySelectorAll("div")).filter(
        (element) => isVisible(element) && element.innerText.includes("Remaining balance:")
      );

      return cards.some(
        (card) => !card.querySelector(".animate-pulse") && card.innerText.includes(expectedBalance)
      );
    },
    balanceText,
    { timeout: 30000 }
  );
}

async function takeShot(page, fileName) {
  const filePath = path.join(SCREENSHOT_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: false });
  ok(`Screenshot saved: ${fileName}`);
  return filePath;
}

function getChromeExecutablePath() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function runBrowserFlow(token, address, withdrawAmount) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const wallet = new ethers.Wallet(BUYER_KEY);
  const authSession = JSON.stringify({
    token,
    wallet: address,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  });

  const browser = await chromium.launch({
    headless: true,
    executablePath: getChromeExecutablePath(),
    args: ["--no-sandbox", "--disable-web-security", "--allow-running-insecure-content"],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(buildInitScript(authSession, address));
    await context.exposeFunction("__walletSign__", async (message) => {
      if (typeof message === "string" && message.startsWith("0x")) {
        return wallet.signMessage(ethers.toUtf8String(message));
      }
      return wallet.signMessage(message);
    });

    const page = await context.newPage();
    await waitForCreditsReady(page);
    await waitForRenderedRemainingBalance(page, `$${withdrawAmount.toFixed(2)}`);
    const beforePath = await takeShot(page, "credits-live-before-withdraw.png");

    await page.getByRole("button", { name: "Withdraw", exact: true }).first().click();
    await page.getByText("Withdraw Balance", { exact: true }).waitFor({ timeout: 10000 });
    await page.locator('input[type="number"]').first().fill(withdrawAmount.toFixed(2));
    await page.locator("textarea").fill("E2E credits withdraw validation");

    const modalWithdrawButton = page.locator("button").filter({ hasText: /^Withdraw$/ }).last();
    await modalWithdrawButton.click();
    await page.waitForFunction(() => !document.body.innerText.includes("Withdraw Balance"), { timeout: 15000 });
    await page
      .waitForFunction(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const withdrawButton = buttons.find((button) => button.textContent?.trim() === "Withdraw");
        return Boolean(withdrawButton?.disabled);
      }, { timeout: 15000 })
      .catch(() => null);

    await page.waitForTimeout(1500);
    const afterPath = await takeShot(page, "credits-live-after-withdraw.png");

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForRenderedRemainingBalance(page, "$0.00");
    await page.waitForTimeout(1000);
    const afterRefreshPath = await takeShot(page, "credits-live-after-refresh.png");

    // Navigate to Payments/billing tab to verify withdraw record appears immediately
    await waitForBillingWithdrawRecord(page);
    const billingPath = await takeShot(page, "billing-withdraw-record.png");

    return [beforePath, afterPath, afterRefreshPath, billingPath];
  } finally {
    await browser.close();
  }
}

async function main() {
  section("Credits Deposit + Withdraw Validation");

  const healthChecks = await Promise.all([
    fetch(`${FRONTEND_URL}/dashboard/billing/credits`, { method: "HEAD" }).catch(() => null),
    fetch("http://127.0.0.1:8000/health").catch(() => null),
    fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    }).catch(() => null),
  ]);

  if (!healthChecks[0]?.ok) {
    throw new Error(`frontend unavailable at ${FRONTEND_URL}`);
  }
  if (!healthChecks[1]?.ok) {
    throw new Error(`gateway unavailable at http://127.0.0.1:8000/health`);
  }
  if (!healthChecks[2]?.ok) {
    throw new Error(`rpc unavailable at ${RPC_URL}`);
  }
  ok(`Frontend, gateway, and chain are reachable`);

  section("Authenticate");
  const { token, address } = await authenticate(BUYER_KEY);

  section("Deposit");
  const txHash = await fundOnChain(BUYER_KEY, DEPOSIT_USDC);
  await waitForGatewayDeposit(token, address, txHash, DEPOSIT_USDC);
  const balanceBefore = await getBalanceSnapshot(token, address);
  ok(`Balance before withdraw: available=${balanceBefore.available.toFixed(2)}, pending=${balanceBefore.pending.toFixed(2)}`);
  if (balanceBefore.available < 1) {
    throw new Error(`available balance too low after deposit: ${balanceBefore.available}`);
  }

  section("Browser Withdraw");
  const withdrawAmount = Math.floor(balanceBefore.available * 100) / 100;
  const screenshots = await runBrowserFlow(token, address, withdrawAmount);

  section("Backend Verification");
  let balanceAfter = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(1000);
    balanceAfter = await getBalanceSnapshot(token, address);
    if (balanceAfter.available <= 0.01) {
      break;
    }
  }
  const withdrawals = await apiGet("/v1/balance/consumer/withdrawals", token, address);
  const withdrawalList = withdrawals.body.withdrawals || [];
  ok(`Balance after withdraw: available=${balanceAfter.available.toFixed(2)}, pending=${balanceAfter.pending.toFixed(2)}`);
  ok(`Withdrawal records: ${withdrawalList.length}`);

  // Verify billing page withdraw record
  const latestWithdrawal = withdrawalList.find(
    (w) => w.amountUsdc >= withdrawAmount - 0.01
  );
  if (latestWithdrawal) {
    ok(`Billing record confirmed: id=${latestWithdrawal.id.slice(0, 8)}... status=${latestWithdrawal.status} amount=$${latestWithdrawal.amountUsdc}`);
  } else {
    warn(`No matching withdrawal record found in billing list (expected amount ~$${withdrawAmount})`);
  }

  console.log("\nScreenshots:");
  screenshots.forEach((filePath) => console.log(`  ${filePath}`));

  if (withdrawalList.length === 0) {
    throw new Error(`no withdrawal records found after withdraw`);
  }
  if (balanceAfter.available > 0.01) {
    throw new Error(`withdraw did not reduce available balance to zero-ish: ${balanceAfter.available}`);
  }
}

main().catch((error) => {
  fail(error.stack || error.message || String(error));
  process.exitCode = 1;
});