import { expectedCopy } from "./user_front_error_toast_expectations.mjs";

async function clickByJs(page, names, options = {}) {
  const target = await findButton(page, names, options);
  await target.evaluate((element) => element.click());
}

async function clickButton(page, names, options = {}) {
  const target = await findButton(page, names, options);
  await target.click({ timeout: 15000 });
}

async function findButton(page, names, options = {}) {
  for (const name of names) {
    const button = page.getByRole("button", { name });
    const count = await button.count();
    if (count > 0) return options.last ? button.nth(count - 1) : button.first();
  }
  throw new Error(`none of the buttons exist: ${names.join(", ")}`);
}

async function maybeCloseParserOverride(page) {
  const parserOverride = page.getByRole("button", {
    name: /Confirm Override|确认覆盖/,
  });
  if ((await parserOverride.count()) === 0) return;
  if (await parserOverride.last().isEnabled()) {
    await parserOverride.last().click({ timeout: 5000 });
  } else {
    await page.locator(".x-modal-surface button").first().click({
      force: true,
      timeout: 5000,
    });
  }
  await page.waitForTimeout(300);
}

function deployLabels(language) {
  if (language === "zh") {
    return {
      serviceName: "服务名称",
      endpoint: "主 Endpoint URL",
      price: "基础价格 USDC",
      description: "给模型看的描述",
      submit: /^创建 API 服务$/,
    };
  }
  return {
    serviceName: "Service Name",
    endpoint: "Primary Endpoint URL",
    price: "Base Price USDC",
    description: "Description for Model",
    submit: /^CREATE API SERVICE$/,
  };
}

async function fillOptionalLabel(page, label, fallback, value) {
  const field = page.getByLabel(label);
  if ((await field.count()) > 0) {
    await field.fill(value);
  } else {
    await fallback().fill(value);
  }
}

async function fillProviderDeployForm(page, language) {
  await maybeCloseParserOverride(page);
  const labels = deployLabels(language);
  await page.getByLabel(labels.serviceName).fill("Error Toast Service");
  await fillOptionalLabel(
    page,
    labels.endpoint,
    () => page.locator('input[type="url"]').first(),
    "https://provider.example.com/invoke"
  );
  await fillOptionalLabel(
    page,
    labels.price,
    () => page.locator('input[inputmode="decimal"]').first(),
    "0.01"
  );
  await fillOptionalLabel(
    page,
    labels.description,
    () => page.locator("textarea").first(),
    "A fixture service for localized error toast verification."
  );
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(100);
  await page
    .getByRole("button", { name: labels.submit })
    .click({ timeout: 15000 });
}

async function consumerWithdraw(page, language) {
  await clickByJs(page, ["Withdraw", "提现"]);
  await page.getByRole("spinbutton").fill("10");
  await clickByJs(page, [language === "zh" ? "提现" : "Withdraw"], {
    last: true,
  });
}

async function providerWithdraw(page) {
  await clickByJs(page, ["Generate & Claim", "生成并提现"]);
  const amountInput = page
    .locator('input[placeholder="Amount"], input[placeholder="金额"]')
    .first();
  await amountInput.waitFor({ timeout: 15000 });
  await amountInput.fill("12.60");
  await clickByJs(page, ["Confirm", "确认提现"]);
}

async function revokeCredential(page) {
  await clickButton(page, ["Revoke", "撤销"]);
  await clickButton(page, ["Revoke", "撤销"], { last: true });
}

async function openNotifications(page, language) {
  await clickButton(page, [language === "zh" ? "通知" : "Notifications"]);
}

const consumerWithdrawCases = [
  {
    name: "credits-consumer-withdraw-rpc",
    path: "/dashboard/billing/credits",
    role: "CONSUMER",
    options: { consumerWithdrawMode: "rpc" },
    expected: {
      en: expectedCopy.en.creditsRpc,
      zh: expectedCopy.zh.creditsRpc,
    },
    act: consumerWithdraw,
  },
  {
    name: "credits-consumer-withdraw-contract",
    path: "/dashboard/billing/credits",
    role: "CONSUMER",
    options: { consumerWithdrawMode: "contract" },
    expected: {
      en: expectedCopy.en.creditsContractMissing,
      zh: expectedCopy.zh.creditsContractMissing,
    },
    act: consumerWithdraw,
  },
  {
    name: "credits-consumer-withdraw-matured",
    path: "/dashboard/billing/credits",
    role: "CONSUMER",
    options: { consumerWithdrawMode: "matured" },
    expected: {
      en: expectedCopy.en.creditsMatured,
      zh: expectedCopy.zh.creditsMatured,
    },
    act: consumerWithdraw,
  },
  {
    name: "credits-consumer-withdraw-unknown",
    path: "/dashboard/billing/credits",
    role: "CONSUMER",
    options: { consumerWithdrawMode: "unknown" },
    expected: {
      en: expectedCopy.en.creditsUnknown,
      zh: expectedCopy.zh.creditsUnknown,
    },
    act: consumerWithdraw,
  },
];

