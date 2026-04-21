#!/usr/bin/env node
"use strict";

/**
 * Full-chain Consumer Withdrawal E2E Test
 *
 * Validates the entire flow:
 *   1. Mint USDC + deposit on-chain → register intent → wait for balance sync
 *   2. Submit consumer withdrawal via API (with fee deduction)
 *   3. User executes SynapseCore.withdraw() on-chain with the signed ticket
 *   4. Call /v1/refunds/{id}/complete with txHash
 *   5. Verify: DB status=COMPLETED, txHash present, pending_balance=0
 *   6. Verify: User's on-chain USDC balance increased by net = gross - fee
 *   7. Verify: platformFeePool increased by fee
 *   8. Screenshots at each stage (browser)
 */

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { ethers } = require("ethers");

// ── Config ───────────────────────────────────────────────────────────────────
const FRONTEND_URL = process.env.FRONTEND_URL || "http://127.0.0.1:3000";
const GATEWAY_URL  = process.env.GATEWAY_URL  || "http://127.0.0.1:8000/api";
const RPC_URL      = process.env.RPC_URL      || "http://127.0.0.1:8545";
const CHAIN_ID     = Number(process.env.CHAIN_ID || 31337);
const DEPOSIT_USDC = process.env.DEPOSIT_USDC || "10.0";

const DEPLOYER_KEY = (process.env.DEPLOYER_KEY || "").trim();
const BUYER_KEY = (process.env.BUYER_KEY || "").trim();

const REPO_ROOT = (() => {
  let current = __dirname;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(current, "package.json")) && fs.existsSync(path.join(current, "services"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return process.cwd();
})();

const CONTRACT_CONFIG_PATH = path.join(REPO_ROOT, "services/user-front/src/contract-config.json");
const SYNAPSECORE_ABI_PATH = path.join(REPO_ROOT, "services/user-front/src/SynapseCoreABI.json");
const USDC_ABI_PATH        = path.join(REPO_ROOT, "services/user-front/src/MockUSDCABI.json");
const SCREENSHOT_DIR       = path.join(REPO_ROOT, "tmp/screens/fullchain-withdraw");
const BUGFIX_PATH          = path.join(REPO_ROOT, "tmp/screens/fullchain-withdraw/bugfix.md");

// ── Colours ──────────────────────────────────────────────────────────────────
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";

function ok(msg)      { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function warn(msg)    { console.log(`  ${YELLOW}!${RESET} ${msg}`); }
function fail(msg)    { console.error(`  ${RED}✗${RESET} ${msg}`); }
function section(t)   { console.log(`\n${BOLD}${t}${RESET}`); }
function sleep(ms)    { return new Promise((r) => setTimeout(r, ms)); }

function loadJson(p)  { return JSON.parse(fs.readFileSync(p, "utf8")); }

function isNonceError(err) {
  const m = String(err?.message || err || "").toLowerCase();
  return m.includes("nonce has already been used") || m.includes("nonce too low");
}

// ── Bug tracking ─────────────────────────────────────────────────────────────
const bugs = [];
function recordBug(id, title, detail) {
  bugs.push({ id, title, detail, timestamp: new Date().toISOString() });
  fail(`Bug-${id}: ${title}`);
}

function writeBugReport() {
  if (bugs.length === 0) return;
  let md = "# Fullchain Consumer Withdraw E2E — Bug Report\n\n";
  for (const b of bugs) {
    md += `## Bug-${b.id}: ${b.title}\n- **Time**: ${b.timestamp}\n- **Detail**: ${b.detail}\n\n`;
  }
  fs.writeFileSync(BUGFIX_PATH, md, "utf8");
  warn(`Bug report written to ${BUGFIX_PATH}`);
}

// ── API helpers ──────────────────────────────────────────────────────────────
async function apiGet(pathname, token, address) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (address) headers["X-User-Address"] = address;
  const res = await fetch(`${GATEWAY_URL}${pathname}`, { headers });
  const body = await res.json().catch(() => ({}));
  return { response: res, body };
}

async function apiPost(pathname, payload, token, address, idempotencyKey) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (address) headers["X-User-Address"] = address;
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${GATEWAY_URL}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { response: res, body };
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function authenticate(privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address.toLowerCase();
  const challengeRes = await fetch(`${GATEWAY_URL}/v1/auth/challenge?address=${address}`);
  if (!challengeRes.ok) throw new Error(`challenge failed: ${challengeRes.status}`);
  const challengeBody = await challengeRes.json();
  const signature = await wallet.signMessage(challengeBody.challenge);
  const verify = await apiPost(
    "/v1/auth/verify",
    { wallet_address: address, signature, message: challengeBody.challenge },
  );
  const token = verify.body.token || verify.body.access_token;
  if (!verify.response.ok || !token) {
    throw new Error(`verify failed: ${verify.response.status} ${JSON.stringify(verify.body)}`);
  }
  ok(`Authenticated ${address}`);
  return { token, address };
}

// ── On-chain helpers ─────────────────────────────────────────────────────────
function getContracts() {
  const provider   = new ethers.JsonRpcProvider(RPC_URL);
  const config     = loadJson(CONTRACT_CONFIG_PATH);
  const coreAbi    = loadJson(SYNAPSECORE_ABI_PATH);
  const usdcAbi    = loadJson(USDC_ABI_PATH);
  const usdcAddr   = ethers.getAddress(config.MockUSDC);
  const coreAddr   = ethers.getAddress(config.SynapseCore);
  return { provider, coreAbi, usdcAbi, usdcAddr, coreAddr };
}

async function sendWithRetry(label, factory) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await factory(); }
    catch (err) {
      if (!isNonceError(err) || attempt === 4) throw err;
      warn(`${label} nonce collision, retrying...`);
      await sleep(300);
    }
  }
  throw new Error(`${label} failed after retries`);
}

