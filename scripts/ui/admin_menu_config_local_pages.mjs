import {
  businessPolicyTabProofs,
  forbiddenConfigOverviewTexts,
  forbiddenLoginTexts,
  forbiddenPageTexts,
  forbiddenRuntimeRawValuesFor,
  REQUIRED_MENU_ITEMS,
} from "../lib/admin_menu_config_local_contract.mjs";

async function assertForbiddenTextAbsent(page, texts) {
  const bodyText = await page.locator("body").innerText({ timeout: 10000 });
  const present = texts.filter((text) => bodyText.includes(text));
  if (present.length > 0) {
    throw new Error(`Forbidden text present: ${present.join(", ")}`);
  }
  return { bodyText, present };
}

async function assertBodyDoesNotInclude(page, texts, label) {
  const bodyText = await page.locator("body").innerText({ timeout: 10000 });
  const present = texts.filter((text) => text && bodyText.includes(text));
  if (present.length > 0) {
    throw new Error(`${label} forbidden text present: ${present.join(", ")}`);
  }
  return { bodyText, present };
}

function collectMissing(bodyText, expectedText, route) {
  const missing = expectedText.filter((text) => !bodyText.includes(text));
  if (missing.length > 0) {
    throw new Error(`${route} missing text: ${missing.join(", ")}`);
  }
  return missing;
}

function menuItemMatches(actual, expected) {
  return (
    actual?.label === expected.label &&
    actual?.href === expected.href &&
    actual?.parentItemId === expected.parentItemId &&
    actual?.nodeType === expected.nodeType
  );
}

export async function getVisibleMenuFromBrowser(page, runIndex, ops) {
  const payload = await page.evaluate(async () => {
    const response = await fetch("/api/admin/v1/config/menu-items/visible", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, body };
  });
  const items = payload.body?.data?.items || [];
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const requiredItems = REQUIRED_MENU_ITEMS.map((expected) => ({
    expected,
    actual: byId.get(expected.itemId) || null,
    match: menuItemMatches(byId.get(expected.itemId), expected),
  }));
  const requiredMatch = payload.ok && requiredItems.every((item) => item.match);
  const apiEvidence = ops.sanitize({
    runIndex,
    pathname: "/api/admin/v1/config/menu-items/visible",
    status: payload.status,
    ok: payload.ok,
    itemCount: items.length,
    itemIds: items.map((item) => item.itemId).sort(),
    requiredItem: byId.get("config-center") || null,
    requiredItems,
    requiredMatch,
  });
  ops.evidence.api.push(apiEvidence);
  ops.addCheck(
    `api:visible-menu-run-${runIndex}`,
    requiredMatch,
    `${items.length} items`
  );
  if (!requiredMatch) {
    throw new Error(
      `Visible menu missing config-center split items on run ${runIndex}.`
    );
  }
  return apiEvidence;
}

