import http from "node:http";

export function renderBugfixLog(bugRows) {
  if (bugRows.length === 0) {
    return "# LLM DeepSeek E2E Bugfix Log\n\nNo open bugs.\n";
  }
  return [
    "# LLM DeepSeek E2E Bugfix Log",
    "",
    ...bugRows.flatMap((bug) => [
      `## ${bug.id}`,
      "",
      `- Severity: ${bug.severity}`,
      `- Scenario: ${bug.scenario}`,
      `- Evidence: ${bug.evidence || "n/a"}`,
      `- Repro Steps: ${bug.reproSteps}`,
      `- Expected: ${bug.expected}`,
      `- Actual: ${bug.actual}`,
      `- Status: ${bug.status}`,
      "",
    ]),
  ].join("\n");
}

export function renderReport(report) {
  return [
    "# LLM DeepSeek Gateway E2E",
    "",
    `- Environment: ${report.environment}`,
    `- Status: ${report.status}`,
    `- Generated at: ${report.generatedAt}`,
    `- Gateway: ${report.gatewayBaseUrl}`,
    `- Service: ${report.serviceId}`,
    `- Invocation: ${report.invocationId || "n/a"}`,
    `- Trace digest: ${report.traceDigest}`,
    "",
    "## Checks",
    "",
    "| Check | Status |",
    "| --- | --- |",
    ...report.checks.map(
      (check) => `| ${check.name} | ${check.ok ? "PASS" : "FAIL"} |`
    ),
    "",
  ].join("\n");
}

export function startLocalLlmFixtureServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    let requestBody = {};
    try {
      requestBody = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      requestBody = {};
    }

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (url.pathname === "/llm/timeout") {
      await new Promise((resolve) => setTimeout(resolve, 1600));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "timeout-too-late",
          choices: [],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      );
      return;
    }

    if (url.pathname === "/llm/missing-usage") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "missing-usage",
          choices: [{ message: { role: "assistant", content: "missing usage" } }],
        })
      );
      return;
    }

    if (url.pathname === "/llm/slow-success") {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const inputTokens = Array.isArray(requestBody.messages) ? 42 : 10;
      const outputTokens = 8;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "slow-success",
          model: "fixture/deepseek-chat",
          choices: [{ message: { role: "assistant", content: "slow success" } }],
          usage: {
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
          },
        })
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

