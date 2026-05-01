import http from "node:http";

const localServiceNames = {
  svc_web3_sentiment_index: "Web3 Sentiment Index",
  svc_protocol_fundamental_brief: "Protocol Fundamental Brief",
  svc_oss_security_healthcheck: "OSS Security Healthcheck",
};

export function startLocalProviderFixture() {
  let healthy = true;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/health") {
      res.writeHead(healthy ? 200 : 500, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify({ status: healthy ? "ok" : "down" }));
      return;
    }
    if (
      url.pathname.startsWith("/provider-services/") &&
      url.pathname.endsWith("/invoke")
    ) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "success",
          fixture: true,
          serviceId: url.pathname.split("/")[2],
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        setHealthy: (value) => {
          healthy = Boolean(value);
        },
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

export function serviceRegistrationBody(serviceId, baseUrl, ownerWallet) {
  const serviceName = localServiceNames[serviceId] || serviceId;
  return {
    serviceId,
    agentToolName: serviceId,
    serviceName,
    role: "Provider",
    status: "active",
    isActive: true,
    pricing: { amount: "0.000000", currency: "USDC" },
    priceModel: "fixed",
    summary: `Local Gateway Pull Health fixture for ${serviceName}`,
    tags: ["e2e", "gateway-pull-health"],
    auth: { type: "gateway_signed" },
    constraints: {
      timeoutMs: 3000,
      maxQps: 10,
      maxRequestBytes: 65536,
      maxResponseBytes: 65536,
    },
    forwarding: { requestIdHeader: "X-Synapse-Request-Id" },
    invoke: {
      method: "POST",
      targets: [
        {
          url: `${baseUrl}/provider-services/${serviceId}/invoke`,
          weight: 100,
        },
      ],
      request: {
        contentType: "application/json",
        schema: { body: { type: "object" } },
      },
      response: {
        contentType: "application/json",
        schema: { body: { type: "object" } },
      },
    },
    healthCheck: {
      path: "/health",
      method: "GET",
      timeoutMs: 1000,
      successCodes: [200],
      healthyThreshold: 1,
      unhealthyThreshold: 1,
    },
    payoutAccount: {
      payoutAddress: ownerWallet,
      chainId: 421614,
      settlementCurrency: "USDC",
      status: "active",
    },
    providerProfile: { displayName: "Gateway Pull Health E2E Provider" },
    governance: {
      termsAccepted: true,
      riskAcknowledged: true,
      note: "local Gateway Pull Health dogfood fixture",
    },
  };
}
