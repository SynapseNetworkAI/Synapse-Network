"use client";

import { useState, useCallback, useMemo } from "react";
import { ChevronDown, ChevronRight, Send, Copy, Check, Settings2 } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useActiveSection } from "../use-active-section";
import { StatusBadge } from "../components/StatusBadge";
import { useDocsPageNav } from "../use-docs-page-nav";

const PAGE_SECTIONS = ["api-auth", "api-balance", "api-services", "api-invocations", "api-credentials"];

const METHOD_COLOR: Record<string, string> = {
  GET:    "text-[#7ff7be] bg-[#7ff7be]/10 border-[#7ff7be]/20",
  POST:   "text-[#6eb6f6] bg-[#6eb6f6]/10 border-[#6eb6f6]/20",
  PUT:    "text-[#f9c74f] bg-[#f9c74f]/10 border-[#f9c74f]/20",
  DELETE: "text-red-400 bg-red-400/10 border-red-400/20",
};

interface RouteParam {
  name: string;
  in: "path" | "query" | "body";
  required: boolean;
  type: string;
  description: string;
  example?: string;
}

interface RouteEndpoint {
  id: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  auth: "none" | "jwt" | "credential";
  idempotency?: boolean;
  params?: RouteParam[];
  bodyExample?: object;
  responseExample?: object;
  agentNote?: string;
}

interface RouteGroup {
  id: string;
  title: string;
  description: string;
  routes: RouteEndpoint[];
}

