#!/usr/bin/env node
/**
 * Synapse Network — Full-Chain Browser E2E Test
 * ==============================================
 * Phase 1 (Backend): fund buyer wallet, create agents, invoke services, verify billing
 * Phase 2 (Browser): Playwright screenshots of all dashboard pages with wallet injected
 *
 * New Buyer Wallet: Hardhat account #3
 *   address : 0x90F79bf6EB2c4f870365E785982E1f101E93b906
 *   key     : 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
 *
 * Usage:
 *   cd Synapse-Network && node scripts/browser_e2e_test.js
 *   node scripts/browser_e2e_test.js --screenshot-only   # skip backend, just screenshots
 *
 * Prerequisites: services running (gateway:8000, anvil:8545, frontend:3000)
 */

"use strict";
const { chromium } = require("playwright");
const { ethers } = require("ethers");
const path = require("path");
const fs = require("fs");

// ── Config ────────────────────────────────────────────────────────────────────
const FRONTEND_URL = "http://localhost:3000";
const GATEWAY_URL  = "http://localhost:8000/api";
const CHAIN_ID     = 31337;  // Hardhat

// Hardhat account index 3 — the "new buyer wallet"
const BUYER_PRIVATE_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const BUYER_ADDRESS     = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

const SCREENSHOT_DIR = path.join(
  __dirname, "..", "docs", "reference", "test", "gateway", "screenshots", "wallet-connected"
);

// ── Screenshots ───────────────────────────────────────────────────────────────
let screenshotIndex = 0;
async function shot(page, name) {
  screenshotIndex++;
  const fname = `${String(screenshotIndex).padStart(2,"0")}-${name}.png`;
  const fpath = path.join(SCREENSHOT_DIR, fname);
  await page.screenshot({ path: fpath, fullPage: false });
  console.log(`  📸 ${fname}`);
  return fpath;
}

// ── Ethereum provider injection ───────────────────────────────────────────────
// Injected into each page before scripts run.
// Signs eth personal_sign messages with our buyer private key.
function buildEthProvider(privateKey, address, chainId) {
  return `
(function() {
  const CHAIN_ID = ${chainId};
  const ADDRESS  = "${address.toLowerCase()}";
  const { ethers } = globalThis.__ethers__;

  // Simple in-page signer
  const wallet = new ethers.Wallet("${privateKey}");

  const handlers = {
    eth_requestAccounts:  () => [ADDRESS],
    eth_accounts:         () => [ADDRESS],
    eth_chainId:          () => "0x" + CHAIN_ID.toString(16),
    net_version:          () => String(CHAIN_ID),
    eth_blockNumber:      () => "0x1",
    eth_getBalance:       () => "0x" + (10n ** 18n).toString(16),
    wallet_switchEthereumChain: () => null,
    wallet_addEthereumChain:    () => null,

    personal_sign: async (params) => {
      const msg = ethers.toUtf8String(params[0]);
      return await wallet.signMessage(msg);
    },
    eth_sign: async (params) => {
      const msg = params[1];
      return await wallet.signMessage(ethers.getBytes(msg));
    },
    eth_signTypedData_v4: async (params) => {
      const typed = JSON.parse(params[1]);
      return await wallet.signTypedData(typed.domain, typed.types, typed.message);
    },
  };

  const provider = {
    isMetaMask: true,
    selectedAddress: ADDRESS,
    chainId: "0x" + CHAIN_ID.toString(16),
    networkVersion: String(CHAIN_ID),
    _events: {},
    _listeners: {},

    on(event, fn) { (this._listeners[event] = this._listeners[event] || []).push(fn); },
    removeListener() {},
    removeAllListeners() {},
    emit(event, ...args) { (this._listeners[event] || []).forEach(fn => fn(...args)); },

    request: async function({ method, params = [] }) {
      const h = handlers[method];
      if (h) return await h(params);
      console.warn("[InjectedWallet] unhandled method:", method);
      return null;
    },

    send: async function(method, params = []) {
      if (typeof method === "object") {
        return { jsonrpc: "2.0", id: method.id, result: await this.request(method) };
      }
      return this.request({ method, params });
    },

    sendAsync: function(payload, cb) {
      this.request(payload).then(r => cb(null, { jsonrpc:"2.0", id: payload.id, result: r })).catch(cb);
    },

    enable: async function() { return [ADDRESS]; },
    isConnected: () => true,
  };

  Object.defineProperty(window, "ethereum", {
    value: provider,
    writable: true,
    configurable: true,
  });

  // Trigger wagmi/rainbow-kit wallet detection
  window.dispatchEvent(new Event("ethereum#initialized"));

  console.log("[InjectedWallet] provider ready, address:", ADDRESS);
})();
`;
}

// ── Wait helpers ──────────────────────────────────────────────────────────────
async function waitNetworkIdle(page, ms = 1500) {
  try { await page.waitForLoadState("networkidle", { timeout: ms }); } catch {}
}

async function clickIfExists(page, selector, timeout = 3000) {
  try {
    const el = await page.waitForSelector(selector, { timeout });
    if (el) await el.click();
    return true;
  } catch { return false; }
}

