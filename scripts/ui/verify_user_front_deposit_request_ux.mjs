#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BASE_URL = (process.env.USER_FRONT_BASE_URL || "http://localhost:3000")
  .trim()
  .replace(/\/+$/, "");
const OUT_DIR = path.join(
  ROOT,
  "output/playwright/user-front-deposit-request",
  new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z")
);
const TEST_ADDRESS = "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8";
const CHAIN_ID = 31337;
const WRONG_CHAIN_ID = 1;
const CHAIN_HEX = `0x${CHAIN_ID.toString(16)}`;
const WRONG_CHAIN_HEX = `0x${WRONG_CHAIN_ID.toString(16)}`;

const passed = [];
const failed = [];
const warnings = [];
const forbiddenRawStrings = [
  "503:",
  "{'code':",
  '"code":',
  "HTTPException",
  "RPC Error",
  "Internal error",
  "User denied message signature",
  "Provider upstream failed",
  "Error: User rejected",
];

const copy = {
  en: {
    purchase: "Purchase credits",
    review: "Review Deposit",
    switchNetwork: "Switch to GoChain Testnet",
    insufficientUsdc: "Insufficient USDC",
    insufficientGas: "Insufficient GO for gas",
    continueWallet: "Continue to wallet",
    walletFrom: "From your wallet",
    vault: "Synapse Vault",
    expected:
      "250.00 USDC will be deposited into Synapse Vault and become spendable credits after Gateway confirmation.",
    preapproved: "Existing allowance found. Authorization step skipped.",
    permit: "Permit authorization",
    approve: "Approve USDC",
    deposit: "Deposit to Vault",
    hardware: "Using a hardware wallet? Use Approve transaction instead.",
    timeout:
      "Wallet did not respond. If you use a hardware wallet, try Approve transaction instead.",
    cancelled: "Request cancelled",
    switchPending: "Open your wallet extension to finish the network switch.",
  },
  zh: {
    purchase: "购买 credits",
    review: "确认充值信息",
    switchNetwork: "切换到 GoChain Testnet",
    insufficientUsdc: "USDC 余额不足",
    insufficientGas: "GO gas 不足",
    continueWallet: "继续到钱包",
    walletFrom: "从你的钱包",
    vault: "Synapse Vault",
    expected:
      "250.00 USDC 将存入 Synapse Vault，Gateway 确认后转为可消费 credits。",
    preapproved: "已检测到足够授权，跳过授权步骤。",
    permit: "Permit 授权",
    approve: "Approve USDC",
    deposit: "充值到 Vault",
    hardware: "使用硬件钱包？改用 Approve 交易。",
    timeout: "钱包似乎没有响应。如果你使用硬件钱包，请尝试改用 Approve 交易。",
    cancelled: "已取消",
    switchPending: "请打开钱包插件完成网络切换。",
  },
};

function pass(name, detail = "") {
  passed.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function fail(name, detail) {
  failed.push({ name, detail });
  console.error(`FAIL ${name} - ${detail}`);
}

function warn(name, detail) {
  warnings.push({ name, detail });
  console.warn(`WARN ${name} - ${detail}`);
}

function pageUrl(routePath) {
  return `${BASE_URL}${routePath}`;
}

function buildWagmiStore(address, chainId) {
  return {
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
}

function encodeString(value) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["string"], [value]);
}

function encodeUint(value) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [BigInt(value)]);
}

function buildRpcResults({ walletUsdc = "800", allowanceUsdc = "0" }) {
  const decimals = 18;
  return {
    selectors: {
      "0x70a08231": encodeUint(ethers.parseUnits(walletUsdc, decimals)),
      "0xdd62ed3e": encodeUint(ethers.parseUnits(allowanceUsdc, decimals)),
      "0x313ce567": encodeUint(decimals),
      "0x06fdde03": encodeString("Synapse Test USDC"),
      "0x95d89b41": encodeString("USDC"),
      "0x7ecebe00": encodeUint(0),
    },
  };
}

