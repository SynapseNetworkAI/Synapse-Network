export const dashboardApiPaths = [
  "/api/admin/v1/auth/me",
  "/api/admin/v1/dashboard/overview",
  "/api/admin/v1/dashboard/system-status",
  "/api/admin/v1/dashboard/finance-overview",
  "/api/admin/v1/dashboard/operations-overview",
  "/api/admin/v1/dashboard/reconciliation-detail",
  "/api/admin/v1/dashboard/diagnostics",
];

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

export async function verifyBackendConsistency({
  adminApi,
  assertText,
  auth,
  fixture,
  page,
  pageUrl,
  screenshot,
  step,
  warn,
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
    return;
  }

  await verifyForumTaskVisible({ ...context, forumTaskId });
  await sendForumReply({ ...context, forumTaskId });
  await verifyProviderServicesPage(context);
  await verifyFinancePage(context);
  await verifyAnalyticsPage(context);
}
