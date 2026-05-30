#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_PAID_SERVICE_ID,
  CANONICAL_PROVIDER_SERVICE_IDS,
  canonicalInvokePayload,
} from "./lib/canonical_provider_service.mjs";
import { discoverProdCoreService } from "./lib/prod_core_discovery.mjs";
import { createProdCoreAuthHelpers } from "./lib/prod_core_e2e_auth.mjs";
import {
  assertProdUrl,
  checkCloudRunEnv,
  createProdCoreDbReaders,
  env,
  redact,
  sanitize,
  stripSlash,
} from "./lib/prod_core_e2e_support.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const GENERATED_AT = new Date();
const TIMESTAMP = GENERATED_AT.toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z");
const MODE = env("PROD_CORE_E2E_MODE", "smoke");
const RUN_ID = env(
  "PROD_CORE_E2E_RUN_ID",
  `prod-core-${MODE}-${Date.now().toString(36)}`
);
const OUT_DIR = path.resolve(
  env(
    "PROD_CORE_E2E_EVIDENCE_DIR",
    path.join(ROOT, "docs/evidence/prod/core-e2e", `${TIMESTAMP}-${MODE}`)
  )
);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const TRACE_PATH = path.join(OUT_DIR, "trace.jsonl");

const config = {
  userFrontUrl: stripSlash(
    env("PROD_USER_FRONT_URL", "https://synapse-network.ai")
  ),
  gatewayUrl: stripSlash(
    env("PROD_GATEWAY_URL", "https://api.synapse-network.ai")
  ),
  docsUrl: stripSlash(env("PROD_DOCS_URL", "https://docs.synapse-network.ai")),
  adminFrontUrl: stripSlash(
    env("PROD_ADMIN_FRONT_URL", "https://admin.synapse-network.ai")
  ),
  adminApiUrl: stripSlash(
    env("PROD_ADMIN_API_URL", "https://admin-api.synapse-network.ai")
  ),
  sqlDsn: env("PROD_GATEWAY_READONLY_DSN", ""),
  adminSqlDsn: env("PROD_ADMIN_READONLY_DSN", ""),
  rpcUrl: env("PROD_E2E_RPC_URL", env("ARBITRUM_ONE_RPC_URL", "")),
  contractConfigPath: path.resolve(
    env(
      "PROD_E2E_CONTRACT_CONFIG_PATH",
      path.join(
        ROOT,
        "services/user-front/src/contract-config.arbitrum-one.prod.json"
      )
    )
  ),
  consumerPrivateKey: env("PROD_E2E_CONSUMER_PRIVATE_KEY", ""),
  agentCredential: env("PROD_E2E_AGENT_CREDENTIAL", ""),
  serviceId: env(
    "PROD_E2E_SERVICE_ID",
    MODE === "free-invoke"
      ? "svc_oss_security_healthcheck"
      : CANONICAL_PAID_SERVICE_ID
  ),
  depositUsdc: env("PROD_E2E_DEPOSIT_USDC", "5.00"),
  issueCredentialIfMissing:
    env(
      "PROD_E2E_ISSUE_AGENT_CREDENTIAL",
      MODE === "free-invoke" ? "1" : "0"
    ) === "1",
  headless: env("PROD_CORE_E2E_HEADLESS", "1") !== "0",
  browserEvidence: env("PROD_CORE_E2E_BROWSER_EVIDENCE", "1") !== "0",
};

const evidence = {
  environment: "prod",
  mode: MODE,
  runId: RUN_ID,
  generatedAt: GENERATED_AT.toISOString(),
  checks: [],
  failed: [],
  warnings: [],
  api: [],
  db: {},
  chain: {},
  screenshots: [],
  blocked: [],
};
const traceRows = [];
const dbReaders = createProdCoreDbReaders({
  root: ROOT,
  postgresDsn: config.sqlDsn,
  canonicalServices: CANONICAL_PROVIDER_SERVICE_IDS,
  agentCredential: config.agentCredential,
});

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function addCheck(name, ok, details = {}, error = "") {
  const row = {
    name,
    ok: Boolean(ok),
    details: sanitize(details),
    error: redact(error),
  };
  evidence.checks.push(row);
  if (!row.ok) evidence.failed.push(row);
  console.log(`[prod-core-e2e] ${row.ok ? "PASS" : "FAIL"} ${name}`);
  return row;
}