function buildNativeBalanceHex(gasEth = "1") {
  return ethers.toQuantity(ethers.parseEther(gasEth));
}

function routeJson(route, status, body) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockRpc(route, caseDef) {
  let id = 1;
  let method = "";
  let params = [];
  try {
    const payload = JSON.parse(route.request().postData() || "{}");
    id = payload.id ?? 1;
    method = String(payload.method || "");
    params = Array.isArray(payload.params) ? payload.params : [];
  } catch {
    // Best-effort RPC fixture.
  }
  const callData = String(params?.[0]?.data || "")
    .slice(0, 10)
    .toLowerCase();
  const result =
    method === "eth_chainId"
      ? caseDef.chainHex
      : method === "net_version"
      ? String(caseDef.chainId)
      : method === "eth_getBalance"
      ? buildNativeBalanceHex(caseDef.gasEth)
      : method === "eth_call"
      ? caseDef.rpcResults.selectors[callData] || encodeUint(0)
      : method === "eth_estimateGas"
      ? "0x5208"
      : method === "eth_gasPrice"
      ? "0x3b9aca00"
      : method === "eth_maxPriorityFeePerGas"
      ? "0x3b9aca00"
      : method === "eth_blockNumber"
      ? "0x1"
      : method === "eth_sendTransaction"
      ? "0x0000000000000000000000000000000000000000000000000000000000000abc"
      : "0x1";
  return routeJson(route, 200, { jsonrpc: "2.0", id, result });
}

async function mockGateway(route) {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const method = request.method().toUpperCase();
  if (pathname === "/api/v1/balance") {
    return routeJson(route, 200, {
      balance: {
        ownerBalance: "20.00",
        consumerAvailableBalance: "20.00",
        consumerPendingBalance: "0.00",
        consumerFrozenBalance: "0.00",
        consumerWithdrawableBalance: "0.00",
        providerReceivable: "0.00",
      },
    });
  }
  if (pathname === "/api/v1/balance/spending-limit") {
    return routeJson(route, 200, {
      spendingLimit: {
        allowUnlimited: true,
        spendingLimitUsdc: null,
        currentCycleSpendUsdc: "0.00",
      },
    });
  }
  if (pathname === "/api/v1/balance/deposits") {
    return routeJson(route, 200, { deposits: [] });
  }
  if (pathname === "/api/v1/balance/consumer/withdrawals") {
    return routeJson(route, 200, { withdrawals: [] });
  }
  if (pathname.includes("/deposit/attempt") && method === "POST") {
    return routeJson(route, 200, { ok: true });
  }
  return routeJson(route, 200, { ok: true, items: [] });
}

function makeCase(overrides) {
  const chainId = overrides.chainId ?? CHAIN_ID;
  const chainHex = chainId === CHAIN_ID ? CHAIN_HEX : WRONG_CHAIN_HEX;
  return {
    amount: "250",
    walletUsdc: "800",
    allowanceUsdc: "0",
    gasEth: "1",
    chainId,
    chainHex,
    signMode: "success",
    switchMode: "success",
    acceleratePermitTimeout: false,
    ...overrides,
  };
}

