import crypto from "node:crypto";

export function createAdminWithdrawalApprovalHelpers({
  adminGatewayUrl,
  adminCookieName,
  adminEmail,
  adminPassword,
  adminTotpSecret,
  api,
  apiBase,
  chainId,
  ethers,
  fail,
  getChainContext,
  log,
  moneyFromObject,
  runId,
  servicePriceUsdc,
  sleep,
}) {
  async function issueProviderSecret({ token, address }) {
    const payload = (
      await api("/v1/secrets/provider/issue", {
        method: "POST",
        token,
        address,
        body: {
          name: `awa-provider-secret-${runId}`,
          rpm: 60,
          creditLimit: "1000",
          expiration: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
        },
      })
    ).payload;
    const secret = payload.secret || payload.credential || payload;
    return {
      id: secret.id || secret.credentialId || "",
      tokenPrefix: secret.tokenPrefix || secret.secretPrefix || "",
    };
  }

  function serviceId() {
    return `awa_provider_withdraw_${runId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  }

  async function registerService({ token, address, mockUrl }) {
    const id = serviceId();
    const payload = buildServicePayload({ address, id, mockUrl });
    const response = (
      await api("/v1/services", {
        method: "POST",
        token,
        address,
        body: payload,
      })
    ).payload;
    const service = response.service || response;
    const createdServiceId = service.serviceId || response.serviceId || id;
    log(`service registered: ${createdServiceId} (${servicePriceUsdc} USDC)`);
    return {
      id: createdServiceId,
      name: service.serviceName || payload.serviceName,
      priceUsdc: servicePriceUsdc,
      mockUrl,
    };
  }

  function buildServicePayload({ address, id, mockUrl }) {
    return {
      serviceName: `Admin Withdrawal Approval Provider ${runId}`,
      agentToolName: id,
      role: "Provider",
      pricing: { currency: "USDC", amount: servicePriceUsdc },
      summary:
        "Provider service used to generate real receivable for admin withdrawal approval dogfood.",
      tags: ["admin-withdrawal-approval", "verification"],
      providerProfile: { displayName: "Admin Withdrawal Approval Provider" },
      payoutAccount: {
        payoutAddress: address,
        chainId,
        settlementCurrency: "USDC",
        status: "active",
      },
      governance: { termsAccepted: true, riskAcknowledged: true, note: runId },
      healthCheck: {
        path: "/health",
        method: "GET",
        intervalSec: 15,
        timeoutMs: 5000,
        successCodes: [200],
        healthyThreshold: 1,
        unhealthyThreshold: 1,
      },
      constraints: {
        timeoutMs: 15000,
        maxResponseBytes: 500000,
        maxRequestBytes: 100000,
        maxQps: 50,
        maxConcurrency: 4,
      },
      forwarding: {
        requestIdHeader: "X-Synapse-Request-Id",
        passThroughHeaders: [],
        injectHeaders: {},
        retryPolicy: {
          maxAttempts: 1,
          backoffMs: 200,
          retryOnStatus: [429, 500, 502, 503, 504],
        },
      },
      metering: {
        billingUnit: "per_call",
        billOnError: false,
        billableStatusClasses: [2],
        requestIdRequired: true,
        responseSizeMetering: true,
      },
      invoke: {
        method: "POST",
        targets: [{ url: mockUrl, weight: 100, region: "local" }],
        timeoutMs: 15000,
        request: {
          contentType: "application/json",
          schema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
        response: {
          schema: {
            type: "object",
            properties: {
              status: { type: "string" },
              echo: { type: "object" },
            },
          },
        },
        headersTemplate: {},
        examples: [{ query: "approval verification" }],
      },
      isActive: true,
      status: "active",
    };
  }

  async function waitForServiceDiscoverable(id) {
    for (let i = 0; i < 30; i += 1) {
      const payload = (
        await api(`/v1/services/discover?q=${encodeURIComponent(id)}`)
      ).payload;
      const services = Array.isArray(payload.services) ? payload.services : [];
      const found = services.find((service) =>
        [service.serviceId, service.service_id, service.agentToolName].includes(
          id
        )
      );
      if (
        found &&
        found.isActive !== false &&
        found.runtimeAvailable !== false
      ) {
        log(`service discoverable and callable: ${id}`);
        return found;
      }
      await sleep(3000);
    }
    fail(`service was not discoverable/callable after health probes: ${id}`);
  }

  async function issueAgentCredential({ token, address }) {
    const payload = (
      await api("/v1/credentials/agent/issue", {
        method: "POST",
        token,
        address,
        body: {
          name: `awa-agent-${runId}`,
          rpm: 60,
          maxCalls: 10,
          creditLimit: "1000",
          resetInterval: "daily",
        },
      })
    ).payload;
    const credential = payload.credential || payload;
    const credentialToken =
      credential.token || credential.secretKey || credential.agentToken;
    if (!credential?.id || !credentialToken) {
      fail("agent credential issue response missing id or token");
    }
    log(`agent credential issued: ${credential.id}`);
    return {
      id: credential.id,
      token: credentialToken,
      tokenPrefix: credential.tokenPrefix || credential.secretPrefix || "",
    };
  }

  async function invokeService({ credentialToken, service }) {
    const requestId = `awa-invoke-${runId}`;
    let response = null;
    let lastFailure = null;
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const result = await api("/v1/agent/invoke", {
        method: "POST",
        headers: {
          "X-Credential": credentialToken,
          "X-Service-Id": service.id,
          "X-Request-Id": requestId,
        },
        body: {
          serviceId: service.id,
          idempotencyKey: requestId,
          costUsdc: service.priceUsdc,
          payload: { body: { query: `verify ${runId}` } },
          responseMode: "sync",
        },
        expectOk: false,
      });
      if (result.response.ok) {
        response = result.payload;
        break;
      }
      const code = result.payload?.detail?.code || result.payload?.code || "";
      lastFailure = `${result.response.status} ${JSON.stringify(
        result.payload
      ).slice(0, 400)}`;
      if (
        ![
          "SERVICE_UNAVAILABLE",
          "SERVICE_BUSY",
          "SERVICE_CIRCUIT_OPEN",
        ].includes(code)
      ) {
        fail(`POST /v1/agent/invoke failed: ${lastFailure}`);
      }
      log(`invoke retry ${attempt}/12: ${lastFailure}`);
      await sleep(2500);
    }
    if (!response)
      fail(`POST /v1/agent/invoke failed after retries: ${lastFailure}`);
    const receipt = response.payload?.receipt || response.receipt || {};
    if (!receipt.invocationId) {
      fail(
        `invoke response missing invocationId: ${JSON.stringify(response).slice(
          0,
          800
        )}`
      );
    }
    log(`paid invoke completed: ${receipt.invocationId}`);
    return {
      requestId,
      invocationId: receipt.invocationId,
      totalChargeUsdc: moneyFromObject(
        receipt,
        ["totalCharge", "totalChargeUsdc", "chargedUsdc"],
        service.priceUsdc
      ),
      serviceUnitPrice: moneyFromObject(
        receipt,
        ["serviceUnitPrice", "unitPrice"],
        service.priceUsdc
      ),
      providerNetUsdc: moneyFromObject(
        receipt,
        ["providerNetUsdc", "providerNet"],
        "0"
      ),
      platformFeeUsdc: moneyFromObject(
        receipt,
        ["platformFeeUsdc", "platformFee"],
        "0"
      ),
    };
  }

  function base32ToBuffer(secret) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const char of String(secret)
      .replace(/=+$/g, "")
      .replace(/\s+/g, "")
      .toUpperCase()) {
      const value = alphabet.indexOf(char);
      if (value < 0)
        throw new Error(
          `Invalid base32 character in ADMIN_TOTP_SECRET: ${char}`
        );
      bits += value.toString(2).padStart(5, "0");
    }
    const bytes = [];
    for (let index = 0; index + 8 <= bits.length; index += 8) {
      bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
    }
    return Buffer.from(bytes);
  }

  function generateTotpCode(secret, nowMs = Date.now()) {
    const counter = Math.floor(nowMs / 1000 / 30);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    const digest = crypto
      .createHmac("sha1", base32ToBuffer(secret))
      .update(counterBuffer)
      .digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);
    return String(binary % 1_000_000).padStart(6, "0");
  }

  function parseSessionCookie(setCookieHeader) {
    const header = Array.isArray(setCookieHeader)
      ? setCookieHeader.join(",")
      : String(setCookieHeader || "");
    const match = header
      .split(/,(?=\s*[^;,]+=)/)
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${adminCookieName}=`));
    return match ? match.split(";")[0].slice(adminCookieName.length + 1) : "";
  }

  async function loginAdmin() {
    if (process.env.ADMIN_SESSION_TOKEN) {
      return {
        sessionToken: process.env.ADMIN_SESSION_TOKEN,
        csrfToken: process.env.ADMIN_CSRF_TOKEN || "",
        admin: null,
      };
    }
    const response = await fetch(`${adminGatewayUrl}/api/admin/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminEmail,
        password: adminPassword,
        otpCode:
          process.env.ADMIN_OTP_CODE || generateTotpCode(adminTotpSecret),
      }),
    });
    const body = await response.json().catch(() => ({}));
    const setCookie =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : response.headers.get("set-cookie");
    const sessionToken = parseSessionCookie(setCookie);
    if (!response.ok || !body.success || !sessionToken) {
      fail(
        `Admin login failed: ${response.status} ${JSON.stringify(body).slice(
          0,
          800
        )}`
      );
    }
    return {
      sessionToken,
      csrfToken: body.data?.csrfToken || "",
      admin: body.data?.admin || null,
    };
  }

  async function adminApi(pathname, auth) {
    const response = await fetch(`${adminGatewayUrl}${pathname}`, {
      headers: {
        Accept: "application/json",
        Cookie: `${adminCookieName}=${auth.sessionToken}`,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.success) {
      fail(
        `Admin API failed ${pathname}: ${response.status} ${JSON.stringify(
          body
        ).slice(0, 800)}`
      );
    }
    return body.data;
  }

  async function invalidInternalTokenReview({ withdrawalId, ownerAddress }) {
    const response = await fetch(
      `${apiBase}/v1/admin/providers/withdrawals/${encodeURIComponent(
        withdrawalId
      )}/review`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: "Bearer invalid-admin-withdrawal-approval-token",
          "X-Request-Id": `awa-invalid-internal-token-${runId}`,
        },
        body: JSON.stringify({
          ownerAddress,
          reviewDecision: "APPROVE",
          reviewerAddress: ownerAddress,
          reviewerNote: "This must fail before touching balances.",
        }),
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (response.ok)
      fail("Invalid internal token unexpectedly reviewed withdrawal.");
    const code = payload.error?.code || payload.detail?.code || payload.code;
    if (
      code !== "INTERNAL_TOKEN_INVALID" &&
      response.status !== 401 &&
      response.status !== 403
    ) {
      fail(
        `Invalid internal token returned unexpected response: ${
          response.status
        } ${JSON.stringify(payload).slice(0, 500)}`
      );
    }
    log(
      `invalid internal token rejected: status=${response.status} code=${
        code || "n/a"
      }`
    );
    return { status: response.status, code: code || null, payload };
  }

  async function readChainBalances(address) {
    const { provider, coreAddress, usdcAddress, usdcAbi } =
      await getChainContext();
    const usdc = new ethers.Contract(usdcAddress, usdcAbi, provider);
    const decimals = Number(await usdc.decimals());
    const providerAtomic = await usdc.balanceOf(address);
    const vaultAtomic = await usdc.balanceOf(coreAddress);
    return {
      decimals,
      providerUsdcAtomic: providerAtomic.toString(),
      providerUsdc: ethers.formatUnits(providerAtomic, decimals),
      vaultUsdcAtomic: vaultAtomic.toString(),
      vaultUsdc: ethers.formatUnits(vaultAtomic, decimals),
    };
  }

  return {
    adminApi,
    invalidInternalTokenReview,
    invokeService,
    issueAgentCredential,
    issueProviderSecret,
    loginAdmin,
    readChainBalances,
    registerService,
    waitForServiceDiscoverable,
  };
}
