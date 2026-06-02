export const dashboardApiPaths = [
  "/api/admin/v1/auth/me",
  "/api/admin/v1/dashboard/overview",
  "/api/admin/v1/dashboard/system-status",
  "/api/admin/v1/dashboard/finance-overview",
  "/api/admin/v1/dashboard/operations-overview",
  "/api/admin/v1/dashboard/reconciliation-detail",
  "/api/admin/v1/dashboard/diagnostics",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clonePolicy(value) {
  return JSON.parse(JSON.stringify(value));
}

function addUsdcDelta(value, delta = 0.01) {
  const next = Number.parseFloat(String(value || "0")) + delta;
  return next.toFixed(6);
}

async function openConfigPage(page, pageUrl, cacheBust = Date.now()) {
  await page.goto(`${pageUrl("/config")}?roundtrip=${cacheBust}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("配置中心") &&
      document.body.innerText.includes("业务参数草稿"),
    { timeout: 30000 }
  );
}

async function waitForConfigFieldValue(page, expectedValue) {
  const selector =
    '[data-testid="business-policy-field-reconciliation.alertDeltaUsdc"]';
  await page.waitForFunction(
    ({ selector, expectedValue }) => {
      const input = document.querySelector(selector);
      return input instanceof HTMLInputElement && input.value === expectedValue;
    },
    { selector, expectedValue },
    { timeout: 30000 }
  );
}

async function waitForBusinessPolicyValue({
  adminApi,
  auth,
  expectedValue,
  timeoutMs = 45000,
  intervalMs = 1000,
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const overview = await adminApi("/api/admin/v1/config/overview", auth);
    const draftValue = String(
      overview?.draft?.policy?.reconciliation?.alertDeltaUsdc || ""
    ).trim();
    const publishedValue = String(
      overview?.published?.policy?.reconciliation?.alertDeltaUsdc || ""
    ).trim();
    const runtimeValue = String(
      overview?.runtime?.businessPolicy?.policy?.reconciliation?.alertDeltaUsdc || ""
    ).trim();
    if (
      draftValue === expectedValue &&
      publishedValue === expectedValue &&
      runtimeValue === expectedValue
    ) {
      return overview;
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `business policy runtime did not converge to ${expectedValue} within ${timeoutMs}ms`
  );
}

async function verifyDashboardEndpoints({ adminApi, auth, step }) {
  await step("api:dashboard-endpoints-200", async () => {
    for (const pathname of dashboardApiPaths) await adminApi(pathname, auth);
    return `${dashboardApiPaths.length} admin dashboard/auth endpoints returned success`;
  });
}

async function verifyForumTaskVisible({ adminApi, auth, forumTaskId, step }) {
  await step("data:forum-support-api-visible", async () => {
    const task = await adminApi(
      `/api/admin/v1/forum/response-tasks/${encodeURIComponent(forumTaskId)}`,
      auth
    );
    if (task.responseTaskId !== forumTaskId)
      throw new Error(`forum task id mismatch: ${task.responseTaskId}`);
    if (!["awaiting_response", "draft_ready"].includes(task.status)) {
      throw new Error(
        `forum task must be active before dogfood send, got ${task.status}`
      );
    }
    return task.status;
  });
}

async function sendForumReply({
  assertText,
  fixture,
  forumTaskId,
  page,
  pageUrl,
  screenshot,
  step,
}) {
  await step("flow:forum-support-send-reply", async () => {
    await page.goto(pageUrl("/forum-support"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.getByRole("button", { name: "Response Queue" }).click();
    await assertText(page, [fixture.forum.topicTitle], "seeded forum topic");
    await page
      .getByText(fixture.forum.topicTitle, { exact: true })
      .first()
      .click();
    await screenshot(page, "forum-support-before-send");
    await page
      .locator("textarea")
      .first()
      .fill(`Admin dogfood reviewed reply ${fixture.runId}`);
    const responsePromise = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(
            `/api/admin/v1/forum/response-tasks/${forumTaskId}/send-reply`
          ) && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "发送回复" }).click();
    const response = await responsePromise;
    if (!response.ok()) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `send reply failed: ${response.status()} ${text.slice(0, 400)}`
      );
    }
    await assertText(page, ["回复已发送"], "send success notice");
    await screenshot(page, "forum-support-after-send");
    return forumTaskId;
  });
}

async function verifyProviderServicesPage({
  adminApi,
  auth,
  page,
  pageUrl,
  step,
}) {
  await step("data:provider-services-api-page-consistency", async () => {
    const data = await adminApi(
      "/api/admin/v1/provider-services?page=1&pageSize=20",
      auth
    );
    await page.goto(pageUrl("/provider-services"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    const body = String((await page.textContent("body")) || "");
    if (!data.items?.[0]) {
      if (!body.includes("Provider 服务")) {
        throw new Error(
          "provider services page did not render while API returned empty list"
        );
      }
      return "empty provider list rendered";
    }
    const first = data.items[0].serviceName || data.items[0].serviceId;
    if (!body.includes(first))
      throw new Error(`provider service API item not visible in UI: ${first}`);
    return first;
  });
}

async function verifyFinancePage({ adminApi, auth, page, pageUrl, step }) {
  await step("data:finance-api-page-consistency", async () => {
    const data = await adminApi(
      "/api/admin/v1/dashboard/finance-overview",
      auth
    );
    await page.goto(pageUrl("/finance"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    const body = String((await page.textContent("body")) || "").replaceAll(
      ",",
      ""
    );
    const candidates = [
      data.todayChargeUsdc,
      data.ownerLiabilityUsdc,
      data.providerPayableUsdc,
      data.platformFeeBalanceUsdc,
    ].filter(Boolean);
    const hasMoneyValue = candidates.some(
      (value) =>
        body.includes(String(value).replace(/\.000000$/, "")) ||
        body.includes(String(value))
    );
    if (!hasMoneyValue) {
      throw new Error(
        `finance page did not show any API money value: ${candidates.join(
          ", "
        )}`
      );
    }
    return candidates[0];
  });
}

async function verifyAnalyticsPage({ adminApi, auth, page, pageUrl, step }) {
  await step("data:analytics-api-page-consistency", async () => {
    const data = await adminApi(
      "/api/admin/v1/dashboard/analytics/overview?window=24h",
      auth
    );
    await page.goto(pageUrl("/dashboard/analytics"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    const body = String((await page.textContent("body")) || "").replaceAll(
      ",",
      ""
    );
    const values = (data.cards || [])
      .map((card) => String(card.value))
      .filter(Boolean);
    if (values.length > 0 && !values.some((value) => body.includes(value))) {
      throw new Error(
        `analytics overview did not show any card value: ${values.join(", ")}`
      );
    }
    return `${values.length} card values checked`;
  });
}


async function publishBusinessPolicyWithRetry({
  adminWrite,
  auth,
  generateTotpCode,
  totpSecret,
  waitForSafeTotpWindow,
  maxAttempts = 4,
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForSafeTotpWindow();
    const otpCode = generateTotpCode(totpSecret);
    try {
      await adminWrite("/api/admin/v1/config/business-policy/publish", auth, {
        method: "POST",
        otpCode,
      });
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/401|invalid google authenticator code|google authenticator/i.test(message.toLowerCase())) {
        throw error;
      }
      await sleep(2500);
    }
  }
  throw lastError || new Error("business policy publish failed after retries");
}

async function verifyConfigBusinessPolicyRoundTrip({
  adminApi,
  adminWrite,
  auth,
  generateTotpCode,
  page,
  pageUrl,
  screenshot,
  step,
  totpSecret,
  waitForSafeTotpWindow,
}) {
  const evidence = {
    originalValue: "",
    updatedValue: "",
    restoredValue: "",
    restored: false,
  };
  await step("flow:config-business-policy-round-trip", async () => {
    const originalOverview = await adminApi("/api/admin/v1/config/overview", auth);
    const originalValue = String(
      originalOverview?.published?.policy?.reconciliation?.alertDeltaUsdc || ""
    ).trim();
    if (!originalValue) {
      throw new Error(
        "config overview missing published reconciliation.alertDeltaUsdc"
      );
    }
    const draftPolicy = clonePolicy(originalOverview.draft.policy);
    const updatedValue = addUsdcDelta(originalValue);
    evidence.originalValue = originalValue;
    evidence.updatedValue = updatedValue;
    draftPolicy.reconciliation.alertDeltaUsdc = updatedValue;

    await adminWrite("/api/admin/v1/config/business-policy", auth, {
      method: "PATCH",
      body: { policy: draftPolicy },
    });
    await openConfigPage(page, pageUrl);
    await waitForConfigFieldValue(page, updatedValue);
    const dirtyBody = String((await page.textContent("body")) || "");
    if (!dirtyBody.includes("Dirty")) {
      throw new Error(
        `config page did not show dirty draft with updated alert delta ${updatedValue}`
      );
    }
    await screenshot(page, "config-draft-dirty");

    await publishBusinessPolicyWithRetry({
      adminWrite,
      auth,
      generateTotpCode,
      totpSecret,
      waitForSafeTotpWindow,
    });
    await waitForBusinessPolicyValue({
      adminApi,
      auth,
      expectedValue: updatedValue,
    });

    const restorePolicy = clonePolicy(originalOverview.published.policy);
    await adminWrite("/api/admin/v1/config/business-policy", auth, {
      method: "PATCH",
      body: { policy: restorePolicy },
    });
    await publishBusinessPolicyWithRetry({
      adminWrite,
      auth,
      generateTotpCode,
      totpSecret,
      waitForSafeTotpWindow,
    });
    await waitForBusinessPolicyValue({
      adminApi,
      auth,
      expectedValue: originalValue,
    });

    await openConfigPage(page, pageUrl);
    await waitForConfigFieldValue(page, originalValue);
    const restoredBody = String((await page.textContent("body")) || "");
    if (!restoredBody.includes("Clean")) {
      throw new Error(
        `config page did not return to clean state with original alert delta ${originalValue}`
      );
    }
    evidence.restoredValue = originalValue;
    evidence.restored = true;
    await screenshot(page, "config-restored");
    return `${originalValue} -> ${updatedValue} -> ${originalValue}`;
  });
  return evidence;
}

export async function verifyBackendConsistency({
  adminApi,
  adminWrite,
  assertText,
  auth,
  fixture,
  generateTotpCode,
  page,
  pageUrl,
  screenshot,
  step,
  totpSecret,
  waitForSafeTotpWindow,
  warn,
}) {
  const context = {
    adminApi,
    adminWrite,
    assertText,
    auth,
    fixture,
    generateTotpCode,
    page,
    pageUrl,
    screenshot,
    step,
    totpSecret,
    waitForSafeTotpWindow,
  };
  await verifyDashboardEndpoints(context);
  const businessPolicyRoundTrip = await verifyConfigBusinessPolicyRoundTrip(context);

  const forumTaskId = fixture?.forum?.responseTaskId;
  if (!forumTaskId) {
    warn(
      "forum-support:seed",
      "fixture has no forum response task id; skipping send-reply flow"
    );
    return;
  }

  await verifyForumTaskVisible({ ...context, forumTaskId });
  await sendForumReply({ ...context, forumTaskId });
  await verifyProviderServicesPage(context);
  await verifyFinancePage(context);
  await verifyAnalyticsPage(context);
  return {
    businessPolicyRoundTrip,
  };
}