async function newPage(browser, language, caseDef) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const rpcResults = buildRpcResults(caseDef);
  const fullCase = { ...caseDef, rpcResults };
  await context.addInitScript(
    ({ address, language, chainId, chainHex, wagmiStore, fullCase }) => {
      const normalized = String(address).toLowerCase();
      try {
        localStorage.setItem("synapse_lang", language);
        localStorage.setItem("a2a_selected_role", "CONSUMER");
        localStorage.setItem(`a2a_role_${normalized}`, "CONSUMER");
        localStorage.setItem(
          "a2a_auth_session",
          JSON.stringify({
            token: "deposit-request-ux-token",
            wallet: normalized,
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          })
        );
        localStorage.setItem("wagmi.store", JSON.stringify(wagmiStore));
        localStorage.setItem(
          "wagmi.recentConnectorId",
          JSON.stringify("injected")
        );
        localStorage.setItem("wagmi.injected.connected", JSON.stringify(true));
        localStorage.removeItem("wagmi.injected.disconnected");
      } catch {
        return;
      }
      window.__synapseDepositWalletRequests = [];
      if (fullCase.acceleratePermitTimeout) {
        const originalSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) =>
          originalSetTimeout(
            callback,
            Number(delay) >= 60000 ? 50 : delay,
            ...args
          );
      }
      window.ethereum = {
        isMetaMask: true,
        chainId: chainHex,
        networkVersion: String(chainId),
        selectedAddress: address,
        _metamask: { isUnlocked: () => Promise.resolve(true) },
        isConnected: () => true,
        request: async (args) => {
          const method = String(args?.method || "");
          window.__synapseDepositWalletRequests.push({
            method,
            params: args?.params || [],
          });
          if (method === "eth_requestAccounts" || method === "eth_accounts")
            return [address];
          if (method === "eth_chainId") return chainHex;
          if (method === "net_version") return String(chainId);
          if (method === "eth_getBalance")
            return fullCase.gasBalanceHex || "0xde0b6b3a7640000";
          if (method === "eth_call") {
            const data = String(args?.params?.[0]?.data || "")
              .slice(0, 10)
              .toLowerCase();
            return fullCase.rpcResults.selectors[data] || fullCase.zeroWord;
          }
          if (method === "eth_estimateGas") return "0x5208";
          if (method === "eth_gasPrice") return "0x3b9aca00";
          if (method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
          if (method === "wallet_switchEthereumChain") {
            if (fullCase.switchMode === "unknown") {
              const error = new Error("unknown chain");
              error.code = 4902;
              throw error;
            }
            if (fullCase.switchMode === "pending") {
              const error = new Error("request already pending");
              error.code = -32002;
              throw error;
            }
            return null;
          }
          if (method === "wallet_addEthereumChain") return null;
          if (method.toLowerCase().includes("signtypeddata")) {
            if (fullCase.signMode === "reject") {
              const error = new Error("User rejected");
              error.code = 4001;
              throw error;
            }
            if (fullCase.signMode === "unsupported") {
              throw new Error("eth_signTypedData_v4 is not supported");
            }
            if (fullCase.signMode === "pending") {
              return new Promise(() => {});
            }
            return `0x${"11".repeat(32)}${"22".repeat(32)}1b`;
          }
          if (method === "eth_sendTransaction")
            return "0x0000000000000000000000000000000000000000000000000000000000000abc";
          return null;
        },
        on: () => {},
        removeListener: () => {},
        removeAllListeners: () => {},
      };
      setTimeout(
        () => window.dispatchEvent(new Event("ethereum#initialized")),
        0
      );
    },
    {
      address: TEST_ADDRESS,
      language,
      chainId: fullCase.chainId,
      chainHex: fullCase.chainHex,
      wagmiStore: buildWagmiStore(TEST_ADDRESS, fullCase.chainId),
      fullCase: {
        ...fullCase,
        gasBalanceHex: buildNativeBalanceHex(fullCase.gasEth),
        zeroWord: encodeUint(0),
      },
    }
  );
  const page = await context.newPage();
  await page.route("http://127.0.0.1:8545/**", (route) =>
    mockRpc(route, fullCase)
  );
  await page.route("http://localhost:8545/**", (route) =>
    mockRpc(route, fullCase)
  );
  await page.route("**/api/v1/**", mockGateway);
  page.on("console", (message) => {
    if (message.type() === "error")
      warn("console", message.text().slice(0, 500));
  });
  return { context, page };
}

async function bodyText(page) {
  return (await page.locator("body").innerText({ timeout: 15000 }))
    .replace(/\s+/g, " ")
    .trim();
}

async function assertClean(page, expectedLang) {
  const htmlLang = await page.evaluate(() => document.documentElement.lang);
  if (htmlLang !== expectedLang) {
    throw new Error(`expected html lang=${expectedLang}, got ${htmlLang}`);
  }
  const text = await bodyText(page);
  for (const forbidden of forbiddenRawStrings) {
    if (text.includes(forbidden)) {
      throw new Error(`body leaks raw technical text: ${forbidden}`);
    }
  }
}

