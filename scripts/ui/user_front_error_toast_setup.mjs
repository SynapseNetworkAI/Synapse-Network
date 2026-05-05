import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, "../..");
export const BASE_URL = (
  process.env.USER_FRONT_BASE_URL || "http://localhost:3000"
)
  .trim()
  .replace(/\/+$/, "");
export const TEST_ADDRESS = "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8";
export const CHAIN_ID = 31337;
export const OUT_DIR = path.join(
  ROOT,
  "output/playwright/user-front-error-toasts",
  new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z")
);

export const forbiddenRawStrings = [
  "503:",
  "{'code':",
  '"code":',
  "HTTPException",
  "Unable to prepare a withdrawal ticket right now:",
  "RPC Error",
  "Internal error",
  "User denied message signature",
  "Provider upstream failed",
];

export const expectedCopy = {
  en: {
    creditsRpc:
      "Gateway cannot reach the chain RPC right now. In local development, make sure the local chain is running, then retry.",
    creditsUnknown: "Unable to prepare the withdrawal right now.",
    providerRpc:
      "Gateway cannot reach chain RPC right now. Retry after the RPC reconnects.",
    providerMatured: "Provider earnings need T+7 maturity before withdrawal.",
    serviceList: "Failed to load services",
    serviceDeploy: "Failed to create service.",
    credentialRevoke: "Failed to revoke credential",
  },
  zh: {
    creditsRpc: "Gateway 当前无法连接链 RPC。",
    creditsUnknown: "暂时无法准备提现，请稍后重试。",
    providerRpc: "网关当前无法连接链上 RPC",
    providerMatured: "Provider 收益需要经过 T+7 风控沉淀期后才能提现。",
    serviceList: "加载服务失败",
    serviceDeploy: "创建服务失败。",
    credentialRevoke: "撤销凭据失败",
  },
};

export function ensureOutputDir() {
  mkdirSync(OUT_DIR, { recursive: true });
}

export function pageUrl(routePath) {
  return `${BASE_URL}${routePath}`;
}

function rawRpcErrorPayload() {
  return {
    detail: {
      code: "CHAIN_RPC_UNAVAILABLE",
      message:
        "Unable to prepare a withdrawal ticket right now: 503: {'code': 'CHAIN_RPC_UNAVAILABLE', 'message': 'HTTPException: RPC Error'}",
    },
  };
}

