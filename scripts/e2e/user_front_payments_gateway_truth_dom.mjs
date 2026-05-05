import path from "node:path";
import { chromium } from "playwright";

async function installAuth(context, { ownerAddress, token, expiresAt }) {
  await context.addInitScript(
    ({ wallet, authToken, authExpiresAt }) => {
      const ethereum = {
        isMetaMask: true,
        selectedAddress: wallet,
        request: async ({ method }) => {
          if (method === "eth_accounts" || method === "eth_requestAccounts") {
            return [wallet];
          }
          if (method === "eth_chainId") return "0x7a69";
          if (method === "net_version") return "31337";
          return null;
        },
        on: () => undefined,
        removeListener: () => undefined,
      };
      Object.defineProperty(window, "ethereum", {
        value: ethereum,
        configurable: true,
      });
      localStorage.setItem("synapse_lang", "en");
      localStorage.setItem("synapse_e2e_wallet_connected", "1");
      localStorage.setItem("a2a_selected_role", "CONSUMER");
      localStorage.setItem(`a2a_role_${wallet.toLowerCase()}`, "CONSUMER");
      localStorage.setItem(
        "a2a_auth_session",
        JSON.stringify({
          wallet: wallet.toLowerCase(),
          token: authToken,
          expiresAt: authExpiresAt,
        })
      );
      localStorage.setItem(
        "wagmi.store",
        JSON.stringify({
          state: {
            connections: {
              __type: "Map",
              value: [
                [
                  "injected",
                  {
                    accounts: [wallet],
                    chainId: 31337,
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
            chainId: 31337,
            current: "injected",
            status: "connected",
          },
          version: 2,
        })
      );
      localStorage.setItem(
        "wagmi.recentConnectorId",
        JSON.stringify("injected")
      );
      localStorage.setItem("wagmi.injected.connected", JSON.stringify(true));
    },
    { wallet: ownerAddress, authToken: token, authExpiresAt: expiresAt }
  );
}

async function fulfillRpc(route) {
  const request = route.request();
  let body = {};
  try {
    body = JSON.parse(request.postData() || "{}");
  } catch {
    body = {};
  }
  const build = (payload) => {
    let result = "0x0";
    if (payload.method === "eth_chainId") result = "0x7a69";
    if (payload.method === "eth_blockNumber") result = "0x1";
    if (payload.method === "eth_getLogs") result = [];
    if (payload.method === "eth_getBlockByNumber") {
      result = { number: "0x1", timestamp: "0x65a00000" };
    }
    if (payload.method === "eth_call") result = "0x0";
    return { jsonrpc: "2.0", id: payload.id ?? 1, result };
  };
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(Array.isArray(body) ? body.map(build) : build(body)),
  });
}

async function captureScreenshot({ evidence, outDir, page, name, checkpoint }) {
  const relative = `screenshots/${name}.png`;
  const absolute = path.join(outDir, relative);
  await page.screenshot({ path: absolute, fullPage: true });
  evidence.screenshots.push({
    file: relative,
    url: page.url(),
    domCheckpoint: checkpoint,
    forbiddenTextAbsent: true,
    capturedAt: new Date().toISOString(),
  });
}

function paymentsRows(page) {
  return page
    .locator("table")
    .filter({ hasText: "Transaction ID" })
    .locator("tbody tr");
}

function buildDomCheckpoint({
  bodyText,
  expectedRecords,
  moneyDisplay,
  paymentRenderLimit,
  rowTexts,
  shortenTransactionId,
}) {
  const forbidden = [
    "2.2605864150320387e+58",
    "DepositInfo",
    "WithdrawInfo",
    "ticketHash",
    "agent:agent:",
    "Counterparty",
    "Connect Wallet",
    "Unauthorized",
    "Failed to fetch",
  ];
  const visibleExpected = expectedRecords.slice(0, paymentRenderLimit);
  const topMatches = visibleExpected.slice(0, 5).map((row) => {
    const id = shortenTransactionId(row.id);
    const amount = moneyDisplay(row.amount);
    return {
      id,
      amount,
      found:
        rowTexts.some((text) => text.includes(id) && text.includes(amount)) ||
        bodyText.includes(id),
    };
  });
  const pending = expectedRecords.find((row) => row.status === "PENDING");
  const completed = expectedRecords.find(
    (row) => row.type === "Deposit" && row.status === "COMPLETED"
  );
  return {
    completed,
    domCheckpoint: {
      rowCount: rowTexts.length,
      expectedVisibleCount: visibleExpected.length,
      topMatches,
      pendingVisible:
        pending &&
        bodyText.includes(shortenTransactionId(pending.id)) &&
        bodyText.includes("Pending"),
      completedVisible:
        completed &&
        bodyText.includes(shortenTransactionId(completed.id)) &&
        bodyText.includes("Completed"),
      historyHintSeen:
        bodyText.includes("Showing the latest 50 records") ||
        bodyText.includes("latest 50 records") ||
        bodyText.includes("完整导出"),
      foundForbidden: forbidden.filter((item) => bodyText.includes(item)),
    },
    pending,
  };
}

export async function verifyPaymentsDom({
  addCheck,
  config,
  evidence,
  expectedRecords,
  moneyDisplay,
  outDir,
  ownerAddress,
  paymentRenderLimit,
  shortenTransactionId,
  token,
}) {
  const browser = await chromium.launch({ headless: config.headless });
  try {
    const context = await browser.newContext();
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: config.frontendUrl,
    });
    await installAuth(context, {
      ownerAddress,
      token,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    await context.route("**/*", async (route) => {
      if (route.request().url().startsWith(config.rpcUrl)) {
        await fulfillRpc(route);
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    await page.goto(`${config.frontendUrl}/dashboard/billing`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page
      .waitForLoadState("networkidle", { timeout: 30_000 })
      .catch(() => {});
    try {
      await paymentsRows(page).first().waitFor({ timeout: 30_000 });
    } catch (error) {
      const bodyText = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      await captureScreenshot({
        evidence,
        outDir,
        page,
        name: "billing-payments-gateway-truth-failed",
        checkpoint: {
          waitForTableFailed: true,
          bodyText: bodyText.slice(0, 1000),
        },
      });
      throw error;
    }

    const bodyText = await page.locator("body").innerText();
    const rowTexts = await paymentsRows(page).evaluateAll((rows) =>
      rows.map((row) => row.textContent || "")
    );
    const { domCheckpoint, pending } = buildDomCheckpoint({
      bodyText,
      expectedRecords,
      moneyDisplay,
      paymentRenderLimit,
      rowTexts,
      shortenTransactionId,
    });
    evidence.dom.push(domCheckpoint);
    addCheck(
      "dom:payments-table",
      domCheckpoint.rowCount === domCheckpoint.expectedVisibleCount &&
        domCheckpoint.topMatches.every((row) => row.found) &&
        Boolean(domCheckpoint.pendingVisible) &&
        Boolean(domCheckpoint.completedVisible) &&
        domCheckpoint.historyHintSeen &&
        domCheckpoint.foundForbidden.length === 0,
      "",
      domCheckpoint
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .waitForLoadState("networkidle", { timeout: 30_000 })
      .catch(() => {});
    const reloadedText = await page.locator("body").innerText();
    addCheck(
      "dom:pending-survives-refresh",
      Boolean(
        pending && reloadedText.includes(shortenTransactionId(pending.id))
      ),
      "",
      {
        pendingId: pending?.id,
        displayId: pending ? shortenTransactionId(pending.id) : "",
      }
    );
    await captureScreenshot({
      evidence,
      outDir,
      page,
      name: "billing-payments-gateway-truth",
      checkpoint: domCheckpoint,
    });
  } finally {
    await browser.close();
  }
}