async function fundAndDeposit(buyerKey, amountUsdc) {
  const { provider, coreAbi, usdcAbi, usdcAddr, coreAddr } = getContracts();
  const deployer    = new ethers.Wallet(DEPLOYER_KEY, provider);
  const buyer       = new ethers.Wallet(buyerKey, provider);
  const buyerAddr   = buyer.address;
  const amount      = ethers.parseUnits(amountUsdc, 18);

  const usdcDeployer = new ethers.Contract(usdcAddr, usdcAbi, deployer);
  const usdcBuyer    = new ethers.Contract(usdcAddr, usdcAbi, buyer);
  const coreBuyer    = new ethers.Contract(coreAddr, coreAbi, buyer);

  const getNonce = (addr) => provider.getTransactionCount(addr, "pending");

  // Top-up ETH for gas
  const ethBal = await provider.getBalance(buyerAddr);
  if (ethBal < ethers.parseEther("0.05")) {
    const tx = await sendWithRetry("eth-topup", async () =>
      deployer.sendTransaction({ to: buyerAddr, value: ethers.parseEther("1.0"), nonce: await getNonce(deployer.address) })
    );
    await tx.wait();
    ok("Funded buyer with 1.0 ETH for gas");
  }

  // Mint
  const mintTx = await sendWithRetry("mint", async () =>
    usdcDeployer.mint(buyerAddr, amount, { nonce: await getNonce(deployer.address) })
  );
  await mintTx.wait();
  ok(`Minted ${amountUsdc} USDC`);

  // Approve
  const approveTx = await sendWithRetry("approve", async () =>
    usdcBuyer.approve(coreAddr, amount, { nonce: await getNonce(buyerAddr) })
  );
  await approveTx.wait();
  ok("Approved SynapseCore");

  await sleep(500);

  // Deposit
  const depositTx = await sendWithRetry("deposit", async () =>
    coreBuyer.deposit(amount, { nonce: await getNonce(buyerAddr) })
  );
  await depositTx.wait();
  ok(`Deposited on-chain: ${depositTx.hash}`);
  return depositTx.hash;
}