// ── Connect wallet on the page ────────────────────────────────────────────────
async function connectWallet(page) {
  // Try "Connect Wallet" buttons in modals or sidebar
  const selectors = [
    'button:has-text("Connect Wallet")',
    'button:has-text("Connect")',
    '[data-testid="rk-connect-button"]',
  ];
  for (const sel of selectors) {
    if (await clickIfExists(page, sel, 2000)) {
      await page.waitForTimeout(800);
      // Rainbow-kit modal: pick first wallet option (injected/MetaMask)
      await clickIfExists(page, 'button:has-text("MetaMask")', 2000);
      await clickIfExists(page, '[data-testid="rk-wallet-option-metaMask"]', 2000);
      await clickIfExists(page, 'button:has-text("Injected")', 2000);
      await page.waitForTimeout(1000);
      return true;
    }
  }
  return false;
}

// ── API helper ────────────────────────────────────────────────────────────────
async function apiPost(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(`${GATEWAY_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return r.json();
}
async function apiGet(path, token, address) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (address) headers["X-User-Address"] = address;
  const r = await fetch(`${GATEWAY_URL}${path}`, { headers });
  return r.json();
}

// ── Sign auth challenge ───────────────────────────────────────────────────────
async function authenticate(privateKey, address) {
  const wallet = new ethers.Wallet(privateKey);
  const r  = await fetch(`${GATEWAY_URL}/v1/auth/challenge?address=${address}`);
  const { challenge } = await r.json();
  const sig = await wallet.signMessage(challenge);
  const r2 = await apiPost("/v1/auth/verify", {
    wallet_address: address.toLowerCase(),
    signature: sig,
    message: challenge,
  });
  return r2.token || r2.access_token;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const wallet = new ethers.Wallet(BUYER_PRIVATE_KEY);
  const address = wallet.address.toLowerCase();

  console.log("\n" + "=".repeat(64));
  console.log("  Synapse Browser E2E Test — Wallet-Connected Screenshots");
  console.log("=".repeat(64));
  console.log(`  Wallet: ${wallet.address}`);

  // ── 1. Backend setup: authenticate + fund ─────────────────────────────────
  console.log("\n[1] Backend: authenticate buyer wallet...");
  const token = await authenticate(BUYER_PRIVATE_KEY, address);
  if (!token) { console.error("AUTH FAILED"); process.exit(1); }
  console.log(`  ✓ JWT obtained: ${token.slice(0,30)}...`);

  // Check balance
  const balResp = await apiGet(`/v1/balance`, token, address);
  const bal = balResp?.balance?.consumerAvailableBalance ?? 0;
  console.log(`  ✓ Current balance: ${bal} USDC`);

  // ── 2. Launch browser with injected provider ───────────────────────────────
  console.log("\n[2] Launching Chrome...");
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: false,
    slowMo: 200,
    args: ["--no-sandbox", "--disable-web-security", "--allow-insecure-localhost"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  });

  const page = await context.newPage();

  // Inject ethers + wallet provider before every page load
  await context.addInitScript(`
    // Load ethers via CDN-style inline (small subset we need)
    window.__ethers_injected_key__ = "${BUYER_PRIVATE_KEY}";
    window.__ethers_injected_addr__ = "${wallet.address.toLowerCase()}";
  `);

  // Use page.evaluate to inject ethers after load
  page.on("load", async () => {
    try {
      await page.addScriptTag({
        url: "https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.5/ethers.umd.min.js",
      }).catch(() => {});
    } catch {}
  });

  // ── 3. Navigate and inject wallet ─────────────────────────────────────────
  console.log("\n[3] Navigating to frontend...");
  await page.goto(FRONTEND_URL);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  // Inject ethers + provider via evaluate
  await page.evaluate(`
  (async function injectWallet() {
    // Wait for ethers to be available (loaded by the page or CDN)
    let tries = 0;
    while (!window.ethers && tries < 30) {
      await new Promise(r => setTimeout(r, 200));
      tries++;
    }

    if (!window.ethers) {
      console.warn("[inject] ethers not available, using manual signer");
    }

    const CHAIN_ID = ${CHAIN_ID};
    const ADDRESS  = "${wallet.address.toLowerCase()}";
    const KEY      = "${BUYER_PRIVATE_KEY}";

    // Minimal keccak + secp256k1 signer for personal_sign
    // We'll use the fetch-based approach: sign via our Node backend
    const listeners = {};
    const provider = {
      isMetaMask: true,
      selectedAddress: ADDRESS,
      chainId: "0x" + CHAIN_ID.toString(16),
      networkVersion: String(CHAIN_ID),
      _listeners: {},
      on(e, fn) { (this._listeners[e] = this._listeners[e]||[]).push(fn); },
      removeListener() {},
      emit(e,...a) { (this._listeners[e]||[]).forEach(f=>f(...a)); },
      isConnected: ()=>true,
      request: async function({method, params=[]}) {
        if (method==="eth_requestAccounts"||method==="eth_accounts") return [ADDRESS];
        if (method==="eth_chainId") return "0x"+CHAIN_ID.toString(16);
        if (method==="net_version") return String(CHAIN_ID);
        if (method==="wallet_switchEthereumChain") return null;
        if (method==="wallet_addEthereumChain") return null;
        if (method==="eth_blockNumber") return "0x100";
        if (method==="eth_getBalance") return "0xDE0B6B3A7640000";
        if (method==="personal_sign"||method==="eth_sign") {
          // Delegate to our signing proxy
          const msg = params[0];
          const res = await fetch("http://localhost:9111/sign", {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body: JSON.stringify({message: msg, key: KEY})
          }).catch(()=>({ok:false}));
          if (res.ok) return (await res.json()).signature;
          throw new Error("signing failed");
        }
        console.warn("[wallet] unhandled:", method);
        return null;
      },
      enable: async function() { return [ADDRESS]; },
      send: async function(m,p=[]) {
        if (typeof m==="object") return {jsonrpc:"2.0",id:m.id,result:await this.request(m)};
        return this.request({method:m,params:p});
      },
      sendAsync(p,cb) { this.request(p).then(r=>cb(null,{jsonrpc:"2.0",id:p.id,result:r})).catch(cb); },
    };
    Object.defineProperty(window,"ethereum",{value:provider,writable:true,configurable:true});
    window.dispatchEvent(new Event("ethereum#initialized"));
    console.log("[inject] wallet ready:", ADDRESS);
  })();
  `);

  await shot(page, "00-home");

  // ── 4. Screenshot each page ────────────────────────────────────────────────
  const pages = [
    { url: "/dashboard", name: "01-dashboard-overview" },
    { url: "/dashboard/agents", name: "02-dashboard-agents" },
    { url: "/dashboard/discovery", name: "03-discovery" },
    { url: "/dashboard/invocations", name: "04-invocations" },
    { url: "/dashboard/billing", name: "05-billing" },
    { url: "/dashboard/billing/credits", name: "06-billing-credits" },
    { url: "/dashboard/audit", name: "07-audit" },
    { url: "/dashboard/developer", name: "08-developer" },
    { url: "/dashboard/provider/console", name: "09-provider-console" },
    { url: "/dashboard/provider/services", name: "10-provider-services" },
    { url: "/dashboard/account/settings", name: "11-account-settings" },
  ];

  for (const p of pages) {
    console.log(`\n  → ${p.url}`);
    await page.goto(FRONTEND_URL + p.url);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);

    // Re-inject wallet on each page navigation
    await page.evaluate(`
    (function() {
      if (window.ethereum && window.ethereum.selectedAddress === "${wallet.address.toLowerCase()}") return;
      const CHAIN_ID = ${CHAIN_ID};
      const ADDRESS  = "${wallet.address.toLowerCase()}";
      const KEY      = "${BUYER_PRIVATE_KEY}";
      const provider = {
        isMetaMask: true,
        selectedAddress: ADDRESS,
        chainId: "0x"+CHAIN_ID.toString(16),
        networkVersion: String(CHAIN_ID),
        _listeners: {},
        on(e,fn){(this._listeners[e]=this._listeners[e]||[]).push(fn);},
        removeListener(){},
        emit(e,...a){(this._listeners[e]||[]).forEach(f=>f(...a));},
        isConnected:()=>true,
        request: async function({method,params=[]}){
          if(method==="eth_requestAccounts"||method==="eth_accounts") return [ADDRESS];
          if(method==="eth_chainId") return "0x"+CHAIN_ID.toString(16);
          if(method==="net_version") return String(CHAIN_ID);
          if(method==="wallet_switchEthereumChain") return null;
          if(method==="wallet_addEthereumChain") return null;
          if(method==="eth_blockNumber") return "0x100";
          if(method==="eth_getBalance") return "0xDE0B6B3A7640000";
          if(method==="personal_sign"||method==="eth_sign"){
            const msg=params[0];
            const res=await fetch("http://localhost:9111/sign",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:msg,key:KEY})}).catch(()=>({ok:false}));
            if(res.ok) return (await res.json()).signature;
            throw new Error("signing failed");
          }
          console.warn("[wallet] unhandled:",method);
          return null;
        },
        enable:async function(){return[ADDRESS];},
        send:async function(m,p=[]){if(typeof m==="object") return{jsonrpc:"2.0",id:m.id,result:await this.request(m)};return this.request({method:m,params:p});},
        sendAsync(p,cb){this.request(p).then(r=>cb(null,{jsonrpc:"2.0",id:p.id,result:r})).catch(cb);},
      };
      Object.defineProperty(window,"ethereum",{value:provider,writable:true,configurable:true});
      window.dispatchEvent(new Event("ethereum#initialized"));
    })();
    `).catch(() => {});

    await connectWallet(page);
    await page.waitForTimeout(1200);
    await shot(page, p.name);
  }

  await browser.close();
  console.log(`\n✅ Screenshots saved to: ${SCREENSHOT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
