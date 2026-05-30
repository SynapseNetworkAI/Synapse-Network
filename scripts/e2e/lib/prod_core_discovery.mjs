import { moneyFromDiscovery } from "./canonical_provider_service.mjs";

function discoveryRows(payload) {
  return payload?.results || payload?.services || payload?.data?.services || [];
}

function serviceIdentifiers(row) {
  return [row.serviceId, row.service_id, row.id, row.agentToolName].map(String);
}

function matchesServiceId(row, serviceId) {
  return serviceIdentifiers(row).includes(serviceId);
}

async function searchDiscoveryCatalog({ api, serviceId }) {
  const result = await api("/v1/agent/discovery/search", {
    method: "POST",
    body: {
      searchQuery: serviceId,
      limit: 20,
    },
  });
  const rows = discoveryRows(result.payload);
  if (rows.some((item) => matchesServiceId(item, serviceId))) return rows;

  const fallback = await api("/v1/agent/discovery/search", {
    method: "POST",
    body: {
      searchQuery: "",
      limit: 100,
    },
  });
  return discoveryRows(fallback.payload);
}

export async function discoverProdCoreService({
  api,
  addCheck,
  fatal,
  mode,
  serviceId,
}) {
  const rows = await searchDiscoveryCatalog({ api, serviceId });
  const row = rows.find((item) => matchesServiceId(item, serviceId));
  if (!row) fatal(`Prod catalog service not discoverable: ${serviceId}`);

  const priceUsdc = moneyFromDiscovery(row, "");
  if (!priceUsdc)
    fatal(`Prod catalog service missing live price: ${serviceId}`);

  addCheck("invoke:discover-service-live-price", true, {
    serviceId,
    priceUsdc,
  });
  if (mode === "free-invoke") {
    addCheck("invoke:free-service-price-zero", Number(priceUsdc) === 0, {
      serviceId,
      priceUsdc,
    });
  }
  return { row, priceUsdc };
}
