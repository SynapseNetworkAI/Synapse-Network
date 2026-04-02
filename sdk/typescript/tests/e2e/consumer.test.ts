/**
 * Synapse TypeScript SDK — Consumer E2E Test
 *
 * Tests the full consumer pipeline end-to-end against a live local gateway:
 *   Auth → Credential → Discover → Quote → Invoke → Receipt
 *
 * Prerequisites:
 *   1. Hardhat node running:   npx hardhat node  (port 8545)
 *   2. Contracts deployed:     sh scripts/local/setup_local_env.sh
 *   3. Gateway running:        sh scripts/local/restart_gateway.sh  (port 8000)
 *   4. A registered service available (provider pre-registered or via setup below)
 *
 * Run:  cd sdk/typescript && npm test
 */

import { Wallet, JsonRpcProvider, Contract, parseUnits } from "ethers";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { SynapseAuth } from "../../src/auth";
import { SynapseClient } from "../../src/client";
import { InvocationResult } from "../../src/types";

// ── Config ──────────────────────────────────────────────────────────────────

const GATEWAY_URL = process.env.SYNAPSE_GATEWAY ?? "http://127.0.0.1:8000";
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const MOCK_PROVIDER_PORT = 9199;

// Hardhat default keys (localhost only)
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OWNER_KEY    = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PROVIDER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ea870594801966b8ea0ec4f";

const REPO_ROOT = path.resolve(__dirname, "../../../../");
const CONTRACT_CONFIG_PATH = path.join(REPO_ROOT, "apps/frontend/src/contract-config.json");
const MOCK_USDC_ABI_PATH   = path.join(REPO_ROOT, "apps/frontend/src/MockUSDCABI.json");
const SYNAPSE_CORE_ABI_PATH = path.join(REPO_ROOT, "apps/frontend/src/SynapseCoreABI.json");

const DEPOSIT_USDC = 10;
const SESSION_ID = uuidv4().replace(/-/g, "").slice(0, 8);
const SERVICE_TOOL_NAME = `ts_sdk_e2e_${SESSION_ID}`;
const CRED_NAME = `ts-sdk-cred-${SESSION_ID}`;

// ── Shared state ──────────────────────────────────────────────────────────────

let ownerAuth: SynapseAuth;
let providerAuth: SynapseAuth;
let client: SynapseClient;
let agentToken: string;
let serviceId: string;
let mockServer: http.Server;
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
        res.end(JSON.stringify({ result: "ts-sdk e2e mock response" }));
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

