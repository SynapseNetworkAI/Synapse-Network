/**
 * Synapse TypeScript SDK — New Consumer E2E Test
 *
 * 完整的"新用户冷启动"链路验证：
 *   创建空钱包 → 链上注入 ETH + USDC → 链上充值 →
 *   网关认证 → 充值确认 → Credential 颁发 →
 *   服务发现 → 报价 → 调用 → 收据 → 余额验证
 *
 * 与 consumer.test.ts 的区别：
 *   - 使用 Wallet.createRandom() 生成全新 EOA（不依赖 Hardhat 预充值账户）
 *   - Deployer 转 ETH 供 gas，再 mint USDC 到新钱包
 *   - 无跳过充值逻辑 — 每次都走完整链上充值流程
 *
 * Prerequisites:
 *   1. npx hardhat node  (port 8545)
 *   2. sh scripts/local/setup_local_env.sh
 *   3. sh scripts/local/restart_gateway.sh  (port 8000)
 *
 * Run: cd sdk/typescript && npm run test:new-consumer
 */

import {
  Wallet,
  JsonRpcProvider,
  Contract,
  parseUnits,
  parseEther,
} from "ethers";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { SynapseAuth } from "../../src/auth";
import { SynapseClient } from "../../src/client";
import { InvocationResult } from "../../src/types";

// ── Config ────────────────────────────────────────────────────────────────────

const GATEWAY_URL    = process.env.SYNAPSE_GATEWAY ?? "http://127.0.0.1:8000";
const RPC_URL        = process.env.RPC_URL         ?? "http://127.0.0.1:8545";
const DEPOSIT_USDC   = Number(process.env.DEPOSIT_USDC ?? "10");
const MOCK_PROVIDER_PORT = 9299;

// Hardhat default keys
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PROVIDER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ea870594801966b8ea0ec4f";

const REPO_ROOT             = path.resolve(__dirname, "../../../../");
const CONTRACT_CONFIG_PATH  = path.join(REPO_ROOT, "apps/frontend/src/contract-config.json");
const MOCK_USDC_ABI_PATH    = path.join(REPO_ROOT, "apps/frontend/src/MockUSDCABI.json");
const SYNAPSE_CORE_ABI_PATH = path.join(REPO_ROOT, "apps/frontend/src/SynapseCoreABI.json");

const SESSION_ID      = uuidv4().replace(/-/g, "").slice(0, 8);
const SERVICE_NAME    = `nc_e2e_svc_${SESSION_ID}`;
const CRED_NAME       = `nc-cred-${SESSION_ID}`;

// ── Shared state ──────────────────────────────────────────────────────────────

let freshAuth:   SynapseAuth;
let providerAuth: SynapseAuth;
let client:      SynapseClient;
let agentToken:  string;
let serviceId:   string;
let mockServer:  http.Server;
let balanceBeforeInvocations: number;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function startMockProvider(): Promise<string> {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "healthy" }));
      } else if (req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result: "new-consumer e2e mock response" }));
      } else {
        res.writeHead(405);
        res.end();
      }
    });
    mockServer.listen(MOCK_PROVIDER_PORT, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${MOCK_PROVIDER_PORT}`);
    });
  });
}

function loadContracts(): { MockUSDC: string; SynapseCore: string } {
  const raw = fs.readFileSync(CONTRACT_CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

async function doFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<Record<string, unknown>> {
  const resp = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await resp.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${url}: ${text.slice(0, 300)}`);
  return data as Record<string, unknown>;
}

/**
 * Funds the fresh wallet on-chain and submits the deposit to SynapseCore.
 * Returns the on-chain tx hash.
 */