function fulfillJson(route, status, body) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function routeOptions(options = {}) {
  return {
    consumerWithdrawMode: "ok",
    providerWithdrawMode: "ok",
    failServiceList: false,
    failServiceDeploy: false,
    failCredentialRevoke: false,
    ...options,
  };
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

function serviceRecord() {
  return {
    id: "svc_fixture",
    serviceId: "svc_fixture_error_toast",
    serviceName: "Error Toast Fixture",
    name: "Error Toast Fixture",
    ownerAddress: TEST_ADDRESS,
    address: TEST_ADDRESS,
    role: "provider",
    pricing: { currency: "USDC", amount: "0.01" },
    endpoint: "https://provider.example.com/invoke",
    isActive: false,
    status: "inactive",
    runtimeAvailable: true,
    invocationCount: 0,
    totalRevenueUsdc: "0",
    health: {
      overallStatus: "healthy",
      healthyTargets: 1,
      totalTargets: 1,
      lastCheckedAt: Date.now(),
      runtimeAvailable: true,
    },
    invoke: {
      method: "POST",
      url: "https://provider.example.com/invoke",
      targets: [{ url: "https://provider.example.com/invoke", weight: 100 }],
      timeoutMs: 15000,
      request: { contentType: "application/json", schema: {} },
      response: { schema: {} },
    },
  };
}

function rpcResult(method) {
  const balanceHex =
    "0x00000000000000000000000000000000000000000000003635c9adc5dea00000";
  return (
    {
      eth_chainId: `0x${CHAIN_ID.toString(16)}`,
      net_version: String(CHAIN_ID),
      eth_getBalance: "0xde0b6b3a7640000",
      eth_blockNumber: "0x1",
      eth_call: balanceHex,
      eth_estimateGas: "0x5208",
      eth_gasPrice: "0x3b9aca00",
      eth_maxPriorityFeePerGas: "0x3b9aca00",
      eth_feeHistory: {
        oldestBlock: "0x1",
        baseFeePerGas: ["0x3b9aca00", "0x3b9aca00"],
        gasUsedRatio: [0],
        reward: [["0x1"]],
      },
    }[method] ?? "0x1"
  );
}

async function mockLocalRpc(route) {
  let id = 1;
  let method = "";
  try {
    const payload = JSON.parse(route.request().postData() || "{}");
    id = payload.id ?? 1;
    method = String(payload.method || "");
  } catch {
    // Best-effort local RPC fixture.
  }
  return fulfillJson(route, 200, {
    jsonrpc: "2.0",
    id,
    result: rpcResult(method),
  });
}

function balanceResponse() {
  return {
    balance: {
      ownerBalance: "20.00",
      consumerAvailableBalance: "20.00",
      consumerPendingBalance: "0.00",
      consumerFrozenBalance: "0.00",
      providerReceivable: "12.60",
      providerReceivableBalance: "12.60",
      platformFeeAccrued: "0.00",
    },
  };
}

function spendingLimitResponse() {
  return {
    spendingLimit: {
      ownerAddress: TEST_ADDRESS,
      allowUnlimited: true,
      spendingLimitUsdc: null,
      currentCycleSpendUsdc: "0.00",
      remainingSpendUsdc: null,
      updatedAt: null,
    },
  };
}

function consumerWithdrawResponse(config) {
  if (config.consumerWithdrawMode === "rpc") return [503, rawRpcErrorPayload()];
  if (config.consumerWithdrawMode === "unknown") {
    return [
      503,
      { detail: "503: {'code': 'HTTPException', 'message': 'Internal error'}" },
    ];
  }
  return [
    200,
    {
      withdrawId: "wd_fixture",
      amountUsdc: "10.00",
      feeUsdc: "0.50",
      netUsdc: "9.50",
      status: "PENDING_MANUAL_REVIEW",
      message: "queued",
    },
  ];
}

function providerWithdrawIntentResponse(config) {
  if (config.providerWithdrawMode === "matured") {
    return [
      400,
      {
        detail: {
          code: "PROVIDER_RECEIVABLE_NOT_MATURED",
          message:
            "Requested 12.600000 USDC exceeds mature provider receivable of 0.000000 USDC.",
        },
      },
    ];
  }
  if (config.providerWithdrawMode === "rpc") return [503, rawRpcErrorPayload()];
  return [
    200,
    {
      withdrawalId: "pwd_fixture",
      status: "PENDING_MANUAL_REVIEW",
      amountUsdc: "12.60",
    },
  ];
}

function providerEarningsResponse() {
  return {
    summary: {
      ownerAddress: TEST_ADDRESS,
      totalApiCalls: 0,
      totalEarned: 12.6,
      totalProtocolFee: 0,
      totalRoutingTax: 0,
      providerNetEarned: 12.6,
      providerReceivable: 12.6,
      duplicateRowsDropped: 0,
      idempotencyKey: "fixture",
      recentCalls: [],
    },
  };
}

function serviceListResponse(config) {
  if (!config.failServiceList) return [200, { services: [serviceRecord()] }];
  return [
    503,
    {
      detail:
        "503: {'code': 'SERVICE_LIST_FAILED', 'message': 'Provider upstream failed HTTPException'}",
    },
  ];
}

function serviceDeployResponse(config) {
  if (!config.failServiceDeploy) return [200, { service: serviceRecord() }];
  return [
    503,
    {
      detail:
        "503: {'code': 'SERVICE_REGISTRATION_INVALID', 'message': 'HTTPException'}",
    },
  ];
}

function credentialListResponse() {
  return {
    credentials: [
      {
        id: "cred_fixture",
        ownerAddress: TEST_ADDRESS,
        tokenPrefix: "agt_fixture",
        status: "active",
        maxCalls: 1000,
        callsUsed: 0,
        rpm: 600,
        creditLimit: 100,
        expiresAt: 0,
      },
    ],
  };
}

function credentialRevokeResponse(config) {
  if (!config.failCredentialRevoke) return [200, { success: true }];
  return [
    503,
    { detail: "503: {'code': 'HTTPException', 'message': 'Internal error'}" },
  ];
}

function handleBalanceRoute(route, config, pathKey, method) {
  if (pathKey === "/api/v1/balance" && method === "GET")
    return fulfillJson(route, 200, balanceResponse());
  if (pathKey === "/api/v1/balance/spending-limit")
    return fulfillJson(route, 200, spendingLimitResponse());
  if (pathKey === "/api/v1/balance/consumer/withdrawals")
    return fulfillJson(route, 200, { withdrawals: [] });
  if (pathKey === "/api/v1/balance/consumer/withdraw" && method === "POST")
    return fulfillJson(route, ...consumerWithdrawResponse(config));
  return null;
}

function handleProviderRoute(route, config, pathKey, method) {
  if (pathKey === "/api/v1/providers/withdrawals/capability")
    return fulfillJson(route, 200, {
      ticketSigningEnabled: true,
      code: null,
      message: "ready",
      contractAddress: "0x00000000000000000000000000000000000000aa",
    });
  if (pathKey === "/api/v1/providers/withdrawals" && method === "GET")
    return fulfillJson(route, 200, { withdrawals: [] });
  if (pathKey === "/api/v1/providers/withdrawals/intent")
    return fulfillJson(route, ...providerWithdrawIntentResponse(config));
  if (pathKey === "/api/v1/providers/earnings/summary")
    return fulfillJson(route, 200, providerEarningsResponse());
  return null;
}

function handleServiceRoute(route, config, pathKey, method) {
  if (pathKey === "/api/v1/services" && method === "GET")
    return fulfillJson(route, ...serviceListResponse(config));
  if (pathKey === "/api/v1/services" && method === "POST")
    return fulfillJson(route, ...serviceDeployResponse(config));
  if (pathKey.startsWith("/api/v1/services/"))
    return fulfillJson(route, 200, { service: serviceRecord(), status: "ok" });
  return null;
}

function handleCredentialRoute(route, config, pathKey, method) {
  if (pathKey === "/api/v1/credentials/agent/list")
    return fulfillJson(route, 200, credentialListResponse());
  if (
    pathKey === "/api/v1/credentials/agent/cred_fixture/revoke" &&
    method === "POST"
  )
    return fulfillJson(route, ...credentialRevokeResponse(config));
  if (pathKey === "/api/v1/credentials/agent/audit")
    return fulfillJson(route, 200, { logs: [] });
  return null;
}

async function handleGatewayRoute(route, config) {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const pathKey = pathname.replace(/\/+$/, "") || "/";
  const method = request.method().toUpperCase();
  const handlers = [
    handleBalanceRoute,
    handleProviderRoute,
    handleServiceRoute,
    handleCredentialRoute,
  ];
  for (const handler of handlers) {
    const response = handler(route, config, pathKey, method);
    if (response) return response;
  }
  return fulfillJson(route, 200, { success: true });
}

async function installGatewayMocks(page, options = {}) {
  const config = routeOptions(options);
  await page.route("http://127.0.0.1:8545/**", mockLocalRpc);
  await page.route("http://localhost:8545/**", mockLocalRpc);
  await page.route("**/api/v1/**", (route) =>
    handleGatewayRoute(route, config)
  );
}

export async function newAuthedPage(
  browser,
  language,
  role,
  options,
  onConsoleError
) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const chainHex = `0x${CHAIN_ID.toString(16)}`;
  await context.addInitScript({
    path: path.join(
      ROOT,
      "scripts/ui/user_front_error_toast_browser_fixtures.js"
    ),
  });
  await context.addInitScript(
    ({ address, chainId, chainHex, language, role, wagmiStore }) => {
      const normalized = String(address).toLowerCase();
      localStorage.setItem("synapse_lang", language);
      localStorage.setItem("a2a_selected_role", role);
      localStorage.setItem(`a2a_role_${normalized}`, role);
      localStorage.setItem("synapse_e2e_wallet_connected", "1");
      localStorage.setItem(
        "a2a_auth_session",
        JSON.stringify({
          token: "e2e-error-toast-token",
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
      window.ethereum = buildEthereumFixture(address, chainId, chainHex);
      setTimeout(
        () => window.dispatchEvent(new Event("ethereum#initialized")),
        0
      );
    },
    {
      address: TEST_ADDRESS,
      chainId: CHAIN_ID,
      chainHex,
      language,
      role,
      wagmiStore: buildWagmiStore(TEST_ADDRESS, CHAIN_ID),
    }
  );
  const page = await context.newPage();
  await installGatewayMocks(page, options);
  page.on("console", (message) => {
    if (message.type() === "error")
      onConsoleError(message.text().slice(0, 500));
  });
  return { context, page };
}