async function doFetch(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const resp = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const text = await resp.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${url}: ${text.slice(0, 200)}`);
  return data as Record<string, unknown>;
}

function loadContractConfig(): { MockUSDC: string; SynapseCore: string } {
  const raw = fs.readFileSync(CONTRACT_CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

async function depositBalance(
  provider: JsonRpcProvider,
  ownerWallet: Wallet,
  deployerWallet: Wallet,
  amountUsdc: number
): Promise<string> {
  const config = loadContractConfig();
  const mockUsdcAbi = JSON.parse(fs.readFileSync(MOCK_USDC_ABI_PATH, "utf8"));
  const synapseCoreAbi = JSON.parse(fs.readFileSync(SYNAPSE_CORE_ABI_PATH, "utf8"));

  const usdc = new Contract(config.MockUSDC, mockUsdcAbi, deployerWallet);
  const core = new Contract(config.SynapseCore, synapseCoreAbi, ownerWallet);

  // MockUSDC uses 18 decimals
  const decimals = Number(await usdc.decimals());
  const amountWei = parseUnits(String(amountUsdc), decimals);

  // Mint USDC to owner
  const mintTx = await (usdc.connect(deployerWallet) as Contract).mint(ownerWallet.address, amountWei);
  await mintTx.wait();

  // Approve SynapseCore to spend
  const approveTx = await (usdc.connect(ownerWallet) as Contract).approve(config.SynapseCore, amountWei);
  await approveTx.wait();

  // Deposit on-chain
  const depositTx = await core.deposit(amountWei);
  const receipt = await depositTx.wait();
  const txHash: string = receipt.hash;
  return txHash.startsWith("0x") ? txHash : `0x${txHash}`;
}

async function registerTestService(
  providerAddress: string,
  mockServiceUrl: string,
  providerToken: string
): Promise<string> {
  const body = {
    agentToolName: SERVICE_TOOL_NAME,
    serviceName: `TS SDK E2E Service ${SESSION_ID}`,
    role: "Provider",
    status: "active",
    isActive: true,
    pricing: { amount: "0.001", currency: "USD" },
    summary: "TypeScript SDK automated e2e integration test service",
    tags: ["ts-sdk", "e2e", "test"],
    auth: { type: "gateway_signed" },
    invoke: {
      method: "POST",
      targets: [{ url: mockServiceUrl }],
      request: { body: { type: "object", properties: { prompt: { type: "string" } } } },
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
    providerProfile: { displayName: `TS SDK E2E Provider ${SESSION_ID}` },
    governance: { termsAccepted: true, riskAcknowledged: true },
  };

  const resp = await doFetch(`${GATEWAY_URL}/api/v1/services`, {
    method: "POST",
    headers: { Authorization: `Bearer ${providerToken}` },
    body: JSON.stringify(body),
  });

  const svcId =
    (resp["serviceId"] as string) ||
    (resp["id"] as string) ||
    (resp["service_id"] as string) ||
    ((resp["service"] as Record<string, unknown>)?.["serviceId"] as string) ||
    ((resp["service"] as Record<string, unknown>)?.["id"] as string) ||
    SERVICE_TOOL_NAME;

  return svcId;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe("Synapse TypeScript SDK — Consumer E2E Pipeline", () => {

  // ── Suite Setup ────────────────────────────────────────────────────────────

  beforeAll(async () => {
    // 1. Start mock provider HTTP server
    const mockServiceUrl = await startMockProvider();

    // 2. Setup ethers wallets
    const rpcProvider = new JsonRpcProvider(RPC_URL);
    const ownerWallet    = new Wallet(OWNER_KEY, rpcProvider);
    const providerWallet = new Wallet(PROVIDER_KEY, rpcProvider);
    const deployerWallet = new Wallet(DEPLOYER_KEY, rpcProvider);

    // 3. Create SynapseAuth instances
    ownerAuth = SynapseAuth.fromWallet(ownerWallet, { gatewayUrl: GATEWAY_URL });
    providerAuth = SynapseAuth.fromWallet(providerWallet, { gatewayUrl: GATEWAY_URL });

    // 4. Deposit USDC balance on-chain + notify gateway (skip if already funded)
    const existingBalance = await ownerAuth.getBalance();
    const existingAvailable = Number(existingBalance.consumerAvailableBalance ?? existingBalance.ownerBalance ?? 0);

    if (existingAvailable < DEPOSIT_USDC / 2) {
      const txHash = await depositBalance(rpcProvider, ownerWallet, deployerWallet, DEPOSIT_USDC);

      const intentResp = await ownerAuth.registerDepositIntent(txHash, DEPOSIT_USDC);
      expect(intentResp.status).toBe("success");

      const intentObj = intentResp.intent;
      const intentId = (intentObj["id"] || intentObj["intentId"] || intentObj["depositIntentId"] || "") as string;
      const eventKey = (intentObj["eventKey"] || intentObj["event_key"] || txHash) as string;
      expect(intentId).toBeTruthy();

      await ownerAuth.confirmDeposit(intentId, eventKey);
      // Allow indexer to credit
      await new Promise<void>((r) => setTimeout(r, 1500));
    } else {
      console.log(`[setup] Skipping deposit — existing balance: ${existingAvailable} USDC`);
    }

    // 5. Authenticate provider + register test service
    const providerToken = await providerAuth.getToken();
    serviceId = await registerTestService(providerWallet.address, mockServiceUrl, providerToken);
    expect(serviceId).toBeTruthy();

    // Allow health check pass
    await new Promise<void>((r) => setTimeout(r, 2000));
  }, 120_000);

  afterAll(() => {
    if (mockServer) mockServer.close();
  });

  // ── Test 1: Auth ───────────────────────────────────────────────────────────

  describe("1. Authentication", () => {
    it("should authenticate owner wallet and return a JWT", async () => {
      const token = await ownerAuth.getToken();
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(20);
    });

    it("should cache the token on repeated calls", async () => {
      const t1 = await ownerAuth.getToken();
      const t2 = await ownerAuth.getToken();
      expect(t1).toBe(t2);
    });
  });

  // ── Test 2: Balance ───────────────────────────────────────────────────────

  describe("2. Balance", () => {
    it("should return balance with consumerAvailableBalance > 0 after deposit", async () => {
      const balance = await ownerAuth.getBalance();
      const available = Number(balance.consumerAvailableBalance ?? balance.ownerBalance ?? 0);
      expect(available).toBeGreaterThan(0);
    });
  });

  // ── Test 3: Issue Credential ───────────────────────────────────────────────

  describe("3. Agent Credential", () => {
    it("should issue a credential and return a token", async () => {
      const result = await ownerAuth.issueCredential({
        name: CRED_NAME,
        maxCalls: 100,
        creditLimit: 5.0,
        rpm: 60,
      });
      expect(result.token).toBeTruthy();
      expect(result.token.length).toBeGreaterThan(10);
      expect(result.credential.id).toBeTruthy();

      agentToken = result.token;
      // Create client with the issued credential
      client = new SynapseClient({ credential: agentToken, gatewayUrl: GATEWAY_URL });
    });

    it("should list credentials and include the issued credential", async () => {
      const creds = await ownerAuth.listCredentials();
      const names = creds.map((c) => c.name);
      expect(names).toContain(CRED_NAME);
    });
  });

  // ── Test 4: Service Discovery ─────────────────────────────────────────────

  describe("4. Service Discovery", () => {
    it("should discover services list (non-empty)", async () => {
      const services = await client.discover({ limit: 20 });
      expect(Array.isArray(services)).toBe(true);
      expect(services.length).toBeGreaterThan(0);
    });

    it("should find the registered test service", async () => {
      const services = await client.discover({ limit: 50 });
      const ids = services.map((s) => s.serviceId ?? s.id ?? s.agentToolName ?? "");
      expect(ids).toContain(serviceId);
    });
  });

  // ── Test 5: Quote ──────────────────────────────────────────────────────────

  describe("5. Quote", () => {
    it("should create a quote for the test service", async () => {
      const q = await client.quote(serviceId);
      expect(q.quoteId).toBeTruthy();
      expect(q.quoteId.length).toBeGreaterThan(5);
    });
  });

  // ── Test 6: Invoke ────────────────────────────────────────────────────────

  describe("6. Invocation (end-to-end settlement)", () => {
    let invocationResult: InvocationResult;

    beforeAll(async () => {
      // Snapshot balance before any invocations
      const bal = await ownerAuth.getBalance();
      balanceBeforeInvocations = Number(bal.consumerAvailableBalance ?? bal.ownerBalance ?? 0);
    });

    it("should invoke service and return settled result", async () => {
      invocationResult = await client.invoke(
        serviceId,
        { prompt: "ts-sdk e2e automated test" },
        {
          idempotencyKey: `ts-sdk-e2e-${SESSION_ID}`,
          pollTimeoutMs: 60_000,
          pollIntervalMs: 1_000,
        }
      );

      expect(invocationResult.invocationId).toBeTruthy();
      expect(["SUCCEEDED", "SETTLED"]).toContain(invocationResult.status);
    }, 90_000);

    it("should have deducted USDC (chargedUsdc > 0)", () => {
      expect(invocationResult.chargedUsdc).toBeGreaterThan(0);
    });

    it("should have a result payload from provider", () => {
      // provider returns { result: "ts-sdk e2e mock response" }
      expect(invocationResult.result).toBeTruthy();
    });
  });

  // ── Test 7: Get Invocation Receipt ────────────────────────────────────────

  describe("7. Invocation Receipt", () => {
    let savedInvocationId: string;

    beforeAll(async () => {
      // Run a second invocation to test receipt retrieval
      const result = await client.invoke(serviceId, { prompt: "receipt check" }, {
        idempotencyKey: `ts-sdk-receipt-${SESSION_ID}`,
        pollTimeoutMs: 60_000,
      });
      savedInvocationId = result.invocationId;
    }, 90_000);

    it("should retrieve the invocation receipt by ID", async () => {
      const receipt = await client.getInvocation(savedInvocationId);
      expect(receipt.invocationId).toBe(savedInvocationId);
      expect(["SUCCEEDED", "SETTLED"]).toContain(receipt.status);
    });
  });

  // ── Test 8: Balance after invoke ──────────────────────────────────────────

  describe("8. Balance After Settlement", () => {
    it("should show reduced consumer balance after invocations", async () => {
      const balance = await ownerAuth.getBalance();
      const available = Number(balance.consumerAvailableBalance ?? balance.ownerBalance ?? 0);
      // Balance must have decreased from pre-invocation snapshot
      expect(available).toBeLessThan(balanceBeforeInvocations);
      expect(available).toBeGreaterThanOrEqual(0);
    });
  });
});