const ROUTE_GROUPS: RouteGroup[] = [
  {
    id: "api-auth",
    title: "Auth",
    description: "Wallet challenge, signature verification, and session lifecycle.",
    routes: [
      {
        id: "get-challenge",
        method: "GET", path: "/api/v1/auth/challenge",
        summary: "Get EIP-191 sign challenge",
        description: "Returns a one-time challenge string for the given wallet address. The client signs this string with the wallet private key and submits it to /verify.",
        auth: "none",
        params: [{ name: "address", in: "query", required: true, type: "string", description: "Wallet address (0x...)", example: "0xYourWalletAddress" }],
        responseExample: { challenge: "Synapse login nonce: abc123 | ts: 1711234567" },
        agentNote: "Step 1 of owner auth. Call with the owner wallet address to get a challenge to sign.",
      },
      {
        id: "post-verify",
        method: "POST", path: "/api/v1/auth/verify",
        summary: "Verify signature, return JWT",
        description: "Submit the EIP-191 signed challenge. Gateway verifies the signature and returns a 24-hour JWT for subsequent requests.",
        auth: "none",
        bodyExample: { address: "0xYourWalletAddress", message: "Synapse login nonce: abc123 | ts: 1711234567", signature: "0x..." },
        responseExample: { token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
        agentNote: "Step 2 of owner auth. Submit signed challenge to receive the JWT used in all subsequent owner API calls.",
      },
      {
        id: "get-me",
        method: "GET", path: "/api/v1/auth/me",
        summary: "Get current owner profile",
        description: "Returns the wallet-linked account profile: display name, email, notification preferences, and registration timestamp.",
        auth: "jwt",
        responseExample: { wallet_address: "0x...", username: "owner-alias", email: "owner@example.com" },
        agentNote: "Verify the authenticated owner identity and read account metadata.",
      },
      {
        id: "post-logout",
        method: "POST", path: "/api/v1/auth/logout",
        summary: "Revoke current JWT",
        description: "Invalidates the current session token. Use this to cleanly terminate an owner session.",
        auth: "jwt",
        responseExample: { message: "Logged out" },
      },
    ],
  },
  {
    id: "api-balance",
    title: "Balance",
    description: "Account balances, deposits, confirmations, and withdrawals.",
    routes: [
      {
        id: "get-balance",
        method: "GET", path: "/api/v1/balance",
        summary: "Get account balance summary",
        description: "Returns the complete balance breakdown: consumer available (spendable), provider receivable (earned but unsettled), and protocol fee totals.",
        auth: "jwt",
        responseExample: { consumer_available_balance: "9.50", provider_receivable_balance: "0.00", protocol_fee_balance: "0.00" },
        agentNote: "Check whether the owner has enough spendable balance before issuing credentials or invoking services.",
      },
      {
        id: "post-deposit-intent",
        method: "POST", path: "/api/v1/balance/deposit/intent",
        summary: "Register deposit intent",
        description: "After completing the onchain SynapseCore deposit, register the txHash with the gateway. The gateway will index the deposit event and credit the spendable balance.",
        auth: "jwt",
        idempotency: true,
        bodyExample: { tx_hash: "0xOnchainTransactionHash", amount: 10 },
        responseExample: { intent: { id: "di_abc123", status: "pending", tx_hash: "0x..." } },
        agentNote: "Call immediately after the owner's USDC deposit transaction is confirmed onchain.",
      },
      {
        id: "post-deposit-confirm",
        method: "POST", path: "/api/v1/balance/deposit/intents/:id/confirm",
        summary: "Confirm deposit intent",
        description: "Once the deposit event is indexed by the gateway, confirm the intent to move it from pending to spendable balance.",
        auth: "jwt",
        params: [{ name: "id", in: "path", required: true, type: "string", description: "Deposit intent ID", example: "di_abc123" }],
        bodyExample: { event_key: "0xOnchainTransactionHash" },
        responseExample: { status: "confirmed", spendable_delta: "10.00" },
        agentNote: "Call after register_deposit_intent to complete the deposit flow.",
      },
    ],
  },
  {
    id: "api-services",
    title: "Services",
    description: "Service registration, discovery, listing, and pricing updates.",
    routes: [
      {
        id: "get-discover",
        method: "GET", path: "/api/v1/services/discover",
        summary: "Discover available services",
        description: "Returns the marketplace of active services available for invocation. Consumers use this to find service IDs before invoking. Supports text search and pagination.",
        auth: "jwt",
        params: [
          { name: "limit", in: "query", required: false, type: "integer", description: "Max results to return", example: "20" },
          { name: "search_query", in: "query", required: false, type: "string", description: "Free-text search", example: "sentiment" },
        ],
        responseExample: [{ service_id: "svc_xyz", name: "Sentiment Analysis", description: "Analyze text sentiment", price_per_call_usdc: "0.01" }],
        agentNote: "First step for a consumer agent: discover which services are available and get their service_id for quoting/invoking.",
      },
      {
        id: "post-service",
        method: "POST", path: "/api/v1/services",
        summary: "Register a new service",
        description: "Provider registers an API service on the Synapse marketplace. The endpoint_url is the provider's backend that the gateway will proxy calls to.",
        auth: "jwt",
        bodyExample: { name: "Sentiment Analysis", description: "Analyze text sentiment", endpoint_url: "https://your-api.example.com/analyze", price_per_call_usdc: "0.01" },
        responseExample: { service_id: "svc_xyz", status: "active" },
        agentNote: "Used by provider agents to publish their API as a paid service on the marketplace.",
      },
      {
        id: "get-services",
        method: "GET", path: "/api/v1/services",
        summary: "List own registered services",
        description: "Returns all services registered by the authenticated provider wallet.",
        auth: "jwt",
        responseExample: [{ service_id: "svc_xyz", name: "Sentiment Analysis", status: "active" }],
      },
      {
        id: "put-service",
        method: "PUT", path: "/api/v1/services/:id",
        summary: "Update service config",
        description: "Update the service description, endpoint URL, or price. Only the owning provider wallet can update.",
        auth: "jwt",
        params: [{ name: "id", in: "path", required: true, type: "string", description: "Service ID", example: "svc_xyz" }],
        bodyExample: { price_per_call_usdc: "0.02" },
        responseExample: { service_id: "svc_xyz", price_per_call_usdc: "0.02" },
      },
      {
        id: "delete-service",
        method: "DELETE", path: "/api/v1/services/:id",
        summary: "Delete service",
        description: "Deactivates and removes a service from the marketplace. Pending invocations will still be settled.",
        auth: "jwt",
        params: [{ name: "id", in: "path", required: true, type: "string", description: "Service ID", example: "svc_xyz" }],
        responseExample: { message: "Service deleted" },
      },
    ],
  },
  {
    id: "api-invocations",
    title: "Agent Invocations",
    description: "Quotes, paid invocations, and invocation history.",
    routes: [
      {
        id: "post-quote",
        method: "POST", path: "/api/v1/agent/quotes",
        summary: "Get invocation quote",
        description: "Request a price quote for calling a service. The quote is locked for 60 seconds and must be used in the subsequent invoke call. Use Agent Credential in Authorization header.",
        auth: "credential",
        bodyExample: { service_id: "svc_xyz" },
        responseExample: { quote_id: "q_abc123", price_usdc: "0.01", valid_until: "2026-01-01T00:01:00Z" },
        agentNote: "Get a price lock on a service before invoking. The quote_id proves the agent accepted the price.",
      },
      {
        id: "post-invoke",
        method: "POST", path: "/api/v1/agent/invocations",
        summary: "Execute paid invocation",
        description: "Invoke a service using a valid quote. The gateway deducts the quoted amount from the credential's balance, proxies the call to the provider, and records the receipt. Pass X-Idempotency-Key to prevent duplicate charges.",
        auth: "credential",
        idempotency: true,
        bodyExample: { quote_id: "q_abc123", payload: { prompt: "Analyze sentiment of: hello world" } },
        responseExample: { invocation_id: "inv_xyz", status: "completed", charged_usdc: "0.01", result: { sentiment: "positive" } },
        agentNote: "The core M2M call. Agents call this to consume a paid API service and get the result back.",
      },
      {
        id: "get-invocation",
        method: "GET", path: "/api/v1/agent/invocations/:invocationId",
        summary: "Get invocation receipt",
        description: "Fetch the receipt for a specific invocation. Use this to verify the result and confirm the charged amount after settlement.",
        auth: "credential",
        params: [{ name: "invocationId", in: "path", required: true, type: "string", description: "Invocation ID", example: "inv_xyz" }],
        responseExample: { invocation_id: "inv_xyz", status: "completed", charged_usdc: "0.01", result: {} },
        agentNote: "Verify that an invocation completed and get the final settlement amount.",
      },
      {
        id: "get-invocations",
        method: "GET", path: "/api/v1/agent/invocations",
        summary: "List invocation history",
        description: "Returns a paginated list of past invocations for the credential holder.",
        auth: "credential",
        params: [{ name: "limit", in: "query", required: false, type: "integer", description: "Max results", example: "20" }],
        responseExample: [{ invocation_id: "inv_xyz", status: "completed", charged_usdc: "0.01" }],
      },
    ],
  },
  {
    id: "api-credentials",
    title: "Credentials",
    description: "Issue, list, and revoke agent credentials.",
    routes: [
      {
        id: "post-credential",
        method: "POST", path: "/api/v1/credentials/agent/issue",
        summary: "Issue agent credential",
        description: "Mint a new agent credential with spend controls. The credential token is passed as the Bearer token for all /agent/* calls. Owner uses jwt; credential is given to the agent runtime.",
        auth: "jwt",
        bodyExample: { name: "consumer-agent-01", max_calls: 100, credit_limit: 5, rpm: 60 },
        responseExample: { token: "snk_agent_...", credential_id: "cred_abc", name: "consumer-agent-01" },
        agentNote: "Owner calls this to mint a spend-limited token to hand to an autonomous agent. The agent uses this token for all invocations.",
      },
      {
        id: "get-credentials",
        method: "GET", path: "/api/v1/credentials/agent",
        summary: "List all credentials",
        description: "Returns all active agent credentials for the authenticated owner wallet.",
        auth: "jwt",
        responseExample: [{ credential_id: "cred_abc", name: "consumer-agent-01", status: "active", calls_used: 3 }],
        agentNote: "Owner can audit which agent tokens are active and how many calls each has consumed.",
      },
      {
        id: "delete-credential",
        method: "DELETE", path: "/api/v1/credentials/agent/:id",
        summary: "Revoke credential",
        description: "Immediately invalidates an agent credential. Any subsequent invocation attempt using this token will be rejected by the gateway.",
        auth: "jwt",
        params: [{ name: "id", in: "path", required: true, type: "string", description: "Credential ID", example: "cred_abc" }],
        responseExample: { message: "Credential revoked" },
        agentNote: "Emergency shutoff: revoke a compromised or expired agent token immediately.",
      },
    ],
  },
];

// ─── Curl builder ──────────────────────────────────────────────────────────────
function buildCurl(
  route: RouteEndpoint,
  gatewayUrl: string,
  token: string,
  paramValues: Record<string, string>,
  bodyText: string,
): string {
  let url = `${gatewayUrl}${route.path}`;

  // Replace path params
  (route.params ?? []).filter((p) => p.in === "path").forEach((p) => {
    url = url.replace(`:${p.name}`, paramValues[p.name] ?? `:${p.name}`);
  });

  // Query params
  const query = (route.params ?? [])
    .filter((p) => p.in === "query" && paramValues[p.name])
    .map((p) => `${p.name}=${encodeURIComponent(paramValues[p.name])}`)
    .join("&");
  if (query) url += `?${query}`;

  const parts: string[] = [
    `curl -X ${route.method} \\`,
    `  '${url}'`,
    ...(token ? [`  -H 'Authorization: Bearer ${token}'`] : []),
    ...(route.idempotency ? [`  -H 'X-Idempotency-Key: idem-key-${Date.now()}'`] : []),
    ...(["POST", "PUT", "PATCH"].includes(route.method) && bodyText.trim()
      ? [`  -H 'Content-Type: application/json'`, `  -d '${bodyText.trim()}'`]
      : []),
  ];

  return parts.join(" \\\n");
}

// ─── Try It Panel ──────────────────────────────────────────────────────────────
function TryItPanel({
  route,
  gatewayUrl,
  token,
}: Readonly<{
  route: RouteEndpoint;
  gatewayUrl: string;
  token: string;
}>) {
  const [paramValues, setParamValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    (route.params ?? []).forEach((p) => { if (p.example) init[p.name] = p.example; });
    return init;
  });
  const [bodyText, setBodyText] = useState(
    route.bodyExample ? JSON.stringify(route.bodyExample, null, 2) : "",
  );
  const [response, setResponse] = useState<{ status: number; body: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const curl = useMemo(
    () => buildCurl(route, gatewayUrl, token, paramValues, bodyText),
    [route, gatewayUrl, token, paramValues, bodyText],
  );

  const handleSend = useCallback(async () => {
    setLoading(true);
    setResponse(null);
    try {
      let url = `${gatewayUrl}${route.path}`;
      (route.params ?? []).filter((p) => p.in === "path").forEach((p) => {
        url = url.replace(`:${p.name}`, paramValues[p.name] ?? `:${p.name}`);
      });
      const qs = (route.params ?? [])
        .filter((p) => p.in === "query" && paramValues[p.name])
        .map((p) => `${p.name}=${encodeURIComponent(paramValues[p.name])}`)
        .join("&");
      if (qs) url += `?${qs}`;

      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (route.idempotency) headers["X-Idempotency-Key"] = `idem-key-${Date.now()}`;
      if (["POST", "PUT", "PATCH"].includes(route.method) && bodyText.trim()) {
        headers["Content-Type"] = "application/json";
      }

      const res = await fetch(url, {
        method: route.method,
        headers,
        body: ["POST", "PUT", "PATCH"].includes(route.method) && bodyText.trim() ? bodyText : undefined,
      });

      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      setResponse({ status: res.status, body: pretty });
    } catch (e: unknown) {
      setResponse({ status: 0, body: String(e) });
    } finally {
      setLoading(false);
    }
  }, [route, gatewayUrl, token, paramValues, bodyText]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(curl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [curl]);

  const pathParams = (route.params ?? []).filter((p) => p.in === "path");
  const queryParams = (route.params ?? []).filter((p) => p.in === "query");

  return (
    <div className="mt-1 grid grid-cols-1 gap-4 rounded-b-2xl border border-t-0 border-white/[0.06] bg-[#070809] p-5 xl:grid-cols-2">
      {/* ── Left: params + body ── */}
      <div className="space-y-4">
        {route.agentNote && (
          <div className="rounded-xl border border-[#6eb6f6]/16 bg-[#6eb6f6]/[0.04] px-4 py-3 text-[12px] leading-6 text-[#6eb6f6]">
            <span className="mr-1.5 font-semibold uppercase tracking-widest text-[10px] text-[#4e535a]">Agent Note</span>
            {route.agentNote}
          </div>
        )}

        {pathParams.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">Path Params</div>
            {pathParams.map((p) => (
              <div key={p.name} className="space-y-1">
                <div className="flex items-center gap-2">
                  <code className="text-[11px] text-[#c0c5cc] font-mono">{p.name}</code>
                  {p.required && <span className="text-[9px] text-red-400 border border-red-400/30 px-1 rounded">required</span>}
                  <span className="text-[10px] text-[#4e535a]">{p.type}</span>
                </div>
                <input
                  className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[12px] text-[#c0c5cc] placeholder:text-[#4e535a] focus:border-white/20 focus:outline-none"
                  placeholder={p.example ?? p.name}
                  value={paramValues[p.name] ?? ""}
                  onChange={(e) => setParamValues((v) => ({ ...v, [p.name]: e.target.value }))}
                />
                <p className="text-[11px] text-[#4e535a]">{p.description}</p>
              </div>
            ))}
          </div>
        )}

        {queryParams.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">Query Params</div>
            {queryParams.map((p) => (
              <div key={p.name} className="space-y-1">
                <div className="flex items-center gap-2">
                  <code className="text-[11px] text-[#c0c5cc] font-mono">{p.name}</code>
                  {p.required && <span className="text-[9px] text-red-400 border border-red-400/30 px-1 rounded">required</span>}
                  <span className="text-[10px] text-[#4e535a]">{p.type}</span>
                </div>
                <input
                  className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[12px] text-[#c0c5cc] placeholder:text-[#4e535a] focus:border-white/20 focus:outline-none"
                  placeholder={p.example ?? p.name}
                  value={paramValues[p.name] ?? ""}
                  onChange={(e) => setParamValues((v) => ({ ...v, [p.name]: e.target.value }))}
                />
                <p className="text-[11px] text-[#4e535a]">{p.description}</p>
              </div>
            ))}
          </div>
        )}

        {route.bodyExample && (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">Request Body</div>
            <textarea
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[12px] text-[#c0c5cc] focus:border-white/20 focus:outline-none"
              rows={Math.min(12, bodyText.split("\n").length + 1)}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              spellCheck={false}
            />
          </div>
        )}

        <button
          onClick={handleSend}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-[13px] font-semibold text-[#0f1419] transition-colors hover:bg-[#e7e9ea] disabled:opacity-50"
        >
          <Send size={14} />
          {loading ? "Sending..." : "Send"}
        </button>
      </div>

      {/* ── Right: cURL + response ── */}
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">cURL</div>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 rounded-lg border border-white/[0.06] px-2 py-1 text-[11px] text-[#71767b] transition-colors hover:border-white/[0.1] hover:text-[#c0c5cc]"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#040506] p-4 text-[11px] leading-6 text-[#9aa4af]">
            <code>{curl}</code>
          </pre>
        </div>

        {response && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">Response</div>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold ${
                  response.status >= 200 && response.status < 300
                    ? "bg-[#7ff7be]/10 text-[#7ff7be]"
                    : "bg-red-400/10 text-red-400"
                }`}
              >
                {response.status || "Error"}
              </span>
            </div>
            <pre className="max-h-64 overflow-auto rounded-xl border border-white/[0.06] bg-[#040506] p-4 text-[11px] leading-6 text-[#9aa4af]">
              <code>{response.body}</code>
            </pre>
          </div>
        )}

        {!response && route.responseExample && (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">Example Response</div>
            <pre className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#040506] p-4 text-[11px] leading-6 text-[#9aa4af] opacity-60">
              <code>{JSON.stringify(route.responseExample, null, 2)}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Endpoint Row ──────────────────────────────────────────────────────────────
function EndpointRow({
  route,
  gatewayUrl,
  token,
  expanded,
  onToggle,
}: Readonly<{
  route: RouteEndpoint;
  gatewayUrl: string;
  token: string;
  expanded: boolean;
  onToggle: () => void;
}>) {
  const chevron = expanded ? (
    <ChevronDown size={14} className="text-[#4e535a] shrink-0" />
  ) : (
    <ChevronRight size={14} className="text-[#4e535a] shrink-0" />
  );

  return (
    <div>
      <button
        onClick={onToggle}
        className="group w-full rounded-t-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-left transition-colors hover:border-white/[0.1] hover:bg-white/[0.03] data-[expanded=true]:rounded-b-none data-[expanded=true]:border-b-transparent"
        data-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          {chevron}
          <span
            className={`inline-block w-[52px] text-center text-[10px] font-semibold tracking-widest border rounded px-1.5 py-0.5 font-mono ${METHOD_COLOR[route.method] ?? ""}`}
          >
            {route.method}
          </span>
          <code className="text-[12px] font-mono text-[#c0c5cc]">{route.path}</code>
          <span className="hidden text-[12px] text-[#71767b] md:block">{route.summary}</span>
          {route.auth !== "none" && (
            <span className="ml-auto text-[10px] text-[#4e535a] border border-white/10 px-1.5 py-0.5 rounded font-mono shrink-0">
              {route.auth === "credential" ? "CRED" : "JWT"}
            </span>
          )}
        </div>
        {!expanded && (
          <p className="mt-1.5 pl-[88px] text-[11px] text-[#71767b] leading-5 md:hidden">{route.summary}</p>
        )}
      </button>

      {expanded && (
        <>
          <div className="border border-t-0 border-b-0 border-white/[0.06] bg-[#070809] px-5 pt-4">
            <p className="text-[13px] leading-7 text-[#8b98a5]">{route.description}</p>
          </div>
          <TryItPanel route={route} gatewayUrl={gatewayUrl} token={token} />
        </>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────
export default function ApiReferencePage() {
  const { t, tList } = useLanguage();
  useActiveSection(PAGE_SECTIONS, "api-auth");

  const groupTitles = tList("docsPage.apiGroupTitles");
  const groupDescriptions = tList("docsPage.apiGroupDescriptions");

  const groups = ROUTE_GROUPS.map((g, i) => ({
    ...g,
    title: groupTitles[i] ?? g.title,
    description: groupDescriptions[i] ?? g.description,
  }));

  useDocsPageNav(groups.map((g) => ({ id: g.id, label: g.title })));

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [gatewayUrl, setGatewayUrl] = useState("http://127.0.0.1:8000");
  const [showConfig, setShowConfig] = useState(false);

  const toggle = useCallback((id: string) => {
    setExpandedId((cur) => (cur === id ? null : id));
  }, []);

  return (
    <div className="space-y-12">
      {/* ── Header ── */}
      <div className="space-y-3 border-b border-white/[0.06] pb-8">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
            {t("docsPage.apiEyebrow")}
          </span>
          <StatusBadge status="GA" />
        </div>
        <h1 className="x-page-title text-white">{t("docsPage.apiTitle")}</h1>
        <p className="x-body-copy max-w-[560px]">
          {t("docsPage.apiDescription")}{" "}
          <code className="text-[#7ff7be] font-mono text-[13px] bg-[#7ff7be]/8 px-1.5 py-0.5 rounded">/api</code>{" "}
          <code className="text-[#c0c5cc] font-mono text-[13px] ml-1">https://gateway.synapse.network</code>
        </p>
        <div className="flex flex-wrap gap-4 pt-1">
          {(["GET", "POST", "PUT", "DELETE"] as const).map((m) => (
            <div key={m} className="flex items-center gap-2">
              <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border font-mono ${METHOD_COLOR[m]}`}>{m}</span>
              <span className="text-[12px] text-[#71767b]">
                {{ GET: t("docsPage.apiLegendRead"), POST: t("docsPage.apiLegendCreate"), PUT: t("docsPage.apiLegendUpdate"), DELETE: t("docsPage.apiLegendDelete") }[m]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Try It Config Bar ── */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-semibold text-[#c0c5cc]">Try It — Authorization & Endpoint</div>
          <button
            onClick={() => setShowConfig((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] px-2.5 py-1.5 text-[11px] text-[#71767b] transition-colors hover:border-white/[0.1] hover:text-[#c0c5cc]"
          >
            <Settings2 size={12} />
            {showConfig ? "Collapse" : "Configure"}
          </button>
        </div>

        {showConfig && (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="try-gateway-url" className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">
                Gateway URL
              </label>
              <input
                id="try-gateway-url"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[12px] text-[#c0c5cc] placeholder:text-[#4e535a] focus:border-white/20 focus:outline-none"
                value={gatewayUrl}
                onChange={(e) => setGatewayUrl(e.target.value)}
                placeholder="http://127.0.0.1:8000"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="try-bearer-token" className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">
                Bearer Token (JWT or Agent Credential)
              </label>
              <input
                id="try-bearer-token"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[12px] text-[#c0c5cc] placeholder:text-[#4e535a] focus:border-white/20 focus:outline-none"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste JWT or snk_agent_... here"
                type="password"
              />
              <p className="text-[11px] text-[#4e535a]">
                JWT for owner endpoints (marked <span className="font-mono">JWT</span>), agent credential token for invocation endpoints (marked <span className="font-mono">CRED</span>).
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Route Groups ── */}
      {groups.map((group) => (
        <section key={group.id} id={group.id} className="space-y-3">
          <div className="space-y-1">
            <h2 className="x-section-title text-white">{group.title}</h2>
            <p className="text-[13px] text-[#71767b]">{group.description}</p>
          </div>
          <div className="space-y-1">
            {group.routes.map((route) => (
              <EndpointRow
                key={route.id}
                route={route}
                gatewayUrl={gatewayUrl}
                token={token}
                expanded={expandedId === route.id}
                onToggle={() => toggle(route.id)}
              />
            ))}
          </div>
        </section>
      ))}

      {/* ── Auth Note ── */}
      <div className="x-panel-muted rounded-xl p-5 flex gap-3">
        <span className="text-[#7ff7be] mt-0.5 shrink-0">🔐</span>
        <div className="space-y-1">
          <p className="text-[13px] font-semibold text-[#c0c5cc]">{t("docsPage.apiAuthNoteTitle")}</p>
          <p className="text-[13px] text-[#71767b] leading-relaxed">{t("docsPage.apiAuthNoteDescription")}</p>
        </div>
      </div>

      <div className="h-16" />
    </div>
  );
}
