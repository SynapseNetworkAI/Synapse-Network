// Shared endpoint definitions — imported by both the overview page and individual [id] pages.

export const METHOD_COLOR: Record<string, string> = {
  GET: "text-[#7ff7be] bg-[#7ff7be]/10 border-[#7ff7be]/20",
  POST: "text-[#6eb6f6] bg-[#6eb6f6]/10 border-[#6eb6f6]/20",
  PUT: "text-[#f9c74f] bg-[#f9c74f]/10 border-[#f9c74f]/20",
  DELETE: "text-red-400 bg-red-400/10 border-red-400/20",
};

export const ROLE_BADGE: Record<string, { label: string; cls: string }> = {
  owner: { label: "Owner", cls: "text-[#f9c74f] bg-[#f9c74f]/10 border-[#f9c74f]/30" },
  consumer_agent: { label: "Consumer Agent", cls: "text-[#6eb6f6] bg-[#6eb6f6]/10 border-[#6eb6f6]/30" },
  provider: { label: "Provider", cls: "text-[#c084fc] bg-[#c084fc]/10 border-[#c084fc]/30" },
  public: { label: "Public", cls: "text-[#71767b] bg-[#71767b]/10 border-[#71767b]/20" },
};

export const PHASE_BADGE: Record<string, string> = {
  auth: "text-[#7ff7be] bg-[#7ff7be]/8 border-[#7ff7be]/20",
  deposit: "text-[#f9c74f] bg-[#f9c74f]/8 border-[#f9c74f]/20",
  register: "text-[#c084fc] bg-[#c084fc]/8 border-[#c084fc]/20",
  discover: "text-[#6eb6f6] bg-[#6eb6f6]/8 border-[#6eb6f6]/20",
  invoke: "text-green-400 bg-green-400/8 border-green-400/20",
  manage: "text-[#71767b] bg-[#71767b]/8 border-[#71767b]/20",
};

export interface RouteParam {
  name: string;
  in: "path" | "query" | "body" | "header";
  required: boolean;
  type: string;
  description: string;
  example?: string;
  enum?: string[];
}

export interface AgentOutput {
  key: string;
  desc: string;
}

export interface AgentMeta {
  role: "owner" | "consumer_agent" | "provider" | "public";
  phase: "auth" | "deposit" | "register" | "discover" | "invoke" | "manage";
  note: string;
  outputs?: AgentOutput[];
  requires?: string;
  next?: string;
}

export interface ErrorCode {
  status: number;
  code: string;
  message: string;
}

export interface RouteEndpoint {
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
  agentMeta: AgentMeta;
  errors?: ErrorCode[];
}

export interface RouteGroup {
  id: string;
  title: string;
  description: string;
  routes: RouteEndpoint[];
}

