export const dashboardApiPaths = [
  "/api/admin/v1/auth/me",
  "/api/admin/v1/dashboard/overview",
  "/api/admin/v1/dashboard/system-status",
  "/api/admin/v1/dashboard/finance-overview",
  "/api/admin/v1/dashboard/operations-overview",
  "/api/admin/v1/dashboard/reconciliation-detail",
  "/api/admin/v1/dashboard/diagnostics",
];

function nextAlertDeltaValue(currentValue) {
  const base = Number.parseFloat(String(currentValue || "0"));
  if (!Number.isFinite(base)) {
    throw new Error(`invalid alert delta value: ${currentValue}`);
  }
  return (base + 0.01).toFixed(6);
}

function readConfigRoundTripBody(bodyText, expectedValue, label) {
  const normalized = String(bodyText || "").replaceAll(",", "");
  if (!normalized.includes(expectedValue)) {
    throw new Error(`${label} missing expected value ${expectedValue}`);
  }
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

async function verifyBusinessPolicyConfig({
  adminApi,
  adminWrite,
  assertText,
  auth,
  generateTotpCode,
  page,
  pageUrl,
  screenshot,
  step,
  totpSecret,
  waitForSafeTotpWindow,
}) {
  const initialOverview = await adminApi("/api/admin/v1/config/overview", auth);
  const originalValue =
    initialOverview?.published?.policy?.reconciliation?.alertDeltaUsdc;
  if (!originalValue) {
    throw new Error("config overview missing reconciliation.alertDeltaUsdc");
  }
  const updatedValue = nextAlertDeltaValue(originalValue);
  let restored = false;
  let updatedPublishedVersion = null;
  let restoredPublishedVersion = null;

  async function publishValue(value, screenshotName, expectDirtyBeforePublish) {
    await page.goto(pageUrl("/config"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await assertText(page, ["配置中心", "业务参数草稿"], "/config");
    const input = page.getByTestId(
      "business-policy-field-reconciliation.alertDeltaUsdc"
    );
    await input.fill(value);
    await page.getByTestId("business-policy-save-draft").click();
    await assertText(page, ["业务参数草稿已保存。"], "config save draft");
    if (expectDirtyBeforePublish) {
      await assertText(page, ["Dirty"], "config dirty state");
    }
    await screenshot(page, screenshotName, {
      action: `business-policy-${screenshotName}`,
    });
    await waitForSafeTotpWindow({ guardSeconds: 10 });
    const otpCode = generateTotpCode(totpSecret);
    await page.getByTestId("business-policy-publish").click();
    const dialog = page.locator('[role="dialog"], text=Google Authenticator 验证码').first();
    await dialog.waitFor({ state: "visible", timeout: 30000 }).catch(() => null);
    const otpInput = page.getByPlaceholder("123456").first();
    await otpInput.fill(otpCode);
    await page.getByRole("button", { name: "发布配置" }).click();
    await assertText(page, ["业务参数已发布"], "config publish success");
    const published = await adminApi(
      "/api/admin/v1/config/business-policy?stage=published",
      auth
    );
    const overview = await adminApi("/api/admin/v1/config/overview", auth);
    const publishedValue =
      published?.policy?.reconciliation?.alertDeltaUsdc;
    const runtimeValue =
      overview?.runtime?.businessPolicy?.policy?.reconciliation?.alertDeltaUsdc;
    if (publishedValue !== value) {
      throw new Error(
        `published alert delta mismatch after publish: expected ${value}, got ${publishedValue}`
      );
    }
    if (runtimeValue !== value) {
      throw new Error(
        `runtime alert delta mismatch after publish: expected ${value}, got ${runtimeValue}`
      );
    }
    readConfigRoundTripBody(await page.textContent("body"), value, "config page");
    return {
      publishedVersion: published?.meta?.publishedVersion ?? null,
      draftVersion: published?.meta?.draftVersion ?? null,
      runtimeSource: overview?.runtime?.businessPolicy?.source ?? null,
    };
  }

  await step("flow:config-business-policy-round-trip", async () => {
    const firstPublish = await publishValue(
      updatedValue,
      "config-draft-dirty",
      true
    );
    updatedPublishedVersion = firstPublish.publishedVersion;
    const restorePublish = await publishValue(
      originalValue,
      "config-restored",
      true
    );
    restoredPublishedVersion = restorePublish.publishedVersion;
    restored = true;
    return `${originalValue} -> ${updatedValue} -> ${originalValue}`;
  });

  if (!restored) {
    try {
      const otpCode = generateTotpCode(totpSecret);
      await adminWrite("/api/admin/v1/config/business-policy", auth, {
        method: "PATCH",
        body: {
          policy: {
            ...initialOverview.draft.policy,
            reconciliation: {
              ...initialOverview.draft.policy.reconciliation,
              alertDeltaUsdc: originalValue,
            },
          },
        },
      });
      await adminWrite("/api/admin/v1/config/business-policy/publish", auth, {
        method: "POST",
        otpCode,
      });
      restored = true;
    } catch {
      // best effort only; the main step failure will surface in the report
    }
  }

  return {
    businessPolicyRoundTrip: {
      originalValue,
      updatedValue,
      restoredValue: originalValue,
      restored,
      updatedPublishedVersion,
      restoredPublishedVersion,
    },
  };
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
  warn,
  waitForSafeTotpWindow,
}) {
  const context = {
    adminApi,
    assertText,
    auth,
    fixture,
    page,
    pageUrl,
    screenshot,
    step,
  };
  await verifyDashboardEndpoints(context);

  const forumTaskId = fixture?.forum?.responseTaskId;
  if (!forumTaskId) {
    warn(
      "forum-support:seed",
      "fixture has no forum response task id; skipping send-reply flow"
    );
  } else {
    await verifyForumTaskVisible({ ...context, forumTaskId });
    await sendForumReply({ ...context, forumTaskId });
  }
  await verifyProviderServicesPage(context);
  await verifyFinancePage(context);
  await verifyAnalyticsPage(context);
  return verifyBusinessPolicyConfig({
    adminApi,
    adminWrite,
    assertText,
    auth,
    generateTotpCode,
    page,
    pageUrl,
    screenshot,
    step,
    totpSecret,
    waitForSafeTotpWindow,
  });
}