async function fundAndDeposit(
  rpcProvider: JsonRpcProvider,
  freshWallet: Wallet,
  deployerWallet: Wallet,
  amountUsdc: number
): Promise<string> {
  const config    = loadContracts();
  const usdcAbi   = JSON.parse(fs.readFileSync(MOCK_USDC_ABI_PATH,    "utf8"));
  const coreAbi   = JSON.parse(fs.readFileSync(SYNAPSE_CORE_ABI_PATH, "utf8"));

  const usdc = new Contract(config.MockUSDC,    usdcAbi, deployerWallet);
  const core = new Contract(config.SynapseCore, coreAbi, freshWallet);

  const decimals  = Number(await usdc.decimals());
  const amountWei = parseUnits(String(amountUsdc), decimals);

  // Fetch deployer's current pending nonce ONCE and manage manually to
  // avoid Hardhat's stale-nonce race condition between rapid sequential txs.
  let deployerNonce = await rpcProvider.getTransactionCount(deployerWallet.address, "pending");

  // (a) Send ETH so fresh wallet can pay gas (0.5 ETH = plenty)
  console.log(`  → Sending ETH to fresh wallet ${freshWallet.address}`);
  const ethTx = await deployerWallet.sendTransaction({
    to: freshWallet.address,
    value: parseEther("0.5"),
    nonce: deployerNonce++,
  });
  await ethTx.wait();

  // (b) Mint USDC to fresh wallet (explicit nonce to avoid stale-nonce race)
  console.log(`  → Minting ${amountUsdc} USDC to fresh wallet`);
  const mintTx = await (usdc as Contract).mint(freshWallet.address, amountWei, { nonce: deployerNonce++ });
  await mintTx.wait();

  // (c) Verify USDC balance
  const usdcBal = await (usdc as Contract).balanceOf(freshWallet.address) as bigint;
  console.log(`  → USDC balance: ${usdcBal.toString()} (raw)`);
  if (usdcBal === 0n) throw new Error("Mint failed — USDC balance is still 0");

  // Fetch fresh wallet's pending nonce once and manage manually (same stale-nonce
  // race condition as deployer: Hardhat auto-mine doesn't always propagate nonce
  // synchronously between consecutive contract calls through different signer refs)
  let freshNonce = await rpcProvider.getTransactionCount(freshWallet.address, "pending");

  // (d) Approve SynapseCore
  console.log(`  → Approving SynapseCore for ${amountUsdc} USDC`);
  const approveTx = await (usdc.connect(freshWallet) as Contract).approve(
    config.SynapseCore, amountWei, { nonce: freshNonce++ }
  );
  await approveTx.wait();

  // (e) On-chain deposit
  console.log(`  → Depositing ${amountUsdc} USDC to SynapseCore`);
  const depositTx = await core.deposit(amountWei, { nonce: freshNonce++ });
  const receipt = await depositTx.wait();
  const txHash: string = receipt.hash;
  console.log(`  → Deposit tx: ${txHash}`);
  return txHash.startsWith("0x") ? txHash : `0x${txHash}`;
}