export const ROUTE_GROUPS: RouteGroup[] = [
  {
    id: "api-auth",
    title: "Auth",
    description: "Wallet challenge, signature verification, and session lifecycle.",
    routes: [
      {
        id: "get-challenge",
        method: "GET",
        path: "/api/v1/auth/challenge",
        summary: "Get EIP-191 sign challenge",
        description: "Returns a one-time nonce string for the given wallet address. Sign it with the owner private key and submit to /verify.",
        auth: "none",
        params: [
          { name: "address", in: "query", required: true, type: "string", description: "Owner wallet address (0x...)", example: "0xYourWalletAddress" },
        ],
        responseExample: { challenge: "Synapse login nonce: abc123 | ts: 1711234567" },
        agentMeta: {
          role: "owner",
          phase: "auth",
          note: "Step 1 of owner auth. Call with the owner wallet address to receive a time-limited nonce. Sign it immediately with ECDSA (EIP-191) and pass to POST /auth/verify.",
          outputs: [{ key: "challenge", desc: "Nonce string to sign with the owner private key" }],
          next: "Sign the nonce and submit to POST /api/v1/auth/verify",
        },
        errors: [
          { status: 400, code: "MISSING_ADDRESS", message: "address query param is required" },
          { status: 422, code: "INVALID_ADDRESS", message: "Not a valid 0x wallet address" },
        ],
      },
      {
        id: "post-verify",
        method: "POST",
        path: "/api/v1/auth/verify",
        summary: "Verify signature, return JWT",
        description: "Submit the EIP-191 signed challenge. Gateway verifies the signature and returns a 24-hour JWT.",
        auth: "none",
        bodyExample: { address: "0xYourWalletAddress", message: "Synapse login nonce: abc123 | ts: 1711234567", signature: "0x..." },
        responseExample: { token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
        agentMeta: {
          role: "owner",
          phase: "auth",
          note: "Step 2 of owner auth. Submit the signed challenge. On success the gateway returns a 24-hour JWT. Store it — all owner-side calls require it as the Bearer token.",
          requires: "GET /auth/challenge must be called first",
          outputs: [{ key: "token", desc: "JWT — Authorization: Bearer <token> on all JWT-required endpoints" }],
          next: "Store the JWT. Call GET /balance, POST /agent/credentials, or GET /services",
        },
        errors: [
          { status: 401, code: "VERIFICATION_FAILED", message: "Signature does not match wallet address" },
          { status: 422, code: "CHALLENGE_EXPIRED", message: "Challenge expired — request a new one" },
        ],
      },
      {
        id: "get-me",
        method: "GET",
        path: "/api/v1/auth/me",
        summary: "Get current owner profile",
        description: "Returns the wallet-linked account profile: display name, email, and notification preferences.",
        auth: "jwt",
        responseExample: { wallet_address: "0x...", username: "owner-alias", email: "owner@example.com" },
        agentMeta: {
          role: "owner",
          phase: "auth",
          note: "Confirm authenticated identity. Use after auth to verify the JWT is valid and which wallet it is bound to.",
          requires: "Valid JWT from POST /auth/verify",
        },
        errors: [{ status: 401, code: "UNAUTHORIZED", message: "Missing or expired JWT" }],
      },
      {
        id: "post-profile-challenge",
        method: "POST",
        path: "/api/v1/auth/me/profile/challenge",
        summary: "Get profile-update challenge",
        description: "Generates a one-time signing challenge for updating the account profile (name, email, preferences).",
        auth: "jwt",
        responseExample: { challenge: "Synapse profile update nonce: def456 | ts: 1711234600" },
        agentMeta: {
          role: "owner",
          phase: "manage",
          note: "Step 1 of a profile update. Generates a challenge that proves the owner wallet authorises the change. Required before PUT /auth/me/profile.",
          outputs: [{ key: "challenge", desc: "Nonce to sign before submitting profile update" }],
          next: "Sign the challenge and submit via PUT /api/v1/auth/me/profile",
        },
      },
      {
        id: "put-me-profile",
        method: "PUT",
        path: "/api/v1/auth/me/profile",
        summary: "Update account profile",
        description: "Submit wallet-signed proof to update account name, email, and notification preferences.",
        auth: "jwt",
        bodyExample: { signature: "0x...", message: "Synapse profile update nonce: def456 | ts: 1711234600", username: "new-alias", email: "new@example.com", notifications: true },
        responseExample: { wallet_address: "0x...", username: "new-alias", email: "new@example.com" },
        agentMeta: {
          role: "owner",
          phase: "manage",
          note: "Step 2 of profile update. Submits the signed challenge alongside new profile fields. Wallet signature prevents unauthorised profile changes.",
          requires: "Challenge from POST /auth/me/profile/challenge, signed by owner wallet",
        },
      },
      {
        id: "post-logout",
        method: "POST",
        path: "/api/v1/auth/logout",
        summary: "Revoke current JWT",
        description: "Invalidates the current session token server-side.",
        auth: "jwt",
        responseExample: { message: "Logged out" },
        agentMeta: {
          role: "owner",
          phase: "auth",
          note: "Invalidate the JWT when the session ends. After this call the token cannot be used for any further requests.",
          requires: "Valid JWT",
        },
      },
    ],
  },
  {
    id: "api-balance",
    title: "Balance",
    description: "Account balances, deposits, and spending-limit queries.",
    routes: [
      {
        id: "get-balance",
        method: "GET",
        path: "/api/v1/balance",
        summary: "Get account balance summary",
        description: "Returns the complete balance breakdown: consumer available (spendable by agents), provider receivable (earned, unsettled), and protocol fee totals.",
        auth: "jwt",
        responseExample: { consumer_available_balance: "9.50", provider_receivable_balance: "0.00", protocol_fee_balance: "0.00" },
        agentMeta: {
          role: "owner",
          phase: "deposit",
          note: "Check spendable balance before issuing agent credentials. consumer_available_balance is the USDC an agent can spend. If zero the owner must deposit USDC first.",
          requires: "Valid JWT",
          outputs: [{ key: "consumer_available_balance", desc: "Spendable USDC — must be > 0 before issuing agent credentials" }],
        },
        errors: [{ status: 401, code: "UNAUTHORIZED", message: "Missing or expired JWT" }],
      },
      {
        id: "post-deposit-intent",
        method: "POST",
        path: "/api/v1/balance/deposit/intent",
        summary: "Register deposit intent",
        description: "After completing the onchain SynapseCore.deposit() transaction, register the txHash to initiate balance indexing.",
        auth: "jwt",
        idempotency: true,
        bodyExample: { tx_hash: "0xOnchainTransactionHash", amount: 10 },
        responseExample: { intent: { id: "di_abc123", status: "pending", tx_hash: "0x..." } },
        agentMeta: {
          role: "owner",
          phase: "deposit",
          note: "Call after the onchain USDC deposit is confirmed. The gateway indexes the event and credits consumer_available_balance.",
          requires: "Valid JWT + confirmed onchain deposit transaction",
          outputs: [{ key: "intent.id", desc: "Deposit intent ID — use in the confirm endpoint" }],
          next: "Call POST /balance/deposit/intents/:id/confirm",
        },
        errors: [{ status: 409, code: "DUPLICATE_TX_HASH", message: "This transaction hash has already been registered" }],
      },
      {
        id: "get-spending-limit",
        method: "GET",
        path: "/api/v1/balance/spending-limit",
        summary: "Get spending limit configuration",
        description: "Returns the current velocity-limit policy for the owner account (daily, per-call).",
        auth: "jwt",
        responseExample: { daily_limit_usdc: "100.00", per_call_limit_usdc: "1.00" },
        agentMeta: {
          role: "owner",
          phase: "deposit",
          note: "Returns the configured spending velocity limits. Agent credential credit_limit must not exceed these limits.",
          requires: "Valid JWT",
        },
      },
    ],
  },
  {
    id: "api-services",
    title: "Services",
    description: "Service registration, discovery, listing, updates, and deletion.",
    routes: [
      {
        id: "get-discover",
        method: "GET",
        path: "/api/v1/services/discover",
        summary: "Discover available services",
        description: "Returns the marketplace of active, healthy services available for invocation. Supports text search and pagination.",
        auth: "none",
        params: [
          { name: "limit", in: "query", required: false, type: "integer", description: "Maximum results", example: "20" },
          { name: "search_query", in: "query", required: false, type: "string", description: "Free-text search over service names and descriptions", example: "sentiment" },
        ],
        responseExample: [{ serviceId: "svc_xyz", serviceName: "Sentiment Analysis", summary: "Analyze text sentiment", pricingAmount: "0.01", pricingCurrency: "USD" }],
        agentMeta: {
          role: "consumer_agent",
          phase: "discover",
          note: "First step for a consumer agent: scan the marketplace for available paid APIs. Filter by keyword to find relevant tools. Returns serviceId and priceUsdc needed for invoke.",
          outputs: [{ key: "serviceId", desc: "Service identifier — pass to POST /agent/invoke with costUsdc for a price-asserting single-call invoke" }],
          next: "Pick a serviceId + note priceUsdc, then call POST /agent/invoke with costUsdc",
        },
      },
      {
        id: "post-service",
        method: "POST",
        path: "/api/v1/services",
        summary: "Register a new service",
        description: "Provider registers an API service on the Synapse marketplace. The gateway proxies incoming invocations to invoke.targets.",
        auth: "jwt",
        bodyExample: { serviceName: "Sentiment Analysis", agentToolName: "sentiment-analysis", summary: "Analyze text sentiment via ML model", pricing: { currency: "USD", amount: "0.01" }, invoke: { method: "POST", targets: [{ url: "https://your-api.example.com/analyze", weight: 100 }], request: {}, response: {} } },
        responseExample: { serviceId: "svc_xyz", status: "active" },
        agentMeta: {
          role: "provider",
          phase: "register",
          note: "Provider publishes their API as a paid service. The gateway proxies calls to invoke.targets and handles payment automatically.",
          requires: "Valid JWT from a provider wallet",
          outputs: [{ key: "serviceId", desc: "Assigned service ID — share with consumers or use to update/delete" }],
        },
        errors: [
          { status: 422, code: "INVALID_MANIFEST", message: "Missing required fields: serviceName, invoke.targets" },
          { status: 409, code: "DUPLICATE_SERVICE_ID", message: "agentToolName already exists" },
        ],
      },
      {
        id: "get-services",
        method: "GET",
        path: "/api/v1/services",
        summary: "List own registered services",
        description: "Returns all services registered by the authenticated provider wallet.",
        auth: "jwt",
        responseExample: [{ serviceId: "svc_xyz", serviceName: "Sentiment Analysis", isActive: true }],
        agentMeta: {
          role: "provider",
          phase: "manage",
          note: "List all services the authenticated provider has registered. Use to audit active services or get serviceIds for updates.",
          requires: "Valid JWT (provider)",
        },
      },
      {
        id: "put-service",
        method: "PUT",
        path: "/api/v1/services/:id",
        summary: "Update service config",
        description: "Update any service field including isActive. To delete a service, first set isActive: false, then call DELETE.",
        auth: "jwt",
        params: [{ name: "id", in: "path", required: true, type: "string", description: "Service ID", example: "svc_xyz" }],
        bodyExample: { isActive: false },
        responseExample: { service: { serviceId: "svc_xyz", isActive: false } },
        agentMeta: {
          role: "provider",
          phase: "manage",
          note: "Update service config. Critical: to delete a service, first PUT {isActive: false} to deactivate it, then call DELETE. Deleting an active service returns 409.",
          requires: "Valid JWT (provider who owns the service)",
          next: "If deactivating before deletion, call DELETE /services/:id after isActive is false",
        },
        errors: [
          { status: 409, code: "SERVICE_ALREADY_DELETED", message: "Service is already deleted" },
          { status: 404, code: "SERVICE_NOT_FOUND", message: "No service with this ID owned by caller" },
        ],
      },
      {
        id: "delete-service",
        method: "DELETE",
        path: "/api/v1/services/:id",
        summary: "Delete service",
        description: "Permanently archives a service. The service MUST be inactive (isActive: false) before deletion.",
        auth: "jwt",
        params: [{ name: "id", in: "path", required: true, type: "string", description: "Service ID", example: "svc_xyz" }],
        responseExample: { status: "success", message: "Service deleted" },
        agentMeta: {
          role: "provider",
          phase: "manage",
          note: "Soft-archives a service. Guard: service MUST be deactivated (via PUT {isActive: false}) first, or this returns 409 SERVICE_DELETE_ACTIVE_CONFLICT.",
          requires: "Service MUST be deactivated — call PUT /services/:id {isActive: false} first",
        },
        errors: [
          { status: 409, code: "SERVICE_DELETE_ACTIVE_CONFLICT", message: "Service is still active — deactivate with PUT {isActive: false} first" },
          { status: 404, code: "SERVICE_NOT_FOUND", message: "No service with this ID owned by caller" },
        ],
      },
    ],
  },
  {
    id: "api-invocations",
    title: "Agent Invocations",
    description: "Paid invocations and invocation history.",
    routes: [
      {
        id: "post-agent-invoke",
        method: "POST",
        path: "/api/v1/agent/invoke",
        summary: "Invoke a service (price assertion)",
        description: "Invoke a service in one HTTP call. Pass costUsdc — the price the agent saw in discovery. Gateway returns 422 PRICE_MISMATCH if the live price has changed, so the agent re-discovers and retries before being charged.",
        auth: "credential",
        idempotency: true,
        bodyExample: { serviceId: "svc_xyz", idempotencyKey: "job-001", costUsdc: 0.05, payload: { body: { prompt: "hello" } } },
        responseExample: { invocationId: "inv_abc", status: "SUCCEEDED", chargedUsdc: 0.05, result: { answer: "..." } },
        agentMeta: {
          role: "consumer_agent",
          phase: "invoke",
          note: "Preferred invoke path. The agent passes the price it saw during discovery. If the Provider has changed the price, gateway rejects with PRICE_MISMATCH — the agent re-discovers and retries. No charge is made on mismatch.",
          requires: "Agent credential + service price from a prior discover() call",
          outputs: [
            { key: "invocationId", desc: "Settlement receipt ID" },
            { key: "chargedUsdc", desc: "Actual USDC deducted — will equal costUsdc when successful" },
            { key: "result", desc: "Proxied provider API response" },
          ],
          next: "On PRICE_MISMATCH (422): re-call discover() to get the updated price, then retry invoke().",
        },
        errors: [
          { status: 422, code: "PRICE_MISMATCH", message: "Service price changed since discovery — re-discover and retry" },
          { status: 402, code: "BUDGET_EXHAUSTED", message: "Credential budget does not allow this invocation" },
          { status: 404, code: "SERVICE_NOT_FOUND", message: "Service is not active" },
          { status: 409, code: "IDEMPOTENCY_CONFLICT", message: "Idempotency key reused with different payload" },
          { status: 502, code: "UPSTREAM_ERROR", message: "Provider service returned an error" },
        ],
      },
      {
        id: "get-invocation",
        method: "GET",
        path: "/api/v1/agent/invocations/:invocationId",
        summary: "Get invocation receipt",
        description: "Fetch the settlement receipt for a specific invocation.",
        auth: "credential",
        params: [{ name: "invocationId", in: "path", required: true, type: "string", description: "Invocation ID", example: "inv_xyz" }],
        responseExample: { invocation_id: "inv_xyz", status: "completed", charged_usdc: "0.01", result: {} },
        agentMeta: {
          role: "consumer_agent",
          phase: "invoke",
          note: "Retrieve the settlement receipt for any past invocation. Use to verify completion, audit charges, or retrieve the result if the original response was lost.",
          requires: "Agent credential token",
        },
        errors: [{ status: 404, code: "INVOCATION_NOT_FOUND", message: "No invocation found with this ID" }],
      },
      {
        id: "get-invocations",
        method: "GET",
        path: "/api/v1/usage/logs",
        summary: "List invocation history",
        description: "Owner-level audit log of all invocations under this wallet. Paginated.",
        auth: "jwt",
        params: [{ name: "limit", in: "query", required: false, type: "integer", description: "Max results", example: "20" }],
        responseExample: [{ invocation_id: "inv_xyz", status: "completed", charged_usdc: "0.01" }],
        agentMeta: {
          role: "owner",
          phase: "invoke",
          note: "Owner-level audit view of all invocations under this wallet. Use to reconcile charges, monitor agent activity, and verify settlement amounts.",
          requires: "Valid JWT (owner)",
        },
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
        method: "POST",
        path: "/api/v1/agent/credentials",
        summary: "Issue agent credential",
        description: "Mint a new spend-limited agent credential. The returned token is used by the agent runtime for all /agent/* calls.",
        auth: "jwt",
        bodyExample: { name: "consumer-agent-01", max_calls: 100, credit_limit: 5, rpm: 60 },
        responseExample: { credential: { token: "snk_agent_...", credential_id: "cred_abc", name: "consumer-agent-01" } },
        agentMeta: {
          role: "owner",
          phase: "manage",
          note: "Owner mints a spend-limited token for an autonomous agent. max_calls and credit_limit prevent runaway spending. Pass the token to the agent — never expose the owner JWT to the agent.",
          requires: "Valid JWT with consumer_available_balance > 0",
          outputs: [
            { key: "credential.token", desc: "Agent token (snk_agent_...) — Bearer token for all /agent/* calls" },
            { key: "credential.credential_id", desc: "Credential ID — use to revoke this token later" },
          ],
          next: "Pass token to agent runtime. Agent calls GET /services/discover then POST /agent/invoke with costUsdc",
        },
        errors: [
          { status: 402, code: "INSUFFICIENT_BALANCE", message: "Owner has no spendable balance — deposit USDC first" },
          { status: 422, code: "LIMIT_EXCEEDED", message: "credit_limit exceeds owner spending policy" },
        ],
      },
      {
        id: "get-credentials",
        method: "GET",
        path: "/api/v1/agent/credentials",
        summary: "List all credentials",
        description: "Returns all active agent credentials issued by the authenticated owner.",
        auth: "jwt",
        responseExample: [{ credential_id: "cred_abc", name: "consumer-agent-01", status: "active", calls_used: 3 }],
        agentMeta: {
          role: "owner",
          phase: "manage",
          note: "Audit which agent tokens are active and how many calls each has consumed. Identify credentials approaching limits.",
          requires: "Valid JWT",
        },
      },
      {
        id: "delete-credential",
        method: "DELETE",
        path: "/api/v1/agent/credentials/:id",
        summary: "Revoke credential",
        description: "Immediately invalidates an agent credential. Any subsequent call using this token is rejected.",
        auth: "jwt",
        params: [{ name: "id", in: "path", required: true, type: "string", description: "Credential ID", example: "cred_abc" }],
        responseExample: { message: "Credential revoked" },
        agentMeta: {
          role: "owner",
          phase: "manage",
          note: "Emergency shutoff: revoke a compromised or over-limit agent token immediately. Takes effect server-side instantly.",
          requires: "Valid JWT (owner who issued the credential)",
        },
        errors: [
          { status: 404, code: "CREDENTIAL_NOT_FOUND", message: "No credential with this ID" },
          { status: 403, code: "NOT_OWNER", message: "Only the issuing owner can revoke this credential" },
        ],
      },
    ],
  },
];

export const ALL_ROUTES: (RouteEndpoint & {
  groupId: string;
  groupTitle: string;
  groupDescription: string;
})[] = ROUTE_GROUPS.flatMap((g) =>
  g.routes.map((r) => ({
    ...r,
    groupId: g.id,
    groupTitle: g.title,
    groupDescription: g.description,
  })),
);

// ─── cURL builder ─────────────────────────────────────────────────────────────

export function buildCurl(
  route: RouteEndpoint,
  gatewayUrl: string,
  token: string,
  paramValues: Record<string, string>,
  bodyText: string,
): string {
  let url = `${gatewayUrl}${route.path}`;
  (route.params ?? []).filter((p) => p.in === "path").forEach((p) => {
    url = url.replace(`:${p.name}`, paramValues[p.name] ?? `:${p.name}`);
  });
  const qs = (route.params ?? [])
    .filter((p) => p.in === "query" && paramValues[p.name])
    .map((p) => `${p.name}=${encodeURIComponent(paramValues[p.name])}`)
    .join("&");
  if (qs) url += `?${qs}`;

  const displayToken = token.length > 20 ? token.slice(0, 16) + "…" : token;
  const hasBody = ["POST", "PUT", "PATCH"].includes(route.method) && bodyText.trim();
  const lines = [
    `curl -X ${route.method} \\`,
    `  '${url}'`,
    ...(token ? [`  -H 'Authorization: Bearer ${displayToken}'`] : []),
    ...(route.idempotency ? [`  -H 'X-Idempotency-Key: idem-${Date.now()}'`] : []),
    ...(hasBody ? [`  -H 'Content-Type: application/json'`, `  -d '${bodyText.trim()}'`] : []),
  ];
  return lines.join(" \\\n");
}