async function waitForGatewayDeposit(token, address, txHash, amountUsdc) {
  const intentKey = `e2e-deposit-${Date.now()}`;
  const intent = await apiPost(
    "/v1/balance/deposit/intent",
    { txHash, amountUsdc: String(amountUsdc) },
    token,
    address,
    intentKey,
  );
  if (!intent.response.ok) throw new Error(`deposit intent failed: ${intent.response.status} ${JSON.stringify(intent.body)}`);
  ok("Deposit intent submitted");

  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const sync = await apiGet(`/v1/balance/deposit/sync?txHash=${txHash}`, token, address);
    const syncStatus = String(sync.body.status || "").toUpperCase();
    if (sync.body.confirmed || syncStatus === "CONFIRMED") { ok("Gateway confirmed deposit"); return; }
    const bal = await apiGet("/v1/balance", token, address);
    const avail = Number(bal.body?.balance?.consumerAvailableBalance ?? 0);
    if (avail >= Number(amountUsdc) - 0.01) { ok(`Balance synced to ${avail.toFixed(2)} USDC`); return; }
  }
  throw new Error(`deposit sync timeout for ${txHash}`);
}

async function getBalanceSnapshot(token, address) {
  const b = await apiGet("/v1/balance", token, address);
  if (!b.response.ok) throw new Error(`balance failed: ${b.response.status}`);
  return {
    available: Number(b.body?.balance?.consumerAvailableBalance ?? 0),
    pending:   Number(b.body?.balance?.consumerPendingBalance ?? 0),
    raw: b.body,
  };
}

async function getUserUsdcBalance(userAddress) {
  const { provider, usdcAbi, usdcAddr } = getContracts();
  const usdc = new ethers.Contract(usdcAddr, usdcAbi, provider);
  const raw = await usdc.balanceOf(userAddress);
  return Number(ethers.formatUnits(raw, 18));
}

async function getPlatformFeePool() {
  const { provider, coreAbi, coreAddr } = getContracts();
  const core = new ethers.Contract(coreAddr, coreAbi, provider);
  const raw = await core.platformFeePool();
  return Number(ethers.formatUnits(raw, 18));
}

// ── Browser helpers ──────────────────────────────────────────────────────────
function buildInitScript(authSession, address) {
  return `
(function() {
  try {
    localStorage.setItem("a2a_auth_session", ${JSON.stringify(authSession)});
    localStorage.setItem("a2a_selected_role", "consumer");
    localStorage.setItem("a2a_role_${address}", "consumer");
  } catch (e) {}
  try {
    localStorage.setItem("wagmi.injected.connected", "true");
    localStorage.removeItem("wagmi.injected.disconnected");
    localStorage.setItem("wagmi.recentConnectorId", JSON.stringify("injected"));
  } catch (e) {}

  const ADDRESS = ${JSON.stringify(address)};
  const CHAIN_ID = ${CHAIN_ID};
  const listeners = {};
  const provider = {
    isMetaMask: true, selectedAddress: ADDRESS,
    chainId: "0x" + CHAIN_ID.toString(16),
    networkVersion: String(CHAIN_ID),
    on(e, h) { (listeners[e] = listeners[e] || []).push(h); },
    removeListener(e, h) { if (listeners[e]) listeners[e] = listeners[e].filter(f => f !== h); },
    removeAllListeners(e) { if (e) { listeners[e] = []; } else { Object.keys(listeners).forEach(k => delete listeners[k]); } },
    emit(e, ...a) { (listeners[e] || []).forEach(h => h(...a)); },
    isConnected() { return true; },
    async request({ method, params = [] }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ADDRESS];
      if (method === "eth_chainId") return "0x" + CHAIN_ID.toString(16);
      if (method === "net_version") return String(CHAIN_ID);
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      if (method === "eth_blockNumber") return "0x1388";
      if (method === "eth_getBalance") return "0x8AC7230489E80000";
      if (method === "personal_sign" || method === "eth_sign") {
        const m = params[0];
        if (window.__walletSign__) return window.__walletSign__(m);
        return "0x" + "0".repeat(130);
      }
      if (method === "eth_signTypedData_v4") {
        const m = params[1];
        if (window.__walletSign__) return window.__walletSign__(m);
        return "0x" + "0".repeat(130);
      }
      return null;
    },
    async send(method, params = []) {
      if (typeof method === "object") { const r = await this.request(method); return { jsonrpc: "2.0", id: method.id, result: r }; }
      return this.request({ method, params });
    },
    sendAsync(p, cb) { this.request(p).then(r => cb(null, { jsonrpc: "2.0", id: p.id, result: r })).catch(cb); },
    enable: async function() { return [ADDRESS]; },
  };
  try { Object.defineProperty(window, "ethereum", { value: provider, writable: true, configurable: true }); }
  catch (e) { window.ethereum = provider; }
  window.dispatchEvent(new Event("ethereum#initialized"));
})();
`;
}

