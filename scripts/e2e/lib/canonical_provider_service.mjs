export const CANONICAL_FREE_SERVICE_ID = "svc_synapse_echo";
export const CANONICAL_PAID_SERVICE_ID = "svc_synapse_mock_cost_1usdc";
export const CANONICAL_LLM_SERVICE_ID = "svc_deepseek_chat";

export const CANONICAL_PROVIDER_SERVICE_IDS = [
  CANONICAL_FREE_SERVICE_ID,
  CANONICAL_PAID_SERVICE_ID,
  "svc_web3_sentiment_index",
  "svc_protocol_fundamental_brief",
  "svc_oss_security_healthcheck",
  CANONICAL_LLM_SERVICE_ID,
];

export function configuredCanonicalServiceId(env = process.env) {
  return (
    String(env.GATEWAY_E2E_SERVICE_ID || CANONICAL_PAID_SERVICE_ID).trim() ||
    CANONICAL_PAID_SERVICE_ID
  );
}

export function canonicalMissingMessage(
  serviceId = configuredCanonicalServiceId()
) {
  return [
    `Canonical E2E provider service ${JSON.stringify(
      serviceId
    )} is not discoverable.`,
    "Gateway local/staging E2E must reuse Synapse-Network-Provider catalog services.",
    "Run `npm run dev:provider:onboard` or the Synapse-Network-Provider onboarding check/ensure flow, then retry.",
  ].join(" ");
}

export function canonicalInvokePayload(serviceId) {
  const normalized = String(serviceId || "").trim();
  if (normalized === CANONICAL_FREE_SERVICE_ID) {
    return {
      message: "synapse gateway e2e smoke",
      source: "gateway-e2e",
    };
  }
  if (normalized === CANONICAL_PAID_SERVICE_ID) {
    return {
      message: "synapse gateway paid settlement e2e",
      source: "gateway-e2e",
    };
  }
  if (normalized === "svc_oss_security_healthcheck") {
    return {
      repoUrl: "https://github.com/SynapseNetworkAI/Synapse-Network",
      packageList: ["next", "react", "fumadocs-ui"],
      ecosystem: "npm",
    };
  }
  if (normalized === "svc_web3_sentiment_index") {
    return {
      symbol: "ETH",
      chain: "arbitrum",
      lookback_hours: 24,
      include_narrative: true,
    };
  }
  if (normalized === "svc_protocol_fundamental_brief") {
    return {
      protocol: "uniswap",
      chain: "arbitrum",
      peer_set: ["aave", "curve"],
      lookback_days: 30,
    };
  }
  if (normalized === CANONICAL_LLM_SERVICE_ID) {
    return {
      messages: [{ role: "user", content: "Reply with Synapse E2E ok." }],
      stream: false,
    };
  }
  return { prompt: "e2e automated test invocation" };
}

export function moneyFromDiscovery(row, fallback = "0") {
  const pricing =
    row?.pricing && typeof row.pricing === "object" ? row.pricing : {};
  return String(
    row?.basePriceUsdc ??
      row?.priceUsdc ??
      row?.unitPrice ??
      pricing.amount ??
      pricing.amountUsdc ??
      fallback
  );
}

export async function discoverCanonicalProviderService({
  api,
  serviceId = configuredCanonicalServiceId(),
  fail = (message) => {
    throw new Error(message);
  },
  log = () => {},
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 30,
  intervalMs = 2500,
} = {}) {
  const wanted = String(serviceId || "").trim();
  if (!wanted) fail("GATEWAY_E2E_SERVICE_ID cannot be empty.");

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const payload = (
      await api(`/v1/services/discover?q=${encodeURIComponent(wanted)}`, {
        expectOk: false,
      })
    ).payload;
    const services = Array.isArray(payload?.services)
      ? payload.services
      : Array.isArray(payload?.data?.services)
      ? payload.data.services
      : [];
    const row = services.find((service) =>
      [service.serviceId, service.service_id, service.id, service.agentToolName]
        .map((value) => String(value || ""))
        .includes(wanted)
    );
    if (row && row.isActive !== false && row.runtimeAvailable !== false) {
      const priceUsdc = moneyFromDiscovery(row, "");
      if (!priceUsdc || priceUsdc === "0") {
        fail(
          `Canonical service ${wanted} is discoverable but has no live fixed price.`
        );
      }
      log(`using canonical provider service: ${wanted} (${priceUsdc} USDC)`);
      return {
        id: wanted,
        name: row.serviceName || row.name || wanted,
        priceUsdc,
        discovery: row,
        invokePayload: canonicalInvokePayload(wanted),
      };
    }
    if (attempt < attempts) await sleep(intervalMs);
  }

  fail(canonicalMissingMessage(wanted));
}

export async function assertProviderOwnsCanonicalService({
  api,
  auth,
  serviceId,
  fail = (message) => {
    throw new Error(message);
  },
  log = () => {},
} = {}) {
  const wanted = String(serviceId || configuredCanonicalServiceId()).trim();
  const payload = (
    await api("/v1/services", {
      token: auth.token,
      address: auth.address,
      expectOk: false,
    })
  ).payload;
  const rows = Array.isArray(payload?.services)
    ? payload.services
    : Array.isArray(payload?.data?.services)
    ? payload.data.services
    : [];
  const ownsService = rows.some((service) =>
    [service.serviceId, service.service_id, service.id, service.agentToolName]
      .map((value) => String(value || ""))
      .includes(wanted)
  );
  if (!ownsService) {
    fail(
      `Provider wallet ${auth.address} does not own canonical service ${wanted}. ` +
        "Run Synapse-Network-Provider onboarding for the same local/staging Gateway and provider key."
    );
  }
  log(`canonical provider ownership verified: ${wanted} -> ${auth.address}`);
}