function addTrace(row) {
  traceRows.push(
    sanitize({
      runId: RUN_ID,
      timestamp: new Date().toISOString(),
      requestId: `${RUN_ID}:${traceRows.length + 1}`,
      ...row,
    })
  );
}

function fatal(message) {
  throw new Error(message);
}

function requireEnv(name) {
  const value = env(name, "");
  if (!value) fatal(`Missing required production E2E config: ${name}`);
  return value;
}

async function loadEthers() {
  try {
    return await import("ethers");
  } catch {
    fatal(
      "Small-value prod E2E requires the ethers package. Run from an environment with service/user-front dependencies installed, or install root dev dependencies first."
    );
  }
}

async function loadChromium() {
  try {
    const module = await import("playwright");
    return module.chromium;
  } catch {
    fatal(
      "Browser evidence requires the playwright package. Set PROD_CORE_E2E_BROWSER_EVIDENCE=0 for API/SQL-only runs or install Playwright dependencies."
    );
  }
}

function assertSafety() {
  if (env("SYNAPSE_E2E_ENV", "prod") !== "prod") {
    fatal("Refusing to run prod core E2E unless SYNAPSE_E2E_ENV=prod.");
  }
  assertProdUrl(
    "PROD_USER_FRONT_URL",
    config.userFrontUrl,
    "synapse-network.ai"
  );
  assertProdUrl(
    "PROD_GATEWAY_URL",
    config.gatewayUrl,
    "api.synapse-network.ai"
  );
  assertProdUrl("PROD_DOCS_URL", config.docsUrl, "docs.synapse-network.ai");
  assertProdUrl(
    "PROD_ADMIN_FRONT_URL",
    config.adminFrontUrl,
    "admin.synapse-network.ai"
  );
  assertProdUrl(
    "PROD_ADMIN_API_URL",
    config.adminApiUrl,
    "admin-api.synapse-network.ai"
  );
  if (!["smoke", "free-invoke", "small-value"].includes(MODE))
    fatal(`Unknown PROD_CORE_E2E_MODE=${MODE}`);
  if (MODE === "free-invoke") {
    if (
      ![
        "I_UNDERSTAND_THIS_MUTATES_PROD_FREE_INVOKE",
        "I_UNDERSTAND_THIS_MUTATES_PROD_SMALL_VALUE",
      ].includes(env("PROD_E2E_CONFIRM"))
    ) {
      fatal(
        "Free prod invoke requires PROD_E2E_CONFIRM=I_UNDERSTAND_THIS_MUTATES_PROD_FREE_INVOKE."
      );
    }
    requireEnv("PROD_E2E_CONSUMER_PRIVATE_KEY");
  }
  if (MODE === "small-value") {
    if (
      env("PROD_E2E_CONFIRM") !== "I_UNDERSTAND_THIS_MUTATES_PROD_SMALL_VALUE"
    ) {
      fatal(
        "Small-value prod E2E requires PROD_E2E_CONFIRM=I_UNDERSTAND_THIS_MUTATES_PROD_SMALL_VALUE."
      );
    }
    requireEnv("PROD_E2E_CONSUMER_PRIVATE_KEY");
    if (!config.agentCredential && !config.issueCredentialIfMissing) {
      requireEnv("PROD_E2E_AGENT_CREDENTIAL");
    }
    requireEnv("PROD_E2E_RPC_URL");
    requireEnv("PROD_GATEWAY_READONLY_DSN");
    const amount = Number(config.depositUsdc);
    if (!Number.isFinite(amount) || amount < 5) {
      fatal("PROD_E2E_DEPOSIT_USDC must be at least 5.00.");
    }
  }
}