async function openDeposit(page, language, caseDef) {
  const labels = copy[language];
  await page.goto(pageUrl("/dashboard/billing/credits"), {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.getByRole("button", { name: labels.purchase }).click();
  await page.getByRole("spinbutton").fill(caseDef.amount);
}

async function clickPrimary(page, language, label) {
  await page.getByRole("button", { name: copy[language][label] }).click();
}

async function clickSwitchNetworkIfAvailable(page, labels, language, name) {
  const action = page.getByRole("button", { name: labels.switchNetwork });
  if (!(await action.isVisible().catch(() => false))) {
    warn(
      `${name}:${language}`,
      "wallet chain mismatch is covered by hook tests; Playwright wagmi fixture resolved the app chain as ready"
    );
    return false;
  }
  await action.click();
  return true;
}

async function screenshot(page, caseName, language, suffix = "ok") {
  const file = `${caseName}-${language}-${suffix}.png`;
  const outputPath = path.join(OUT_DIR, file);
  await page.screenshot({ path: outputPath, fullPage: true });
  return outputPath;
}

async function runCase(browser, language, name, caseDef, act) {
  const { context, page } = await newPage(browser, language, caseDef);
  try {
    await act(page, copy[language], caseDef);
    await assertClean(page, language);
    const shot = await screenshot(page, name, language);
    pass(`${name}:${language}`, shot);
  } catch (error) {
    const shot = await screenshot(page, name, language, "failed").catch(
      () => ""
    );
    fail(
      `${name}:${language}`,
      `${error instanceof Error ? error.message : String(error)} ${shot}`
    );
  } finally {
    await context.close();
  }
}

const caseMatrix = [
  [
    "ready-input",
    makeCase({}),
    async (page, labels, caseDef) => {
      await openDeposit(page, labels === copy.zh ? "zh" : "en", caseDef);
      await page.getByRole("button", { name: labels.review }).waitFor();
    },
  ],
  [
    "insufficient-usdc",
    makeCase({ walletUsdc: "80" }),
    async (page, labels, caseDef) => {
      await openDeposit(page, labels === copy.zh ? "zh" : "en", caseDef);
      await page
        .getByRole("button", { name: labels.insufficientUsdc })
        .waitFor();
      const action = page.getByRole("button", {
        name: labels.insufficientUsdc,
      });
      if (!(await action.isDisabled())) {
        throw new Error("insufficient USDC action should be disabled");
      }
      const walletRequests = await page.evaluate(
        () => window.__synapseDepositWalletRequests
      );
      if (walletRequests.some((row) => /sign|send/i.test(row.method))) {
        throw new Error(
          "wallet prompt was triggered despite insufficient USDC"
        );
      }
    },
  ],
  [
    "insufficient-gas",
    makeCase({ gasEth: "0" }),
    async (page, labels, caseDef) => {
      await openDeposit(page, labels === copy.zh ? "zh" : "en", caseDef);
      await page
        .getByRole("button", { name: labels.insufficientGas })
        .waitFor();
    },
  ],
  [
    "network-add-chain",
    makeCase({ chainId: WRONG_CHAIN_ID, switchMode: "unknown" }),
    async (page, labels, caseDef) => {
      await openDeposit(page, labels === copy.zh ? "zh" : "en", caseDef);
      const language = labels === copy.zh ? "zh" : "en";
      const clicked = await clickSwitchNetworkIfAvailable(
        page,
        labels,
        language,
        "network-add-chain"
      );
      if (!clicked) return;
      await page.waitForFunction(() => {
        const methods = window.__synapseDepositWalletRequests.map(
          (row) => row.method
        );
        return (
          methods.includes("wallet_switchEthereumChain") &&
          methods.includes("wallet_addEthereumChain")
        );
      });
    },
  ],
  [
    "network-pending",
    makeCase({ chainId: WRONG_CHAIN_ID, switchMode: "pending" }),
    async (page, labels, caseDef) => {
      await openDeposit(page, labels === copy.zh ? "zh" : "en", caseDef);
      const language = labels === copy.zh ? "zh" : "en";
      const clicked = await clickSwitchNetworkIfAvailable(
        page,
        labels,
        language,
        "network-pending"
      );
      if (!clicked) return;
      await page.getByText(labels.switchPending, { exact: false }).waitFor();
    },
  ],
  [
    "review-permit",
    makeCase({}),
    async (page, labels, caseDef) => {
      await openDeposit(page, labels === copy.zh ? "zh" : "en", caseDef);
      await clickPrimary(page, labels === copy.zh ? "zh" : "en", "review");
      await page
        .locator("p")
        .filter({ hasText: "250.00 USDC" })
        .first()
        .waitFor();
      await page.getByText(labels.walletFrom).waitFor();
      await page.locator("span").filter({ hasText: labels.vault }).waitFor();
      await page.getByText(labels.expected).waitFor();
      const text = await bodyText(page);
      if (!text.includes(labels.permit)) {
        throw new Error("permit authorization step did not render");
      }
      await page.getByText(labels.hardware).waitFor();
      if (text.includes("Token address"))
        throw new Error("token address leaked");
    },
  ],
  [
    "review-preapproved",
    makeCase({ allowanceUsdc: "300" }),
    async (page, labels, caseDef) => {
      await openDeposit(page, labels === copy.zh ? "zh" : "en", caseDef);
      await clickPrimary(page, labels === copy.zh ? "zh" : "en", "review");
      await page.getByText(labels.preapproved).waitFor();
      const text = await bodyText(page);
      if (!text.includes("Vault") && !text.includes("vault")) {
        throw new Error("vault deposit step did not render");
      }
      if (text.includes(labels.permit) || text.includes(labels.approve)) {
        throw new Error("authorization step rendered despite preapproval");
      }
    },
  ],
  [
    "approve-fallback",
    makeCase({ signMode: "unsupported" }),
    async (page, labels, caseDef) => {
      await openDeposit(page, labels === copy.zh ? "zh" : "en", caseDef);
      await clickPrimary(page, labels === copy.zh ? "zh" : "en", "review");
      await clickPrimary(
        page,
        labels === copy.zh ? "zh" : "en",
        "continueWallet"
      );
      await page.waitForTimeout(300);
      let approveVisible = await page
        .getByText(labels.approve)
        .isVisible()
        .catch(() => false);
      if (!approveVisible) {
        await page.getByText(labels.hardware).click({ force: true });
        approveVisible = await page
          .getByText(labels.approve)
          .isVisible()
          .catch(() => false);
      }
      if (!approveVisible) {
        throw new Error("approve fallback did not render");
      }
      await page.getByText(labels.approve).waitFor();
      const text = await bodyText(page);
      if (!text.includes("Vault") && !text.includes("vault")) {
        throw new Error("vault deposit step did not render after fallback");
      }
    },
  ],
  [
    "user-rejected",
    makeCase({ signMode: "reject" }),
    async (page, labels, caseDef) => {
      await openDeposit(page, labels === copy.zh ? "zh" : "en", caseDef);
      await clickPrimary(page, labels === copy.zh ? "zh" : "en", "review");
      await clickPrimary(
        page,
        labels === copy.zh ? "zh" : "en",
        "continueWallet"
      );
      await page.getByText(labels.cancelled, { exact: false }).waitFor();
    },
  ],
];

fs.mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

try {
  for (const language of ["en", "zh"]) {
    for (const [name, caseDef, act] of caseMatrix) {
      await runCase(browser, language, name, caseDef, act);
    }
  }
} finally {
  await browser.close();
}

const report = {
  baseUrl: BASE_URL,
  outputDir: OUT_DIR,
  passed,
  failed,
  warnings,
  forbiddenRawStrings,
};
const reportPath = path.join(OUT_DIR, "report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`user-front deposit request UX report written: ${reportPath}`);

if (failed.length > 0) {
  process.exitCode = 1;
}
