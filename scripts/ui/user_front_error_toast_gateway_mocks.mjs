import { CHAIN_ID, TEST_ADDRESS } from "./user_front_error_toast_config.mjs";

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
    providerHistoryMode: "empty",
    notificationMode: "empty",
    providerReceivable: 12.6,
    providerMatureReceivable: 12.6,
    failServiceList: false,
    failServiceDeploy: false,
    failCredentialRevoke: false,
    ...options,
  };
}

export function buildWagmiStore(address, chainId) {
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
      consumerWithdrawableBalance: "20.00",
      consumerWithdrawMinUsdc: "10.00",
      consumerWithdrawMaturitySeconds: 604800,
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
  if (config.consumerWithdrawMode === "contract") {
    return [
      503,
      {
        detail: {
          code: "WITHDRAW_CONTRACT_NOT_CONFIGURED",
          message:
            "WITHDRAW_CONTRACT_NOT_CONFIGURED: backend contract table missing",
        },
      },
    ];
  }
  if (config.consumerWithdrawMode === "matured") {
    return [
      400,
      {
        detail: {
          code: "INSUFFICIENT_MATURE_CONSUMER_BALANCE",
          message:
            "WITHDRAW_MATURE_BALANCE_REQUIRED: ledger matured funds unavailable",
        },
      },
    ];
  }
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
  if (config.providerWithdrawMode === "minimum") {
    return [
      400,
      {
        detail: {
          code: "MIN_WITHDRAWAL_AMOUNT_NOT_MET",
          message: "PROVIDER_MIN_WITHDRAWAL_AMOUNT_NOT_MET backend policy",
        },
      },
    ];
  }
  if (config.providerWithdrawMode === "pending") {
    return [
      409,
      {
        detail: {
          code: "PENDING_WITHDRAWAL_EXISTS",
          message: "WITHDRAW_TICKET already active for request ID abc",
        },
      },
    ];
  }
  if (config.providerWithdrawMode === "rejected") {
    return [
      400,
      {
        detail: {
          code: "ACTION_REJECTED",
          message: "User denied message signature",
        },
      },
    ];
  }
  if (config.providerWithdrawMode === "rpc") return [503, rawRpcErrorPayload()];
  if (config.providerWithdrawMode === "unknown") {
    return [
      503,
      {
        detail:
          "503: {'code': 'HTTPException', 'message': 'backend ledger error'}",
      },
    ];
  }
  return [
    200,
    {
      withdrawalId: "pwd_fixture",
      status: "PENDING_MANUAL_REVIEW",
      amountUsdc: "12.60",
    },
  ];
}

function providerEarningsResponse(config) {
  return {
    summary: {
      ownerAddress: TEST_ADDRESS,
      totalApiCalls: 0,
      totalEarned: config.providerReceivable,
      totalProtocolFee: 0,
      totalRoutingTax: 0,
      providerNetEarned: config.providerReceivable,
      providerReceivable: config.providerReceivable,
      providerMatureReceivable: config.providerMatureReceivable,
      duplicateRowsDropped: 0,
      idempotencyKey: "fixture",
      recentCalls: [],
    },
  };
}

function providerWithdrawalRecord() {
  return {
    id: "pwd_raw_history_fixture",
    withdrawalId: "pwd_raw_history_fixture",
    ownerAddress: TEST_ADDRESS,
    amountUsdc: "12.60",
    status: "PENDING_MANUAL_REVIEW",
    message:
      "WITHDRAW_TICKET ticket_123 blocked in backend ledger layer; request ID req_raw was dedupe-protected",
    nonce: 7,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    txHash: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
    return fulfillJson(route, 200, {
      withdrawals:
        config.providerHistoryMode === "raw"
          ? [providerWithdrawalRecord()]
          : [],
    });
  if (pathKey === "/api/v1/providers/withdrawals/intent")
    return fulfillJson(route, ...providerWithdrawIntentResponse(config));
  if (pathKey === "/api/v1/providers/earnings/summary")
    return fulfillJson(route, 200, providerEarningsResponse(config));
  return null;
}

function notificationResponse(config) {
  if (config.notificationMode !== "raw") {
    return { notifications: [], nextCursor: null };
  }
  return {
    notifications: [
      {
        notificationId: "inapp-withdrawal-raw",
        eventType: "provider_withdrawal.created",
        category: "withdrawal",
        severity: "warning",
        priority: "transactional_high",
        title: "WITHDRAW_TICKET PENDING_MANUAL_REVIEW",
        body: "Withdrawal pwd_raw is PENDING_MANUAL_REVIEW because backend ledger ticket signing returned CHAIN_RPC_UNAVAILABLE 503.",
        actionUrl: "/provider/withdraw",
        resourceType: "provider_withdrawal",
        resourceId: "pwd_raw",
        payload: {
          code: "PROVIDER_RECEIVABLE_NOT_MATURED",
          message: "HTTPException backend ticket failed",
        },
        readAt: null,
        archivedAt: null,
        expiresAt: null,
        createdAt: new Date().toISOString(),
      },
    ],
    nextCursor: null,
  };
}

function handleNotificationRoute(route, config, pathKey, method) {
  if (pathKey === "/api/v1/notifications/unread-count")
    return fulfillJson(route, 200, {
      unreadCount: config.notificationMode === "raw" ? 1 : 0,
    });
  if (pathKey === "/api/v1/notifications" && method === "GET")
    return fulfillJson(route, 200, notificationResponse(config));
  if (pathKey.endsWith("/read") || pathKey.endsWith("/archive"))
    return fulfillJson(route, 200, { success: true });
  if (pathKey === "/api/v1/notifications/mark-all-read")
    return fulfillJson(route, 200, { updated: 1 });
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
    handleNotificationRoute,
  ];
  for (const handler of handlers) {
    const response = handler(route, config, pathKey, method);
    if (response) return response;
  }
  return fulfillJson(route, 200, { success: true });
}

export async function installGatewayMocks(page, options = {}) {
  const config = routeOptions(options);
  await page.route("http://127.0.0.1:8545/**", mockLocalRpc);
  await page.route("http://localhost:8545/**", mockLocalRpc);
  await page.route("**/api/v1/**", (route) =>
    handleGatewayRoute(route, config)
  );
}