export async function registerLocalLlmService(ctx, { scenario, targetUrl, timeoutMs }) {
  const {
    addCheck,
    addTrace,
    config,
    localProviderJwt,
    serviceSafeRunId,
    timedJsonFetch,
  } = ctx;
  const serviceKey = `llm_${scenario}_${serviceSafeRunId()}`;
  const inputPricePer1M = config.inputPricePer1MUsdc || "0.140000";
  const outputPricePer1M = config.outputPricePer1MUsdc || "0.280000";
  const body = localLlmServiceBody({
    config,
    inputPricePer1M,
    outputPricePer1M,
    scenario,
    serviceKey,
    targetUrl,
    timeoutMs,
  });
  const result = await timedJsonFetch(`${config.gatewayBaseUrl}/api/v1/services`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${localProviderJwt()}`,
      "X-User-Address": config.localProviderWallet,
    },
    body: JSON.stringify(body),
  });
  const serviceId =
    result.json?.serviceId || result.json?.service?.serviceId || serviceKey;
  addTrace({
    scenario: `register_${scenario}_service`,
    method: "POST",
    requestPath: "/api/v1/services",
    status: result.status,
    durationMs: result.durationMs,
    request: { serviceKey, targetUrl, timeoutMs },
    response: result.json || result.text.slice(0, 1000),
    ok: result.ok && Boolean(serviceId),
  });
  addCheck(
    `register_${scenario}_service`,
    result.ok && Boolean(serviceId),
    { status: result.status, serviceId, probeStatus: result.json?.service?.probeStatus },
    `Local LLM fixture service registration failed: status=${result.status} body=${result.text.slice(0, 1200)}`
  );
  return serviceId;
}

export async function runLocalFailureFixtures(ctx) {
  const { addCheck, config } = ctx;
  if (!config.runLocalFailureFixtures) return;
  if (!config.postgresDsn) {
    addCheck(
      "llm_local_failure_fixtures_db_required",
      false,
      {},
      "LLM_E2E_POSTGRES_DSN or LOCAL_POSTGRES_DSN is required for local LLM failure-path E2E."
    );
    return;
  }
  if (!config.jwtSecret) {
    addCheck(
      "llm_local_failure_fixtures_jwt_required",
      false,
      {},
      "JWT_SECRET is required to register local LLM failure fixture services."
    );
    return;
  }

  const fixture = await startLocalLlmFixtureServer();
  try {
    const timeoutServiceId = await registerLocalLlmService(ctx, {
      scenario: "timeout_no_charge",
      targetUrl: `${fixture.baseUrl}/llm/timeout`,
      timeoutMs: 1000,
    });
    const missingUsageServiceId = await registerLocalLlmService(ctx, {
      scenario: "missing_usage_no_charge",
      targetUrl: `${fixture.baseUrl}/llm/missing-usage`,
      timeoutMs: 3000,
    });
    const slowSuccessServiceId = await registerLocalLlmService(ctx, {
      scenario: "slow_success_charges",
      targetUrl: `${fixture.baseUrl}/llm/slow-success`,
      timeoutMs: 3000,
    });

    await invokeLlmFixture(ctx, {
      serviceId: timeoutServiceId,
      scenario: "timeout_no_charge",
      expectedOk: false,
      expectedStatus: 504,
      expectedCode: "SERVICE_TIMEOUT",
    });
    await invokeLlmFixture(ctx, {
      serviceId: missingUsageServiceId,
      scenario: "missing_usage_no_charge",
      expectedOk: false,
      expectedStatus: 502,
      expectedCode: "LLM_USAGE_MISSING",
    });
    await invokeLlmFixture(ctx, {
      serviceId: slowSuccessServiceId,
      scenario: "slow_success_charges",
      expectedOk: true,
      expectedStatus: 200,
      expectedCode: "",
    });
  } finally {
    await fixture.close();
  }
}

function localLlmServiceBody({
  config,
  inputPricePer1M,
  outputPricePer1M,
  scenario,
  serviceKey,
  targetUrl,
  timeoutMs,
}) {
  return {
    agentToolName: serviceKey,
    serviceName: `LLM E2E ${scenario}`,
    role: "Provider",
    status: "active",
    isActive: true,
    serviceKind: "llm",
    priceModel: "token_metered",
    pricing: {
      amount: "0",
      currency: "USDC",
      inputPricePer1MTokensUsdc: inputPricePer1M,
      outputPricePer1MTokensUsdc: outputPricePer1M,
      defaultMaxOutputTokens: 32,
      holdBufferMultiplier: "1.2",
      maxAutoHoldUsdc: "1.000000",
    },
    inputPricePer1MTokensUsdc: inputPricePer1M,
    outputPricePer1MTokensUsdc: outputPricePer1M,
    defaultMaxOutputTokens: 32,
    holdBufferMultiplier: "1.2",
    maxAutoHoldUsdc: "1.000000",
    metering: {
      billingUnit: "token",
      inputPricePer1MTokensUsdc: inputPricePer1M,
      outputPricePer1MTokensUsdc: outputPricePer1M,
      defaultMaxOutputTokens: 32,
      holdBufferMultiplier: "1.2",
      maxAutoHoldUsdc: "1.000000",
    },
    summary: `Local LLM failure-path fixture for ${scenario}`,
    tags: ["e2e", "llm", "failure-path"],
    auth: { type: "gateway_signed" },
    constraints: { timeoutMs, maxQps: 10, maxRequestBytes: 65536, maxResponseBytes: 65536 },
    forwarding: { requestIdHeader: "X-Synapse-Request-Id" },
    invoke: {
      method: "POST",
      targets: [{ url: targetUrl, weight: 100 }],
      request: {
        contentType: "application/json",
        schema: { body: { type: "object", required: ["messages"] } },
      },
      response: { contentType: "application/json", schema: { body: {} } },
    },
    healthCheck: {
      path: "/health",
      method: "GET",
      timeoutMs: 1000,
      successCodes: [200],
      healthyThreshold: 1,
      unhealthyThreshold: 1,
    },
    payoutAccount: {
      payoutAddress: config.localProviderWallet,
      chainId: 421614,
      settlementCurrency: "USDC",
    },
    providerProfile: { displayName: "Local LLM E2E Provider" },
    governance: {
      termsAccepted: true,
      riskAcknowledged: true,
      note: "local LLM failure-path E2E fixture",
    },
  };
}

async function invokeLlmFixture(ctx, params) {
  const {
    addCheck,
    addTrace,
    config,
    consumerBalanceSnapshot,
    credentialOwnerWallet,
    failureScenarios,
    invocationByIdempotency,
    runId,
    sameBalanceSnapshot,
    timedJsonFetch,
    validateBilling,
  } = ctx;
  const { serviceId, scenario, expectedOk, expectedStatus, expectedCode } = params;
  const idempotencyKey = `${runId}-${scenario}-001`;
  const ownerWallet = credentialOwnerWallet();
  const before = consumerBalanceSnapshot(ownerWallet);
  const body = {
    serviceId,
    idempotencyKey,
    payload: {
      body: {
        model: "fixture-deepseek-chat",
        messages: [{ role: "user", content: `local ${scenario} billing test` }],
        max_tokens: 32,
        temperature: 0,
      },
    },
  };
  const result = await timedJsonFetch(`${config.gatewayBaseUrl}/api/v1/agent/invoke`, {
    method: "POST",
    headers: {
      "X-Credential": config.credential,
      "X-Request-Id": `${runId}:${scenario}`,
    },
    body: JSON.stringify(body),
  });
  const invocation = invocationByIdempotency(idempotencyKey);
  const after = consumerBalanceSnapshot(ownerWallet);
  const detail = result.json?.detail || result.json?.error || {};
  const errorCode = detail.code || invocation?.errorCode || "";
  const chargedUsdc = invocation?.chargedUsdc || result.json?.chargedUsdc || "0.000000";
  const failedNoCharge =
    !expectedOk &&
    result.status === expectedStatus &&
    errorCode === expectedCode &&
    invocation?.status &&
    String(invocation.status).startsWith("FAILED") &&
    String(chargedUsdc) === "0.000000" &&
    Number(invocation.billingStateCount || 0) === 0 &&
    sameBalanceSnapshot(before, after);
  const success = expectedOk && result.ok && result.json?.status === "SUCCEEDED";
  const billingEvidence = success
    ? validateBilling(result.json, {
        metering: {
          inputPricePer1MTokensUsdc: config.inputPricePer1MUsdc || "0.140000",
          outputPricePer1MTokensUsdc: config.outputPricePer1MUsdc || "0.280000",
        },
      })
    : null;
  const ok = expectedOk ? Boolean(success && billingEvidence) : Boolean(failedNoCharge);
  const evidence = {
    scenario,
    serviceId,
    httpStatus: result.status,
    expectedStatus,
    expectedCode,
    errorCode,
    invocation,
    before,
    after,
    holdReleased: expectedOk ? undefined : sameBalanceSnapshot(before, after),
    chargedUsdc: expectedOk ? result.json?.result?.synapse?.chargedUsdc : chargedUsdc,
    providerRevenueUsdc: expectedOk
      ? result.json?.result?.synapse?.providerRevenueUsdc
      : "0.000000",
    platformFeeUsdc: expectedOk
      ? result.json?.result?.synapse?.platformFeeUsdc
      : "0.000000",
    billingEvidence,
  };
  failureScenarios.push(evidence);
  addTrace({
    scenario,
    method: "POST",
    requestPath: "/api/v1/agent/invoke",
    status: result.status,
    durationMs: result.durationMs,
    request: { ...body, credential: "[REDACTED]" },
    response: result.json || result.text.slice(0, 1000),
    ok,
  });
  addCheck(
    `llm_failure_path_${scenario}`,
    ok,
    evidence,
    expectedOk
      ? `Expected slow LLM fixture to charge successfully; status=${result.status} body=${result.text.slice(0, 1000)}`
      : `Expected ${scenario} to release hold without charge; status=${result.status} code=${errorCode} invocation=${JSON.stringify(invocation)}`
  );
  return evidence;
}
