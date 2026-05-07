import path from "node:path";
export {
  BASE_URL,
  CHAIN_ID,
  OUT_DIR,
  ROOT,
  TEST_ADDRESS,
  ensureOutputDir,
  pageUrl,
} from "./user_front_error_toast_config.mjs";
export { forbiddenRawStrings } from "./user_front_error_toast_expectations.mjs";
import {
  CHAIN_ID,
  ROOT,
  TEST_ADDRESS,
} from "./user_front_error_toast_config.mjs";
import {
  buildWagmiStore,
  installGatewayMocks,
} from "./user_front_error_toast_gateway_mocks.mjs";

export async function newAuthedPage(
  browser,
  language,
  role,
  options,
  onConsoleError
) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const chainHex = `0x${CHAIN_ID.toString(16)}`;
  await context.addInitScript({
    path: path.join(
      ROOT,
      "scripts/ui/user_front_error_toast_browser_fixtures.js"
    ),
  });
  await context.addInitScript(
    ({
      address,
      chainId,
      chainHex,
      language,
      role,
      wagmiStore,
      walletReject,
    }) => {
      const normalized = String(address).toLowerCase();
      localStorage.setItem("synapse_lang", language);
      localStorage.setItem("a2a_selected_role", role);
      localStorage.setItem(`a2a_role_${normalized}`, role);
      localStorage.setItem("synapse_e2e_wallet_connected", "1");
      localStorage.setItem(
        "a2a_auth_session",
        JSON.stringify({
          token: "e2e-error-toast-token",
          wallet: normalized,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        })
      );
      localStorage.setItem("wagmi.store", JSON.stringify(wagmiStore));
      localStorage.setItem(
        "wagmi.recentConnectorId",
        JSON.stringify("injected")
      );
      localStorage.setItem("wagmi.injected.connected", JSON.stringify(true));
      localStorage.removeItem("wagmi.injected.disconnected");
      if (walletReject) {
        localStorage.setItem("synapse_error_toast_wallet_reject", "1");
      } else {
        localStorage.removeItem("synapse_error_toast_wallet_reject");
      }
      window.ethereum = buildEthereumFixture(address, chainId, chainHex);
      setTimeout(
        () => window.dispatchEvent(new Event("ethereum#initialized")),
        0
      );
    },
    {
      address: TEST_ADDRESS,
      chainId: CHAIN_ID,
      chainHex,
      language,
      role,
      wagmiStore: buildWagmiStore(TEST_ADDRESS, CHAIN_ID),
      walletReject: options?.providerWithdrawMode === "rejected",
    }
  );
  const page = await context.newPage();
  await installGatewayMocks(page, options);
  page.on("console", (message) => {
    if (message.type() === "error")
      onConsoleError(message.text().slice(0, 500));
  });
  return { context, page };
}