async function registerTestService(
  providerAddress: string,
  mockServiceUrl: string,
  providerToken: string
): Promise<string> {
  const body = {
    agentToolName: SERVICE_NAME,
    serviceName: `NC E2E Service ${SESSION_ID}`,
    role: "Provider",
    status: "active",
    isActive: true,
    pricing: { amount: "0.001", currency: "USD" },
    summary: "New-Consumer SDK automated e2e integration test service",
    tags: ["nc-sdk", "e2e", "test"],
    auth: { type: "gateway_signed" },
    invoke: {
      method: "POST",
      targets: [{ url: mockServiceUrl }],
      request:  { body: { type: "object", properties: { prompt: { type: "string" } } } },
      response: { body: { type: "object", properties: { result: { type: "string" } } } },
    },
    healthCheck: {
      path: "/health",
      method: "GET",
      timeoutMs: 3000,
      successCodes: [200],
      healthyThreshold: 1,
      unhealthyThreshold: 3,
    },
    payoutAccount: {
      payoutAddress: providerAddress.toLowerCase(),
      chainId: 31337,
      settlementCurrency: "USDC",
    },
    providerProfile: { displayName: `NC E2E Provider ${SESSION_ID}` },
    governance: { termsAccepted: true, riskAcknowledged: true },
  };

  const resp = await doFetch(`${GATEWAY_URL}/api/v1/services`, {
    method: "POST",
    headers: { Authorization: `Bearer ${providerToken}` },
    body: JSON.stringify(body),
  });

  const svcId =
    (resp["serviceId"] as string) ||
    (resp["id"]        as string) ||
    (resp["service_id"] as string) ||
    ((resp["service"] as Record<string, unknown>)?.["serviceId"] as string) ||
    ((resp["service"] as Record<string, unknown>)?.["id"]        as string) ||
    SERVICE_NAME;

  return svcId;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe("Synapse TS SDK — New Consumer Cold-Start E2E", () => {

  // ── beforeAll: chain setup + service registration ──────────────────────────

  beforeAll(async () => {
    console.log(`\n[setup] Session: ${SESSION_ID}`);

    // 1. Start mock HTTP server for provider
    const mockServiceUrl = await startMockProvider();
    console.log(`[setup] Mock provider: ${mockServiceUrl}`);

    // 2. Ethers setup
    const rpcProvider    = new JsonRpcProvider(RPC_URL);
    const deployerWallet = new Wallet(DEPLOYER_KEY, rpcProvider);
    const providerWallet = new Wallet(PROVIDER_KEY, rpcProvider);
    // createRandom() returns HDNodeWallet in ethers v6; extract privateKey → Wallet
    const freshPrivKey   = Wallet.createRandom().privateKey;
    const freshWallet    = new Wallet(freshPrivKey, rpcProvider);

    console.log(`[setup] Fresh wallet: ${freshWallet.address}`);
    console.log(`[setup] Provider:     ${providerWallet.address}`);

    // 3. Create SynapseAuth for fresh wallet
    freshAuth    = SynapseAuth.fromWallet(freshWallet,    { gatewayUrl: GATEWAY_URL });
    providerAuth = SynapseAuth.fromWallet(providerWallet, { gatewayUrl: GATEWAY_URL });

    // 4. Fund fresh wallet + on-chain deposit
    const txHash = await fundAndDeposit(rpcProvider, freshWallet, deployerWallet, DEPOSIT_USDC);

    // 5. Authenticate fresh wallet with gateway (JWT)
    const token = await freshAuth.getToken();
    expect(token).toBeTruthy();

    // 6. Register deposit intent
    const intentResp = await freshAuth.registerDepositIntent(txHash, DEPOSIT_USDC);
    console.log(`[setup] Intent response:`, JSON.stringify(intentResp));
    expect(intentResp.status).toBe("success");

    const intentObj = intentResp.intent as Record<string, unknown>;
    const intentId  = String(
      intentObj["id"] || intentObj["intentId"] || intentObj["depositIntentId"] || ""
    ).trim();
    const eventKey  = String(
      intentObj["eventKey"] || intentObj["event_key"] || txHash
    ).trim();

    expect(intentId).toBeTruthy();
    console.log(`[setup] Intent ID: ${intentId}, eventKey: ${eventKey}`);

    // 7. Confirm deposit
    await freshAuth.confirmDeposit(intentId, eventKey);
    console.log(`[setup] Deposit confirmed`);

    // Allow indexer to credit
    await new Promise<void>((r) => setTimeout(r, 2000));

    // 8. Register test service via provider
    const providerToken = await providerAuth.getToken();
    serviceId = await registerTestService(providerWallet.address, mockServiceUrl, providerToken);
    console.log(`[setup] Service ID: ${serviceId}`);
    expect(serviceId).toBeTruthy();

    // Allow health-check to pass
    await new Promise<void>((r) => setTimeout(r, 2000));
  }, 180_000);

  afterAll(() => {
    if (mockServer) mockServer.close();
  });

  // ── Test 1: Authentication ────────────────────────────────────────────────

  describe("1. Authentication", () => {
    it("should authenticate fresh wallet and return JWT", async () => {
      const token = await freshAuth.getToken();
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(20);
    });

    it("should cache token on repeated calls", async () => {
      const t1 = await freshAuth.getToken();
      const t2 = await freshAuth.getToken();
      expect(t1).toBe(t2);
    });
  });

  // ── Test 2: Balance after deposit ─────────────────────────────────────────

  describe("2. Balance After Deposit", () => {
    it("should show consumerAvailableBalance >= DEPOSIT_USDC after on-chain deposit", async () => {
      const balance   = await freshAuth.getBalance();
      const available = Number(balance.consumerAvailableBalance ?? balance.ownerBalance ?? 0);
      console.log(`  Balance: ${JSON.stringify(balance)}`);
      expect(available).toBeGreaterThanOrEqual(DEPOSIT_USDC * 0.99); // allow minor rounding
    });
  });

  // ── Test 3: Issue Credential ──────────────────────────────────────────────

  describe("3. Issue Agent Credential", () => {
    it("should issue credential and return agentToken", async () => {
      const result = await freshAuth.issueCredential({
        name: CRED_NAME,
        maxCalls: 100,
        creditLimit: 5.0,
        rpm: 60,
      });
      expect(result.token).toBeTruthy();
      expect(result.token.length).toBeGreaterThan(10);
      expect(result.credential.id).toBeTruthy();

      agentToken = result.token;
      client = new SynapseClient({ credential: agentToken, gatewayUrl: GATEWAY_URL });
      console.log(`  Credential ID: ${result.credential.id}`);
    });

    it("should list credentials and include the new credential", async () => {
      const creds = await freshAuth.listCredentials();
      const names = creds.map((c) => c.name);
      expect(names).toContain(CRED_NAME);
    });
  });

  // ── Test 4: Service Discovery ─────────────────────────────────────────────

  describe("4. Service Discovery", () => {
    it("should return non-empty service list", async () => {
      const services = await client.discover({ limit: 20 });
      expect(Array.isArray(services)).toBe(true);
      expect(services.length).toBeGreaterThan(0);
    });

    it("should find the registered test service", async () => {
      const services = await client.discover({ limit: 50 });
      const ids = services.map(
        (s) => s.serviceId ?? s.id ?? s.agentToolName ?? ""
      );
      console.log(`  Discovered IDs (first 5): ${ids.slice(0, 5).join(", ")}`);
      expect(ids).toContain(serviceId);
    });
  });

  // ── Test 5: Quote ─────────────────────────────────────────────────────────

  describe("5. Quote", () => {
    it("should create a quote for the test service", async () => {
      const q = await client.quote(serviceId);
      expect(q.quoteId).toBeTruthy();
      expect(q.quoteId.length).toBeGreaterThan(5);
      console.log(`  Quote ID: ${q.quoteId}`);
    });
  });

  // ── Test 6: Invoke ────────────────────────────────────────────────────────

  describe("6. Invocation (end-to-end settlement)", () => {
    let invResult: InvocationResult;

    beforeAll(async () => {
      const bal = await freshAuth.getBalance();
      balanceBeforeInvocations = Number(
        bal.consumerAvailableBalance ?? bal.ownerBalance ?? 0
      );
      console.log(`  Balance before invocations: ${balanceBeforeInvocations}`);
    });

    it("should invoke service and reach SUCCEEDED/SETTLED status", async () => {
      invResult = await client.invoke(
        serviceId,
        { prompt: "new-consumer e2e automated test" },
        {
          idempotencyKey: `nc-e2e-${SESSION_ID}`,
          pollTimeoutMs: 60_000,
          pollIntervalMs: 1_000,
        }
      );

      console.log(
        `  Invocation: id=${invResult.invocationId} status=${invResult.status} charged=${invResult.chargedUsdc}`
      );
      expect(invResult.invocationId).toBeTruthy();
      expect(["SUCCEEDED", "SETTLED"]).toContain(invResult.status);
    }, 90_000);

    it("should deduct USDC (chargedUsdc > 0)", () => {
      expect(invResult.chargedUsdc).toBeGreaterThan(0);
    });

    it("should return a result payload from provider", () => {
      expect(invResult.result).toBeTruthy();
    });
  });

  // ── Test 7: Invocation Receipt ────────────────────────────────────────────

  describe("7. Invocation Receipt", () => {
    let receiptInvocationId: string;

    beforeAll(async () => {
      const r = await client.invoke(
        serviceId,
        { prompt: "receipt verification call" },
        {
          idempotencyKey: `nc-receipt-${SESSION_ID}`,
          pollTimeoutMs: 60_000,
        }
      );
      receiptInvocationId = r.invocationId;
    }, 90_000);

    it("should retrieve receipt by invocation ID", async () => {
      const receipt = await client.getInvocation(receiptInvocationId);
      expect(receipt.invocationId).toBe(receiptInvocationId);
      expect(["SUCCEEDED", "SETTLED"]).toContain(receipt.status);
    });
  });

  // ── Test 8: Post-settlement Balance ──────────────────────────────────────

  describe("8. Post-Settlement Balance", () => {
    it("should show reduced consumer balance after invocations", async () => {
      const balance   = await freshAuth.getBalance();
      const available = Number(
        balance.consumerAvailableBalance ?? balance.ownerBalance ?? 0
      );
      console.log(`  Balance after invocations: ${available} (was ${balanceBeforeInvocations})`);
      expect(available).toBeLessThan(balanceBeforeInvocations);
      expect(available).toBeGreaterThanOrEqual(0);
    });
  });
});