async function openLoginPage(page, runIndex, ops) {
  await page.goto(`${ops.config.adminFrontUrl}/login`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  const { present } = await assertForbiddenTextAbsent(
    page,
    forbiddenLoginTexts
  );
  return ops.capture(page, `login-no-google-fa-run-${runIndex}`, {
    expectedText: ["Operator Identification", "Access Cipher"],
    forbiddenTextAbsent: present.length === 0,
    forbiddenTexts: forbiddenLoginTexts,
    domCheckpoint: true,
    apiCheckpoint: "auth-policy:login-google-fa-disabled",
  });
}

async function loginWithPasswordOnly(page, runIndex, ops) {
  await page.locator('input[type="email"]').fill(ops.config.adminEmail);
  await page.locator('input[type="password"]').fill(ops.config.adminPassword);
  await page.getByRole("button", { name: /Execute Initialization/i }).click();
  await page.waitForURL(/\/dashboard(\/.*)?$/, { timeout: 30000 });
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("button", { name: /业务控制/ })
    .first()
    .waitFor({
      state: "visible",
      timeout: 30000,
    });
  ops.evidence.loginRuns.push({
    runIndex,
    passwordOnly: true,
    landedUrl: page.url(),
    loginTotpRequired: ops.evidence.authPolicy?.loginTotpRequired,
  });
  ops.addCheck(`admin:password-login-run-${runIndex}`, true, page.url());
}

async function verifyDashboardSidebar(page, runIndex, apiEvidence, ops) {
  const configCenterLink = page.locator('[data-nav-id="config-center"]');
  if (!(await configCenterLink.isVisible().catch(() => false))) {
    await page
      .getByRole("button", { name: /业务控制/ })
      .first()
      .click();
    await configCenterLink.waitFor({ state: "visible", timeout: 15000 });
  }
  const { bodyText, present } = await assertForbiddenTextAbsent(
    page,
    forbiddenPageTexts
  );
  const requiredTexts = ["业务控制", "配置中心"];
  const missing = collectMissing(bodyText, requiredTexts, "Sidebar");
  const screenshot = await ops.capture(
    page,
    `dashboard-menu-visible-run-${runIndex}`,
    {
      expectedText: requiredTexts,
      forbiddenTextAbsent: present.length === 0,
      domCheckpoint: true,
      apiCheckpoint: apiEvidence.requiredMatch,
      menuItemIdsFromApi: apiEvidence.itemIds,
    }
  );
  return { missing, present, requiredTexts, screenshot };
}

async function verifyConfigOverview(page, runIndex, apiEvidence, ops) {
  await page.locator('[data-nav-id="config-center"]').click();
  await page.waitForURL(/\/config$/, { timeout: 15000 });
  await page.getByRole("heading", { name: "配置中心" }).waitFor({
    state: "visible",
    timeout: 15000,
  });
  for (const itemId of [
    "business-policy-config",
    "runtime-config",
    "published-config",
  ]) {
    await page.locator(`[data-nav-id="${itemId}"]`).first().waitFor({
      state: "visible",
      timeout: 15000,
    });
  }
  const { bodyText, present } = await assertForbiddenTextAbsent(
    page,
    forbiddenPageTexts
  );
  const requiredTexts = [
    "配置中心",
    "配置模块入口",
    "业务策略配置",
    "运行时来源",
    "已发布快照",
    "菜单配置",
  ];
  const missing = collectMissing(bodyText, requiredTexts, "/config");
  const overviewFieldCount = await page
    .locator('[data-testid^="business-policy-field-"]')
    .count();
  if (overviewFieldCount > 0) {
    throw new Error("/config rendered business policy form fields.");
  }
  const { present: forbiddenOverview } = await assertBodyDoesNotInclude(
    page,
    forbiddenConfigOverviewTexts,
    "Config overview"
  );
  const screenshot = await ops.capture(
    page,
    `config-overview-run-${runIndex}`,
    {
      expectedText: requiredTexts,
      forbiddenTextAbsent: present.length === 0,
      overviewNoBusinessPolicyFields: overviewFieldCount === 0,
      overviewNoRawJson: forbiddenOverview.length === 0,
      domCheckpoint: true,
      apiCheckpoint: apiEvidence.requiredMatch,
      dbCheckpoint: "db:admin-menu-config-center-published",
    }
  );
  return { forbiddenOverview, missing, present, requiredTexts, screenshot };
}

async function verifyBusinessPolicyRoute(page, runIndex, apiEvidence, ops) {
  const expectedText = [
    "业务策略配置",
    "Finance",
    "Consumer Withdraw",
    "Risk",
    "Reconciliation",
    "保存草稿",
    "发布生效",
  ];
  await page.goto(`${ops.config.adminFrontUrl}/config/business-policy`, {
    waitUntil: "networkidle",
  });
  const { bodyText, present } = await assertForbiddenTextAbsent(
    page,
    forbiddenPageTexts
  );
  const missing = collectMissing(
    bodyText,
    expectedText,
    "/config/business-policy"
  );
  const tabProofs = await verifyBusinessPolicyTabs(page);
  await page.getByTestId("business-policy-tab-finance").click();
  const screenshot = await ops.capture(
    page,
    `config-business-policy-run-${runIndex}`,
    {
      expectedText,
      forbiddenTextAbsent: present.length === 0,
      tabProofs,
      domCheckpoint: true,
      apiCheckpoint: apiEvidence.requiredMatch,
      dbCheckpoint: "db:admin-menu-config-center-published",
    }
  );
  return {
    expectedText,
    forbiddenTextAbsent: present.length === 0,
    missing,
    screenshot,
    tabProofs,
  };
}

async function verifyBusinessPolicyTabs(page) {
  const tabIds = {
    Finance: "finance",
    "Consumer Withdraw": "consumerWithdraw",
    Risk: "risk",
    Reconciliation: "reconciliation",
  };
  const tabProofs = [];
  for (const proof of businessPolicyTabProofs) {
    await page.getByTestId(`business-policy-tab-${tabIds[proof.tab]}`).click();
    await page.waitForTimeout(100);
    const tabBody = await page.locator("body").innerText({ timeout: 10000 });
    const missing = proof.expectedTexts.filter(
      (text) => !tabBody.includes(text)
    );
    tabProofs.push({
      tab: proof.tab,
      expectedTexts: proof.expectedTexts,
      missing,
      ok: missing.length === 0,
    });
    if (missing.length > 0) {
      throw new Error(
        `/config/business-policy ${proof.tab} tab missing text: ${missing.join(
          ", "
        )}`
      );
    }
  }
  return tabProofs;
}

async function verifyConfigRoute(
  page,
  route,
  screenshotName,
  expectedText,
  apiEvidence,
  ops,
  extraMetadata
) {
  await page.goto(`${ops.config.adminFrontUrl}${route}`, {
    waitUntil: "networkidle",
  });
  const { bodyText, present } = await assertForbiddenTextAbsent(
    page,
    forbiddenPageTexts
  );
  const missing = collectMissing(bodyText, expectedText, route);
  const extra = extraMetadata ? await extraMetadata() : {};
  const screenshot = await ops.capture(page, screenshotName, {
    expectedText,
    forbiddenTextAbsent: present.length === 0,
    ...extra,
    domCheckpoint: true,
    apiCheckpoint: apiEvidence.requiredMatch,
    dbCheckpoint: "db:admin-menu-config-center-published",
  });
  return {
    ...extra,
    expectedText,
    forbiddenTextAbsent: present.length === 0,
    missing,
    screenshot,
  };
}

async function verifyRuntimeConfigRoute(page, runIndex, apiEvidence, ops) {
  return verifyConfigRoute(
    page,
    "/config/runtime",
    `config-runtime-run-${runIndex}`,
    ["运行时来源", "只读检查 Gateway", "来源分组"],
    apiEvidence,
    ops,
    async () => {
      const { present } = await assertBodyDoesNotInclude(
        page,
        forbiddenRuntimeRawValuesFor(ops.config),
        "Runtime config"
      );
      return { runtimeRawValuesAbsent: present.length === 0 };
    }
  );
}

async function verifyPublishedConfigRoute(page, runIndex, apiEvidence, ops) {
  return verifyConfigRoute(
    page,
    "/config/published",
    `config-published-run-${runIndex}`,
    ["已发布快照", "结构化展示", "查看原始快照 JSON"],
    apiEvidence,
    ops,
    async () => {
      const openRawJsonCount = await page.locator("details[open]").count();
      if (openRawJsonCount > 0) {
        throw new Error(
          "/config/published raw JSON details are open by default."
        );
      }
      return { publishedRawJsonCollapsed: openRawJsonCount === 0 };
    }
  );
}

function appendDomEvidence(ops, runIndex, proofs) {
  const { businessPolicy, config, dashboard, published, runtime } = proofs;
  ops.evidence.dom.push(
    ops.sanitize({
      runIndex,
      route: "/dashboard",
      requiredTexts: dashboard.requiredTexts,
      missing: dashboard.missing,
      forbiddenTextAbsent: dashboard.present.length === 0,
      screenshots: [dashboard.screenshot.file],
    }),
    ops.sanitize({
      runIndex,
      route: "/config",
      requiredTexts: config.requiredTexts,
      missing: config.missing,
      forbiddenTextAbsent: config.present.length === 0,
      overviewNoBusinessPolicyFields: true,
      overviewNoRawJson: config.forbiddenOverview.length === 0,
      screenshots: [config.screenshot.file],
    }),
    ops.sanitize({
      runIndex,
      route: "/config/business-policy",
      requiredTexts: businessPolicy.expectedText,
      missing: businessPolicy.missing,
      forbiddenTextAbsent: businessPolicy.forbiddenTextAbsent,
      tabProofs: businessPolicy.tabProofs,
      screenshots: [businessPolicy.screenshot.file],
    }),
    ops.sanitize({
      runIndex,
      route: "/config/runtime",
      requiredTexts: runtime.expectedText,
      missing: runtime.missing,
      forbiddenTextAbsent: runtime.forbiddenTextAbsent,
      runtimeRawValuesAbsent: runtime.runtimeRawValuesAbsent,
      screenshots: [runtime.screenshot.file],
    }),
    ops.sanitize({
      runIndex,
      route: "/config/published",
      requiredTexts: published.expectedText,
      missing: published.missing,
      forbiddenTextAbsent: published.forbiddenTextAbsent,
      publishedRawJsonCollapsed: published.publishedRawJsonCollapsed,
      screenshots: [published.screenshot.file],
    })
  );
}

async function verifySidebarAndConfigPage(page, runIndex, apiEvidence, ops) {
  const dashboard = await verifyDashboardSidebar(
    page,
    runIndex,
    apiEvidence,
    ops
  );
  const config = await verifyConfigOverview(page, runIndex, apiEvidence, ops);
  const businessPolicy = await verifyBusinessPolicyRoute(
    page,
    runIndex,
    apiEvidence,
    ops
  );
  const runtime = await verifyRuntimeConfigRoute(
    page,
    runIndex,
    apiEvidence,
    ops
  );
  const published = await verifyPublishedConfigRoute(
    page,
    runIndex,
    apiEvidence,
    ops
  );
  appendDomEvidence(ops, runIndex, {
    businessPolicy,
    config,
    dashboard,
    published,
    runtime,
  });
  ops.addCheck(`dom:sidebar-config-center-run-${runIndex}`, true, page.url());
}

export async function runLoginCycle(browser, runIndex, ops) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    baseURL: ops.config.adminFrontUrl,
  });
  const page = await context.newPage();
  try {
    ops.addTrace("login-cycle:start", { runIndex });
    await openLoginPage(page, runIndex, ops);
    await loginWithPasswordOnly(page, runIndex, ops);
    const apiEvidence = await getVisibleMenuFromBrowser(page, runIndex, ops);
    await verifySidebarAndConfigPage(page, runIndex, apiEvidence, ops);
    ops.addTrace("login-cycle:done", { runIndex });
  } finally {
    await context.close();
  }
}