async function timedFetch(url, options = {}) {
  const started = Date.now();
  const response = await fetch(url, {
    redirect: "manual",
    ...options,
    headers: {
      Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  return { response, text, durationMs: Date.now() - started };
}

async function httpCheck(
  name,
  url,
  { expectJson = false, allow = [200] } = {}
) {
  try {
    const result = await timedFetch(url);
    let json = null;
    if (expectJson && result.text) json = JSON.parse(result.text);
    const ok = allow.includes(result.response.status) && (!expectJson || json);
    addCheck(name, ok, {
      url,
      status: result.response.status,
      json,
      excerpt: result.text.slice(0, 300),
    });
    addTrace({
      scenario: name,
      method: "GET",
      path: url,
      httpStatus: result.response.status,
      durationMs: result.durationMs,
      reconciliationStatus: ok ? "passed" : "failed",
    });
    return { ok, json, text: result.text, status: result.response.status };
  } catch (error) {
    addCheck(name, false, { url }, error.message);
    addTrace({
      scenario: name,
      method: "GET",
      path: url,
      httpStatus: 0,
      actual: error.message,
      reconciliationStatus: "failed",
    });
    return { ok: false, error };
  }
}

async function api(
  pathname,
  {
    method = "GET",
    token = "",
    address = "",
    credential = "",
    body,
    headers = {},
    expectOk = true,
  } = {}
) {
  const requestHeaders = { Accept: "application/json", ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (address) requestHeaders["X-User-Address"] = address;
  if (credential) requestHeaders["X-Credential"] = credential;
  const started = Date.now();
  const response = await fetch(`${config.gatewayUrl}/api${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  const record = {
    method,
    path: `/api${pathname}`,
    httpStatus: response.status,
    durationMs: Date.now() - started,
    request: { headers: requestHeaders, body },
    response: payload,
  };
  evidence.api.push(sanitize(record));
  addTrace({
    scenario: `api:${method}:${pathname}`,
    method,
    path: `/api${pathname}`,
    httpStatus: response.status,
    durationMs: record.durationMs,
    reconciliationStatus: response.ok ? "passed" : "failed",
  });
  if (expectOk && !response.ok)
    fatal(
      `${method} ${pathname} failed ${response.status}: ${redact(
        text.slice(0, 800)
      )}`
    );
  return { response, payload };
}

const { authenticateOwner, ensureAgentCredential } = createProdCoreAuthHelpers({
  api,
  addCheck,
  config,
  dbReaders,
  evidence,
  fatal,
  mode: MODE,
});

async function checkSmoke() {
  await httpCheck("public:user-front-home", `${config.userFrontUrl}/`);
  await httpCheck("public:gateway-health", `${config.gatewayUrl}/health`, {
    expectJson: true,
  });
  await httpCheck("public:admin-front-login", `${config.adminFrontUrl}/login`);
  await httpCheck("public:admin-api-health", `${config.adminApiUrl}/health`, {
    expectJson: true,
  });
  await httpCheck("public:docs-home", `${config.docsUrl}/`);
  await httpCheck("public:docs-llms", `${config.docsUrl}/llms.txt`);
  await httpCheck("public:docs-openapi", `${config.docsUrl}/openapi.json`, {
    expectJson: true,
  });

  if (config.sqlDsn) {
    const serviceDb = dbReaders.readServiceDb();
    evidence.db.services = serviceDb;
    const activeCanonical = (serviceDb?.canonical || []).filter(
      (row) => row.status === "active"
    );
    addCheck("sql:canonical-provider-services", activeCanonical.length > 0, {
      activeCanonical: activeCanonical.map((row) => row.service_id),
      evidence: "sql-evidence.json",
    });
    if (config.agentCredential) {
      const credential = dbReaders.readCredentialDb();
      evidence.db.credential = credential;
      addCheck("sql:agent-credential-active", credential?.status === "active", {
        credential,
        evidence: "sql-evidence.json",
      });
    }
  } else if (MODE === "free-invoke") {
    evidence.warnings.push(
      "PROD_GATEWAY_READONLY_DSN missing; SQL evidence skipped for free invoke."
    );
    addCheck("sql:readonly-dsn-optional-for-free-invoke", true, {
      note: "Free invoke mode validates public/API flow without chain or SQL writes.",
    });
  } else {
    evidence.warnings.push(
      "PROD_GATEWAY_READONLY_DSN missing; SQL smoke checks skipped."
    );
    addCheck(
      "sql:readonly-dsn-configured",
      false,
      {},
      "Set PROD_GATEWAY_READONLY_DSN via Cloud SQL Auth Proxy."
    );
  }

  await checkCloudRunEnv({ root: ROOT, evidence, addCheck });
}

async function chainContext() {
  const { ethers } = await loadEthers();
  const contractConfig = JSON.parse(
    fs.readFileSync(config.contractConfigPath, "utf8")
  );
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  if (
    Number(network.chainId) !== 42161 ||
    Number(contractConfig.chainId) !== 42161
  ) {
    fatal(
      `Prod chain must be Arbitrum One 42161; rpc=${network.chainId} config=${contractConfig.chainId}`
    );
  }
  return {
    provider,
    coreAddress: ethers.getAddress(contractConfig.SynapseCore),
    usdcAddress: ethers.getAddress(contractConfig.MockUSDC),
    coreAbi: JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "services/user-front/src/SynapseCoreABI.json"),
        "utf8"
      )
    ),
    usdcAbi: JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "services/user-front/src/MockUSDCABI.json"),
        "utf8"
      )
    ),
  };
}

async function depositSmallValue(auth) {
  const { ethers } = await loadEthers();
  const { provider, coreAddress, usdcAddress, coreAbi, usdcAbi } =
    await chainContext();
  const wallet = new ethers.Wallet(config.consumerPrivateKey, provider);
  const usdc = new ethers.Contract(usdcAddress, usdcAbi, wallet);
  const core = new ethers.Contract(coreAddress, coreAbi, wallet);
  const decimals = Number(await usdc.decimals());
  const amountAtomic = ethers.parseUnits(config.depositUsdc, decimals);
  const [usdcBalance, nativeBalance] = await Promise.all([
    usdc.balanceOf(wallet.address),
    provider.getBalance(wallet.address),
  ]);
  if (usdcBalance < amountAtomic)
    fatal(`Prod E2E wallet lacks ${config.depositUsdc} USDC.`);
  if (nativeBalance <= 0n)
    fatal("Prod E2E wallet has no Arbitrum ETH for gas.");

  const approval = await usdc.approve(coreAddress, amountAtomic);
  const approvalReceipt = await approval.wait();
  if (approvalReceipt?.status !== 1)
    fatal(`USDC approve failed: ${approval.hash}`);
  const depositTx = await core.deposit(amountAtomic);
  const receipt = await depositTx.wait();
  if (receipt?.status !== 1)
    fatal(`SynapseCore deposit failed: ${depositTx.hash}`);

  const intent = await api("/v1/balance/deposit/intent", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    headers: {
      "X-Idempotency-Key": `prod-small-deposit-${depositTx.hash.slice(2, 80)}`,
    },
    body: { txHash: depositTx.hash, amountUsdc: config.depositUsdc },
  });
  const depositId =
    intent.payload.intent?.id || intent.payload.intent?.depositId || "";
  await api(
    `/v1/balance/deposit/sync?txHash=${encodeURIComponent(depositTx.hash)}`,
    {
      token: auth.token,
      address: auth.address,
      expectOk: false,
    }
  );

  const deadline =
    Date.now() + Number(env("PROD_E2E_DEPOSIT_WAIT_SEC", "360")) * 1000;
  let db = null;
  do {
    db = dbReaders.readDepositDb(depositTx.hash);
    if (String(db?.deposit?.status || "").toUpperCase() === "CONFIRMED") break;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  } while (Date.now() < deadline);

  evidence.chain.deposit = {
    txHash: depositTx.hash,
    approveTxHash: approval.hash,
    amountUsdc: config.depositUsdc,
    coreAddress,
    usdcAddress,
    depositId,
  };
  evidence.db.deposit = db;
  addCheck(
    "money:deposit-confirmed-once",
    String(db?.deposit?.status || "").toUpperCase() === "CONFIRMED",
    {
      txHash: depositTx.hash,
      status: db?.deposit?.status,
      evidence: "sql-evidence.json",
    }
  );
  return { txHash: depositTx.hash, depositId };
}

async function discoverService() {
  return discoverProdCoreService({
    api,
    addCheck,
    fatal,
    mode: MODE,
    serviceId: config.serviceId,
  });
}

async function invokeService(service, { requireDb = true } = {}) {
  const idempotencyKey = `${RUN_ID}:invoke:${Date.now().toString(36)}`;
  const result = await api("/v1/agent/invoke", {
    method: "POST",
    credential: config.agentCredential,
    headers: {
      "X-Service-Id": config.serviceId,
      "X-Request-Id": idempotencyKey,
    },
    body: {
      serviceId: config.serviceId,
      idempotencyKey,
      costUsdc: service.priceUsdc,
      responseMode: "sync",
      payload: { body: canonicalInvokePayload(config.serviceId) },
    },
  });
  const receipt =
    result.payload.receipt || result.payload.data?.receipt || result.payload;
  const invocationId = receipt.invocationId || result.payload.invocationId;
  if (!invocationId) fatal("Prod invoke response missing invocationId.");
  addCheck("invoke:response-has-invocation-id", true, {
    invocationId,
    serviceId: config.serviceId,
  });
  if (config.sqlDsn) {
    const db = dbReaders.readInvocationDb(invocationId);
    evidence.db.invocation = db;
    addCheck("invoke:settled-db-evidence", Boolean(db?.invocation), {
      invocationId,
      status: db?.invocation?.status,
      evidence: "sql-evidence.json",
    });
  } else if (requireDb) {
    addCheck(
      "invoke:settled-db-evidence",
      false,
      { invocationId },
      "Set PROD_GATEWAY_READONLY_DSN to validate invocation SQL evidence."
    );
  } else {
    evidence.warnings.push(
      "PROD_GATEWAY_READONLY_DSN missing; invocation SQL evidence skipped."
    );
  }
  return { invocationId, response: result.payload };
}

async function verifyWithdrawalMaturity(auth) {
  const owner = dbReaders.readOwnerDb(auth.address);
  evidence.db.ownerAfter = owner;
  const withdrawals = owner?.recentWithdrawals || [];
  const active = withdrawals.find(
    (row) =>
      ![
        "FAILED",
        "FAILED_EXPIRED",
        "REJECTED",
        "CANCELLED",
        "COMPLETED",
      ].includes(String(row.status))
  );
  if (active) {
    evidence.blocked.push({
      scenario: "consumer-withdrawal",
      reason: "active_withdrawal_exists",
      status: active.status,
    });
    addCheck("withdrawal:active-state-recorded", true, {
      status: active.status,
    });
    return;
  }
  evidence.blocked.push({
    scenario: "consumer-withdrawal",
    reason: "blocked_by_maturity_or_not_requested",
    note: "Runner does not bypass T+7; claim only runs with separate explicit operator flow.",
  });
  addCheck("withdrawal:t7-not-bypassed", true, {
    note: "consumer/provider withdrawal execution skipped unless a dedicated mature-funds runbook is invoked.",
  });
}

async function captureUi(auth) {
  if (!config.browserEvidence) return;
  const chromium = await loadChromium();
  const browser = await chromium.launch({
    headless: config.headless,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    await context.addInitScript(
      ({ address, token }) => {
        localStorage.setItem("synapse_lang", "en");
        localStorage.setItem("a2a_selected_role", "CONSUMER");
        localStorage.setItem(
          "a2a_auth_session",
          JSON.stringify({
            wallet: String(address).toLowerCase(),
            token,
            expiresAt: Date.now() + 86_400_000,
          })
        );
      },
      { address: auth.address, token: auth.token }
    );
    const page = await context.newPage();
    for (const item of [
      [
        "credits",
        `${config.userFrontUrl}/dashboard/billing/credits`,
        "Credits",
      ],
      ["billing", `${config.userFrontUrl}/dashboard/billing`, "Billing"],
      [
        "invocations",
        `${config.userFrontUrl}/dashboard/invocations`,
        "Invocations",
      ],
    ]) {
      await page.goto(item[1], {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.locator("body").waitFor({ timeout: 15_000 });
      await page
        .waitForFunction(
          (expected) => document.body?.textContent?.includes(expected),
          item[2],
          { timeout: 15_000 }
        )
        .catch(() => {});
      const body = await page
        .evaluate(() => document.body?.textContent || "")
        .catch(() => "");
      const forbidden =
        /503|HTTPException|RPC Error|CHAIN_RPC|PROVIDER_|WITHDRAW_/i.test(body);
      const file = path.join(SCREENSHOT_DIR, `${item[0]}.png`);
      await page.screenshot({ path: file, fullPage: true });
      evidence.screenshots.push(path.relative(OUT_DIR, file));
      addCheck(`ui:${item[0]}:renders`, body.includes(item[2]) && !forbidden, {
        url: item[1],
        screenshot: path.relative(OUT_DIR, file),
      });
    }
  } finally {
    await browser.close();
  }
}

async function runSmallValue() {
  const auth = await authenticateOwner();
  evidence.db.ownerBefore = dbReaders.readOwnerDb(auth.address);
  await ensureAgentCredential(auth);
  await depositSmallValue(auth);
  const service = await discoverService();
  await invokeService(service);
  await verifyWithdrawalMaturity(auth);
  await captureUi(auth);
}

async function runFreeInvoke() {
  const auth = await authenticateOwner();
  await ensureAgentCredential(auth);
  const service = await discoverService();
  await invokeService(service, { requireDb: false });
  await captureUi(auth);
}

function writeEvidence(status) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    TRACE_PATH,
    traceRows.map((row) => JSON.stringify(row)).join("\n") + "\n"
  );
  const traceDigest = crypto
    .createHash("sha256")
    .update(fs.readFileSync(TRACE_PATH))
    .digest("hex");
  const report = {
    environment: "prod",
    mode: MODE,
    status,
    runId: RUN_ID,
    generatedAt: evidence.generatedAt,
    failed: evidence.failed,
    warnings: evidence.warnings,
    blocked: evidence.blocked,
    checks: evidence.checks,
    traceDigest,
    artifacts: {
      report: "report.json",
      trace: "trace.jsonl",
      sqlEvidence: "sql-evidence.json",
      apiEvidence: "api-evidence.json",
      chainEvidence: "chain-evidence.json",
      screenshots: evidence.screenshots,
    },
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    `${JSON.stringify(sanitize(report), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "api-evidence.json"),
    `${JSON.stringify(sanitize(evidence.api), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "sql-evidence.json"),
    `${JSON.stringify(sanitize(evidence.db), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "chain-evidence.json"),
    `${JSON.stringify(sanitize(evidence.chain), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "environment-manifest.json"),
    `${JSON.stringify(
      sanitize({
        environment: "prod",
        mode: MODE,
        urls: {
          userFrontUrl: config.userFrontUrl,
          gatewayUrl: config.gatewayUrl,
          docsUrl: config.docsUrl,
          adminFrontUrl: config.adminFrontUrl,
          adminApiUrl: config.adminApiUrl,
        },
        sqlConfigured: Boolean(config.sqlDsn),
        rpcConfigured: Boolean(config.rpcUrl),
        serviceId: config.serviceId,
        depositUsdc: config.depositUsdc,
      }),
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      `# Production Core E2E ${MODE}`,
      "",
      `- Status: ${status}`,
      `- Generated: ${evidence.generatedAt}`,
      `- Run ID: ${RUN_ID}`,
      `- Failed checks: ${evidence.failed.length}`,
      `- Warnings: ${evidence.warnings.length}`,
      `- Blocked optional flows: ${evidence.blocked.length}`,
      "",
      "## Checks",
      ...evidence.checks.map(
        (check) => `- ${check.ok ? "PASS" : "FAIL"} ${check.name}`
      ),
      "",
    ].join("\n")
  );
  console.log(`[prod-core-e2e] evidence written: ${OUT_DIR}`);
}

async function main() {
  let status = "success";
  try {
    assertSafety();
    await checkSmoke();
    if (MODE === "free-invoke") await runFreeInvoke();
    if (MODE === "small-value") await runSmallValue();
    if (evidence.failed.length > 0) status = "failed";
  } catch (error) {
    status = "failed";
    addCheck("runner:uncaught-error", false, {}, error.stack || error.message);
  } finally {
    writeEvidence(status);
  }
  if (status !== "success") process.exitCode = 1;
}

await main();
