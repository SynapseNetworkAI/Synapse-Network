import path from "node:path";

function wagmiStore(address, chainId) {
  return {
    state: {
      connections: {
        __type: "Map",
        value: [
          [
            "injected",
            {
              accounts: [address],
              chainId,
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
      chainId,
      current: "injected",
      status: "connected",
    },
    version: 2,
  };
}

export async function installOwnerAuth(context, auth, config) {
  await context.addInitScript(
    ({ address, token, expiresAt, chainId, rpcUrl, store }) => {
      localStorage.setItem("synapse_lang", "en");
      localStorage.setItem("a2a_selected_role", "CONSUMER");
      localStorage.setItem(
        `a2a_role_${String(address).toLowerCase()}`,
        "CONSUMER"
      );
      localStorage.setItem(
        "a2a_auth_session",
        JSON.stringify({
          wallet: String(address).toLowerCase(),
          token,
          expiresAt,
        })
      );
      localStorage.setItem("wagmi.store", JSON.stringify(store));
      localStorage.setItem(
        "wagmi.recentConnectorId",
        JSON.stringify("injected")
      );
      localStorage.setItem("wagmi.injected.connected", JSON.stringify(true));
      window.ethereum = {
        isMetaMask: true,
        chainId: `0x${Number(chainId).toString(16)}`,
        selectedAddress: address,
        isConnected: () => true,
        request: async (args) => {
          const method = args?.method;
          if (method === "eth_requestAccounts" || method === "eth_accounts")
            return [address];
          if (method === "eth_chainId")
            return `0x${Number(chainId).toString(16)}`;
          const response = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: Date.now(),
              method,
              params: args?.params || [],
            }),
          });
          const payload = await response.json();
          if (payload.error)
            throw new Error(payload.error.message || "RPC failed");
          return payload.result;
        },
        on: () => {},
        removeListener: () => {},
      };
    },
    {
      address: auth.address,
      token: auth.token,
      expiresAt: auth.expiresAt,
      chainId: 421614,
      rpcUrl: config.rpcUrl,
      store: wagmiStore(auth.address, 421614),
    }
  );
}

export async function installAdminAuth(context, adminAuth, config) {
  if (!adminAuth) return;
  const sessionCookie = {
    name: config.adminCookieName,
    value: adminAuth.sessionToken,
    httpOnly: true,
    sameSite: "Lax",
  };
  await context.addCookies([
    { ...sessionCookie, url: config.adminFrontUrl },
    { ...sessionCookie, url: config.adminApiUrl },
  ]);
  await context.addInitScript((csrfToken) => {
    sessionStorage.setItem("synapse.admin.csrfToken", csrfToken);
  }, adminAuth.csrfToken);
}

async function bodyText(page) {
  return page
    .locator("body")
    .innerText({ timeout: 5_000 })
    .catch(() => "");
}

async function waitForExpectedText(page, expectedText, label) {
  const expected = Array.isArray(expectedText) ? expectedText : [expectedText];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const body = await bodyText(page);
    if (expected.every((text) => body.includes(text))) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`DOM ${label} missing expected text: ${expected.join(", ")}`);
}

function defaultForbidden() {
  return [
    "Connect Wallet",
    "Please connect your wallet",
    "Sign In",
    "Loading",
    "Failed to fetch",
    "Unauthorized",
    "Internal Server Error",
    "Application error",
  ];
}

export async function capturePage(page, item, context) {
  const { outDir, evidence, addCheck } = context;
  const response = await page.goto(item.url, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await waitForExpectedText(page, item.expectedText, item.name);
  const body = await bodyText(page);
  const forbiddenPresent = defaultForbidden().filter((text) =>
    body.includes(text)
  );
  const domCheckpoint = {
    name: item.name,
    status: response?.status() || 0,
    expectedText: item.expectedText,
    forbiddenPresent,
    bodyExcerpt: body.slice(0, 1200),
  };
  const ok = (response?.status() || 0) < 400 && forbiddenPresent.length === 0;
  evidence.dom.push(domCheckpoint);
  addCheck(`dom:${item.name}`, ok, `status=${domCheckpoint.status}`);
  if (!ok) return;
  const file = `screenshots/${item.name}.png`;
  await page.screenshot({ path: path.join(outDir, file), fullPage: true });
  evidence.screenshots.push({
    file,
    url: item.url,
    expectedText: item.expectedText,
    forbiddenTextAbsent: true,
    domCheckpoint: item.name,
    apiCheckpoint: item.apiCheckpoint || "",
    dbCheckpoint: item.dbCheckpoint || "",
    capturedAt: new Date().toISOString(),
  });
}
