import crypto from "node:crypto";
import { waitForSafeTotpWindow } from "../lib/totp_window.mjs";

export function createAdminWithdrawalApprovalHelpers({
  adminGatewayUrl,
  adminCookieName,
  adminEmail,
  adminPassword,
  adminTotpSecret,
  api,
  apiBase,
  ethers,
  fail,
  getChainContext,
  log,
  moneyFromObject,
  runId,
  sleep,
}) {
  const E2E_CREDENTIAL_PREFIXES = [
    "awa-agent-",
    "wr-staging-",
    "staging-load-",
    "e2e-agent-",
    "api-ref-test-",
    "inv-test-",
    "provider-gpp-e2e-local-",
    "consumer-test-",
  ];

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

  async function listActiveAgentCredentials({ token, address }) {
    const payload = (
      await api("/v1/credentials/agent/list?active_only=true", {
        token,
        address,
      })
    ).payload;
    return Array.isArray(payload?.credentials)
      ? payload.credentials
      : Array.isArray(payload?.data?.credentials)
      ? payload.data.credentials
      : [];
  }

  async function revokeAgentCredential({ token, address }, credentialId) {
    const result = await api(
      `/v1/credentials/agent/${encodeURIComponent(credentialId)}/revoke`,
      {
        method: "POST",
        token,
        address,
        expectOk: false,
      }
    );
    return [200, 204, 404].includes(result.response.status);
  }

  async function rotateAgentCredential({ token, address }, credentialId) {
    const payload = (
      await api(
        `/v1/credentials/agent/${encodeURIComponent(credentialId)}/rotate`,
        {
          method: "POST",
          token,
          address,
        }
      )
    ).payload;
    const credential = payload.credential || payload;
    const credentialToken =
      credential.token || credential.secretKey || credential.agentToken;
    if (!credential?.id || !credentialToken) {
      fail("agent credential rotate response missing id or token");
    }
    return {
      id: credential.id,
      token: credentialToken,
      tokenPrefix: credential.tokenPrefix || credential.secretPrefix || "",
    };
  }

  async function reclaimE2eCredentialSlots(auth) {
    const credentials = await listActiveAgentCredentials(auth);
    let revoked = 0;
    for (const credential of credentials) {
      const name = String(credential.name || "").trim();
      if (!E2E_CREDENTIAL_PREFIXES.some((prefix) => name.startsWith(prefix))) {
        continue;
      }
      const credentialId =
        credential.credentialId || credential.credential_id || credential.id || "";
      if (!credentialId) continue;
      if (await revokeAgentCredential(auth, credentialId)) {
        revoked += 1;
      }
    }
    return revoked;
  }

  async function rotateExistingE2eCredential(auth) {
    const credentials = await listActiveAgentCredentials(auth);
    const candidate = credentials.find((credential) => {
      const name = String(credential.name || "").trim();
      return E2E_CREDENTIAL_PREFIXES.some((prefix) => name.startsWith(prefix));
    });
    const credentialId =
      candidate?.credentialId || candidate?.credential_id || candidate?.id || "";
    if (!credentialId) {
      return null;
    }
    return rotateAgentCredential(auth, credentialId);
  }

  async function issueAgentCredential({ token, address }) {
    const auth = { token, address };
    let result = await api("/v1/credentials/agent/issue", {
      method: "POST",
      token,
      address,
      body: {
        name: `awa-agent-${runId}`,
        rpm: 600,
        maxCalls: 500,
        creditLimit: "1000",
        resetInterval: "daily",
      },
      expectOk: false,
    });
    const errorCode =
      result.payload?.detail?.code ||
      result.payload?.error?.code ||
      result.payload?.code;
    if (
      result.response.status === 409 &&
      String(errorCode).includes("AGENT_CREDENTIAL_LIMIT_REACHED")
    ) {
      const revoked = await reclaimE2eCredentialSlots(auth);
      log(`agent credential slots reclaimed: ${revoked}`);
      result = await api("/v1/credentials/agent/issue", {
        method: "POST",
        token,
        address,
        body: {
          name: `awa-agent-${runId}`,
          rpm: 600,
          maxCalls: 500,
          creditLimit: "1000",
          resetInterval: "daily",
        },
        expectOk: false,
      });
      if (
        result.response.status === 409 &&
        String(
          result.payload?.detail?.code ||
            result.payload?.error?.code ||
            result.payload?.code
        ).includes("AGENT_CREDENTIAL_LIMIT_REACHED")
      ) {
        const rotated = await rotateExistingE2eCredential(auth);
        if (rotated) {
          log(`agent credential rotated: ${rotated.id}`);
          return rotated;
        }
      }
    }
    if (!result.response.ok || result.payload?.success === false) {
      fail(
        `POST /v1/credentials/agent/issue failed: ${result.response.status} ${JSON.stringify(
          result.payload
        ).slice(0, 900)}`
      );
    }
    const payload = result.payload;
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

  async function invokeService({ credentialToken, service, sequence = 1 }) {
    const requestId = `awa-invoke-${runId}-${sequence}`;
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
          payload: {
            body: service.invokePayload || { prompt: `verify ${runId}` },
          },
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
    await waitForSafeTotpWindow({ guardSeconds: 10 });
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
  };
}