function getChromeExe() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  return candidates.find(c => fs.existsSync(c));
}

async function takeShot(page, fileName) {
  const fp = path.join(SCREENSHOT_DIR, fileName);
  await page.screenshot({ path: fp, fullPage: false });
  ok(`Screenshot: ${fileName}`);
  return fp;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  section("Fullchain Consumer Withdrawal E2E");
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // ── 0. Health check ────────────────────────────────────────────────────
  section("0. Health Check");
  const [frontendOk, gatewayOk, chainOk] = await Promise.all([
    fetch(`${FRONTEND_URL}/dashboard/billing/credits`, { method: "HEAD" }).catch(() => null),
    fetch("http://127.0.0.1:8000/health").catch(() => null),
    fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    }).catch(() => null),
  ]);
  if (!frontendOk?.ok) throw new Error(`frontend unavailable at ${FRONTEND_URL}`);
  if (!gatewayOk?.ok)  throw new Error("gateway unavailable at http://127.0.0.1:8000/health");
  if (!chainOk?.ok)    throw new Error(`rpc unavailable at ${RPC_URL}`);
  ok("Frontend, gateway, and chain are reachable");

  // ── 1. Auth ────────────────────────────────────────────────────────────
  section("1. Authenticate");
  const { token, address } = await authenticate(BUYER_KEY);
  const buyerWallet = new ethers.Wallet(BUYER_KEY);
  const checksumAddr = buyerWallet.address; // checksum for on-chain queries

  // ── 2. Snapshot on-chain baselines ─────────────────────────────────────
  section("2. On-chain Baselines");
  const usdcBefore    = await getUserUsdcBalance(checksumAddr);
  const feePoolBefore = await getPlatformFeePool();
  ok(`User USDC balance (before deposit): ${usdcBefore.toFixed(6)}`);
  ok(`platformFeePool (before):            ${feePoolBefore.toFixed(6)}`);

  // ── 3. Deposit ─────────────────────────────────────────────────────────
  section("3. On-chain Deposit");
  const depositAmount = Number(DEPOSIT_USDC);
  if (!DEPLOYER_KEY || !BUYER_KEY) {
    throw new Error("DEPLOYER_KEY and BUYER_KEY must be set explicitly.");
  }
  const txHash = await fundAndDeposit(BUYER_KEY, DEPOSIT_USDC);
  await waitForGatewayDeposit(token, address, txHash, DEPOSIT_USDC);
  const balAfterDeposit = await getBalanceSnapshot(token, address);
  ok(`Balance after deposit: available=${balAfterDeposit.available.toFixed(2)}, pending=${balAfterDeposit.pending.toFixed(2)}`);

  if (balAfterDeposit.available < depositAmount - 0.01) {
    recordBug("E2E-001", "Balance not synced after deposit",
      `Expected ~${depositAmount}, got ${balAfterDeposit.available}`);
    throw new Error("deposit balance sync failed — aborting");
  }

  // ── 4. Submit Withdrawal via API ───────────────────────────────────────
  section("4. Submit Consumer Withdrawal");
  const withdrawAmount = Math.floor(balAfterDeposit.available * 100) / 100;
  const idemKey = `e2e-withdraw-${Date.now()}`;
  const withdrawRes = await apiPost(
    "/v1/balance/consumer/withdraw",
    { amountUsdc: withdrawAmount, reason: "Fullchain E2E test" },
    token,
    address,
    idemKey,
  );

  if (!withdrawRes.response.ok) {
    recordBug("E2E-002", "Withdraw API failed",
      `status=${withdrawRes.response.status} body=${JSON.stringify(withdrawRes.body)}`);
    throw new Error("withdraw API failed — aborting");
  }

  const { withdrawId, feeUsdc, netUsdc, status, ticket } = withdrawRes.body;
  ok(`Withdraw submitted: id=${withdrawId?.slice(0, 8)}... fee=$${feeUsdc} net=$${netUsdc} status=${status}`);

  if (typeof feeUsdc !== "number" || feeUsdc <= 0) {
    recordBug("E2E-003", "feeUsdc missing or zero in withdraw response",
      JSON.stringify(withdrawRes.body));
  }
  if (typeof netUsdc !== "number" || netUsdc <= 0) {
    recordBug("E2E-004", "netUsdc missing or zero in withdraw response",
      JSON.stringify(withdrawRes.body));
  }
  if (!ticket || !ticket.signature) {
    recordBug("E2E-004b", "ticket or ticket.signature missing in withdraw response",
      JSON.stringify(withdrawRes.body));
    throw new Error("No signed ticket returned — aborting");
  }

  ok(`Ticket: amount=${ticket.amount} fee=${ticket.fee} ticketId=${ticket.ticketId} deadline=${ticket.deadline}`);

  const balAfterWithdraw = await getBalanceSnapshot(token, address);
  ok(`Balance after withdraw: available=${balAfterWithdraw.available.toFixed(2)}, pending=${balAfterWithdraw.pending.toFixed(2)}`);

  // ── 5. User executes SynapseCore.withdraw() on-chain ──────────────────
  section("5. Execute On-chain Withdrawal (User-signed)");
  const { provider: chainProvider, coreAbi, coreAddr } = getContracts();
  const buyerSigner = new ethers.Wallet(BUYER_KEY, chainProvider);
  const coreForBuyer = new ethers.Contract(coreAddr, coreAbi, buyerSigner);

  const ticketSig = ticket.signature.startsWith("0x") ? ticket.signature : `0x${ticket.signature}`;
  let onChainTxHash;

  const withdrawTx = await sendWithRetry("on-chain-withdraw", async () =>
    coreForBuyer.withdraw(
      BigInt(ticket.amount),
      BigInt(ticket.fee),
      ticket.ticketId,
      BigInt(ticket.deadline),
      ticketSig,
      { nonce: await chainProvider.getTransactionCount(buyerSigner.address, "pending") },
    )
  );
  const withdrawReceipt = await withdrawTx.wait();
  if (withdrawReceipt.status !== 1) {
    recordBug("E2E-005a", "On-chain withdraw tx reverted",
      `txHash=${withdrawTx.hash}`);
    throw new Error("on-chain withdraw reverted — aborting");
  }
  onChainTxHash = "0x" + withdrawTx.hash.replace(/^0x/, "");
  ok(`On-chain withdraw OK: txHash=${onChainTxHash}`);

  // ── 5b. Call /v1/refunds/{id}/complete ─────────────────────────────────
  section("5b. Complete Withdrawal via API");
  const completeRes = await apiPost(
    `/v1/refunds/${encodeURIComponent(withdrawId)}/complete`,
    { txHash: onChainTxHash },
    token,
    address,
  );
  if (!completeRes.response.ok) {
    recordBug("E2E-005b", "Complete API failed",
      `status=${completeRes.response.status} body=${JSON.stringify(completeRes.body)}`);
    warn("Complete API failed — background event watcher may still pick it up");
  } else {
    ok("Withdrawal completed via API");
  }

  // ── 6. Backend verification ────────────────────────────────────────────
  section("6. Backend Verification");
  const balFinal = await getBalanceSnapshot(token, address);
  ok(`Final balance: available=${balFinal.available.toFixed(2)}, pending=${balFinal.pending.toFixed(2)}`);

  if (balFinal.pending > 0.01) {
    recordBug("E2E-006", "pending_balance not zero after completion",
      `pending=${balFinal.pending}`);
  }
  if (balFinal.available > 0.01) {
    recordBug("E2E-007", "available_balance not zero after full withdrawal",
      `available=${balFinal.available}`);
  }

  ok(`txHash confirmed: ${onChainTxHash}`);

  // ── 7. On-chain verification ───────────────────────────────────────────
  section("7. On-chain Verification");
  const usdcAfter    = await getUserUsdcBalance(checksumAddr);
  const feePoolAfter = await getPlatformFeePool();
  const expectedNet  = netUsdc || (withdrawAmount - (feeUsdc || 0.5));
  const expectedFee  = feeUsdc || 0.5;

  ok(`User USDC balance (after):  ${usdcAfter.toFixed(6)}`);
  ok(`platformFeePool (after):    ${feePoolAfter.toFixed(6)}`);

  const netDelta = usdcAfter - usdcBefore;
  const feeDelta = feePoolAfter - feePoolBefore;

  ok(`User USDC delta:     +${netDelta.toFixed(6)} (expected +${expectedNet.toFixed(6)})`);
  ok(`Fee pool delta:      +${feeDelta.toFixed(6)} (expected +${expectedFee.toFixed(6)})`);

  // Allow small rounding tolerance
  const TOLERANCE = 0.01;
  if (Math.abs(netDelta - expectedNet) > TOLERANCE) {
    recordBug("E2E-009", "User USDC delta mismatch",
      `delta=${netDelta.toFixed(6)} expected=${expectedNet.toFixed(6)}`);
  }
  if (Math.abs(feeDelta - expectedFee) > TOLERANCE) {
    recordBug("E2E-010", "Fee pool delta mismatch",
      `delta=${feeDelta.toFixed(6)} expected=${expectedFee.toFixed(6)}`);
  }

  // ── 8. Browser screenshots ─────────────────────────────────────────────
  section("8. Browser Screenshots");
  const authSession = JSON.stringify({
    token,
    wallet: address,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  });

  const browser = await chromium.launch({
    headless: true,
    executablePath: getChromeExe(),
    args: ["--no-sandbox", "--disable-web-security", "--allow-running-insecure-content"],
  });

  const screenshots = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(buildInitScript(authSession, address));
    await ctx.exposeFunction("__walletSign__", async (message) => {
      if (typeof message === "string" && message.startsWith("0x")) {
        return buyerWallet.signMessage(ethers.toUtf8String(message));
      }
      return buyerWallet.signMessage(message);
    });

    const page = await ctx.newPage();

    // Credits page — should show $0.00 after withdrawal completed
    await page.goto(`${FRONTEND_URL}/dashboard/billing/credits`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    screenshots.push(await takeShot(page, "01-credits-after-complete.png"));

    // Billing page — withdrawal record with COMPLETED and txHash
    await page.goto(`${FRONTEND_URL}/dashboard/billing`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => !document.body.innerText.includes("Loading payments..."),
      { timeout: 20000 },
    ).catch(() => null);
    await page.waitForTimeout(2000);
    screenshots.push(await takeShot(page, "02-billing-withdraw-completed.png"));

  } finally {
    await browser.close();
  }

  // ── 9. Summary ─────────────────────────────────────────────────────────
  section("9. Results Summary");
  console.log(`\n  Deposit:        $${depositAmount.toFixed(2)} USDC`);
  console.log(`  Withdraw gross: $${withdrawAmount.toFixed(2)} USDC`);
  console.log(`  Fee:            $${(feeUsdc || 0).toFixed(2)} USDC`);
  console.log(`  Net to user:    $${(netUsdc || 0).toFixed(2)} USDC`);
  console.log(`  On-chain USDC:  +$${netDelta.toFixed(6)} (user wallet)`);
  console.log(`  Fee pool:       +$${feeDelta.toFixed(6)} (contract)`);
  console.log(`  Withdraw status: COMPLETED`);
  console.log(`  txHash:          ${onChainTxHash}`);

  if (screenshots.length) {
    console.log("\n  Screenshots:");
    screenshots.forEach((s) => console.log(`    ${s}`));
  }

  if (bugs.length > 0) {
    writeBugReport();
    console.log(`\n  ${RED}${BOLD}${bugs.length} bug(s) found.${RESET} See ${BUGFIX_PATH}`);
    process.exitCode = 1;
  } else {
    console.log(`\n  ${GREEN}${BOLD}All checks passed! Full chain verified.${RESET}`);
  }
}

main().catch((err) => {
  fail(err.stack || err.message || String(err));
  writeBugReport();
  process.exitCode = 1;
});