const providerWithdrawCases = [
  {
    name: "provider-withdraw-rpc",
    path: "/provider/withdraw",
    role: "PROVIDER",
    options: { providerWithdrawMode: "rpc" },
    expected: {
      en: expectedCopy.en.providerRpc,
      zh: expectedCopy.zh.providerRpc,
    },
    act: providerWithdraw,
  },
  {
    name: "provider-withdraw-matured",
    path: "/provider/withdraw",
    role: "PROVIDER",
    options: { providerWithdrawMode: "matured" },
    expected: {
      en: expectedCopy.en.providerMatured,
      zh: expectedCopy.zh.providerMatured,
    },
    act: providerWithdraw,
  },
  {
    name: "provider-withdraw-minimum",
    path: "/provider/withdraw",
    role: "PROVIDER",
    options: { providerWithdrawMode: "minimum" },
    expected: {
      en: expectedCopy.en.providerMinimum,
      zh: expectedCopy.zh.providerMinimum,
    },
    act: providerWithdraw,
  },
  {
    name: "provider-withdraw-pending",
    path: "/provider/withdraw",
    role: "PROVIDER",
    options: { providerWithdrawMode: "pending" },
    expected: {
      en: expectedCopy.en.providerPending,
      zh: expectedCopy.zh.providerPending,
    },
    act: providerWithdraw,
  },
  {
    name: "provider-withdraw-rejected",
    path: "/provider/withdraw",
    role: "PROVIDER",
    options: { providerWithdrawMode: "rejected" },
    expected: {
      en: expectedCopy.en.providerRejected,
      zh: expectedCopy.zh.providerRejected,
    },
    act: providerWithdraw,
  },
  {
    name: "provider-withdraw-unknown",
    path: "/provider/withdraw",
    role: "PROVIDER",
    options: { providerWithdrawMode: "unknown" },
    expected: {
      en: expectedCopy.en.providerUnknown,
      zh: expectedCopy.zh.providerUnknown,
    },
    act: providerWithdraw,
  },
];

const passiveSurfaceCases = [
  {
    name: "provider-withdraw-history-raw-message",
    path: "/provider/withdraw",
    role: "PROVIDER",
    options: { providerHistoryMode: "raw" },
    expected: {
      en: expectedCopy.en.providerHistoryReason,
      zh: expectedCopy.zh.providerHistoryReason,
    },
    act: async () => {},
  },
  {
    name: "provider-withdraw-history-page-raw-message",
    path: "/provider/withdraw/history",
    role: "PROVIDER",
    options: { providerHistoryMode: "raw" },
    expected: {
      en: expectedCopy.en.providerHistoryPage,
      zh: expectedCopy.zh.providerHistoryPage,
    },
    act: async () => {},
  },
  {
    name: "withdrawal-notification-raw-message",
    path: "/dashboard/overview",
    role: "PROVIDER",
    options: { notificationMode: "raw" },
    expected: {
      en: expectedCopy.en.notificationBody,
      zh: expectedCopy.zh.notificationBody,
    },
    act: openNotifications,
  },
];

const actionSurfaceCases = [
  {
    name: "provider-services-list",
    path: "/provider/services",
    role: "PROVIDER",
    options: { failServiceList: true },
    expected: {
      en: expectedCopy.en.serviceList,
      zh: expectedCopy.zh.serviceList,
    },
    act: async () => {},
  },
  {
    name: "provider-service-deploy",
    path: "/provider/services/deploy",
    role: "PROVIDER",
    options: { failServiceDeploy: true },
    expected: {
      en: expectedCopy.en.serviceDeploy,
      zh: expectedCopy.zh.serviceDeploy,
    },
    act: fillProviderDeployForm,
  },
  {
    name: "agent-credential-revoke",
    path: "/dashboard/credentials",
    role: "CONSUMER",
    options: { failCredentialRevoke: true },
    expected: {
      en: expectedCopy.en.credentialRevoke,
      zh: expectedCopy.zh.credentialRevoke,
    },
    act: revokeCredential,
  },
];

export function errorToastCases() {
  return [
    ...consumerWithdrawCases,
    ...providerWithdrawCases,
    ...passiveSurfaceCases,
    ...actionSurfaceCases,
  ];
}
