"use client";

import React, { useState, useCallback, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Send,
  Copy,
  Check,
  Settings2,
  ArrowRight,
} from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useActiveSection } from "../use-active-section";
import { StatusBadge } from "../components/StatusBadge";
import { useDocsPageNav } from "../use-docs-page-nav";

const PAGE_SECTIONS = [
  "api-auth",
  "api-balance",
  "api-services",
  "api-invocations",
  "api-credentials",
];

const GATEWAY_BASE_URL = process.env.NEXT_PUBLIC_GATEWAY_BASE_URL ?? "http://127.0.0.1:8000";

const METHOD_COLOR: Record<string, string> = {
  GET: "text-[#7ff7be] bg-[#7ff7be]/10 border-[#7ff7be]/20",
  POST: "text-[#6eb6f6] bg-[#6eb6f6]/10 border-[#6eb6f6]/20",
  PUT: "text-[#f9c74f] bg-[#f9c74f]/10 border-[#f9c74f]/20",
  DELETE: "text-red-400 bg-red-400/10 border-red-400/20",
};

const ROLE_BADGE: Record<string, { label: string; cls: string }> = {
  owner: { label: "Owner", cls: "text-[#f9c74f] bg-[#f9c74f]/10 border-[#f9c74f]/30" },
  consumer_agent: { label: "Consumer Agent", cls: "text-[#6eb6f6] bg-[#6eb6f6]/10 border-[#6eb6f6]/30" },
  provider: { label: "Provider", cls: "text-[#c084fc] bg-[#c084fc]/10 border-[#c084fc]/30" },
  public: { label: "Public", cls: "text-[#71767b] bg-[#71767b]/10 border-[#71767b]/20" },
};

const PHASE_BADGE: Record<string, string> = {
  auth: "text-[#7ff7be] bg-[#7ff7be]/8 border-[#7ff7be]/20",
  deposit: "text-[#f9c74f] bg-[#f9c74f]/8 border-[#f9c74f]/20",
  register: "text-[#c084fc] bg-[#c084fc]/8 border-[#c084fc]/20",
  discover: "text-[#6eb6f6] bg-[#6eb6f6]/8 border-[#6eb6f6]/20",
  invoke: "text-green-400 bg-green-400/8 border-green-400/20",
  manage: "text-[#71767b] bg-[#71767b]/8 border-[#71767b]/20",
};

interface RouteParam {
  name: string;
  in: "path" | "query" | "body" | "header";
  required: boolean;
  type: string;
  description: string;
  example?: string;
  enum?: string[];
}

interface AgentOutput {
  key: string;
  desc: string;
}

interface AgentMeta {
  role: "owner" | "consumer_agent" | "provider" | "public";
  phase: "auth" | "deposit" | "register" | "discover" | "invoke" | "manage";
  note: string;
  outputs?: AgentOutput[];
  requires?: string;
  next?: string;
}

interface ErrorCode {
  status: number;
  code: string;
  message: string;
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
  agentMeta: AgentMeta;
  errors?: ErrorCode[];
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

// ─── cURL builder ─────────────────────────────────────────────────────────────

function buildCurl(
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

// ─── Get Token Guide ──────────────────────────────────────────────────────────

function GetTokenGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] text-[#6eb6f6] hover:opacity-80 transition-opacity"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        如何获取 Bearer Token？
      </button>
      {open && (
        <div className="rounded-xl border border-white/[0.06] bg-[#070809] p-4 space-y-4 text-[11px]">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a] mb-2">
              Owner JWT — 3 步获取
            </div>
            <div className="space-y-2.5">
              {[
                { n: 1, code: "GET /api/v1/auth/challenge?address=<wallet>", desc: "返回一次性 nonce 字符串" },
                { n: 2, code: "用钱包私钥对 nonce 进行 EIP-191 签名", desc: "MetaMask / ethers.js / Python eth-account 均可" },
                { n: 3, code: "POST /api/v1/auth/verify → 获得 access_token", desc: "将 token 粘贴到上方 Bearer Token 输入框" },
              ].map((s) => (
                <div key={s.n} className="flex gap-3 items-start">
                  <span className="text-[10px] font-mono text-[#4e535a] w-4 shrink-0 mt-0.5">{s.n}.</span>
                  <div className="space-y-0.5">
                    <code className="text-[#7ff7be] font-mono text-[10px] leading-5">{s.code}</code>
                    <p className="text-[#4e535a] leading-5">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-white/[0.04] pt-3 space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">
              Agent Credential token (snk_agent_...)
            </div>
            <p className="text-[#4e535a] leading-5">
              获得 JWT 后，调用{" "}
              <code className="text-[#c0c5cc] font-mono text-[10px]">POST /agent/credentials</code>{" "}
              签发 Agent token。Agent 用该 token（而非 JWT）调用{" "}
              <code className="text-[#c0c5cc] font-mono text-[10px]">/agent/invoke</code>。Owner JWT 不应暴露给 Agent 运行时。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Role Tabs ────────────────────────────────────────────────────────────────

function roleBtnCls(active: boolean, role: "consumer" | "provider"): string {
  if (!active) return "text-[#4e535a] hover:text-[#71767b]";
  if (role === "consumer") return "bg-[#6eb6f6]/15 text-[#6eb6f6] border border-[#6eb6f6]/20";
  return "bg-[#c084fc]/15 text-[#c084fc] border border-[#c084fc]/20";
}

function RoleTabs({ active, onChange }: Readonly<{ active: "consumer" | "provider"; onChange: (r: "consumer" | "provider") => void }>) {
  return (
    <div className="flex gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1 w-fit">
      {(["consumer", "provider"] as const).map((role) => (
        <button
          key={role}
          onClick={() => onChange(role)}
          className={`rounded-lg px-4 py-1.5 text-[12px] font-semibold transition-all ${roleBtnCls(active === role, role)}`}
        >
          {role === "consumer" ? "Consumer 买家" : "Provider 卖家"}
        </button>
      ))}
    </div>
  );
}

// ─── Role Filter ──────────────────────────────────────────────────────────────

function getGroupsForRole(groups: RouteGroup[], role: "consumer" | "provider"): RouteGroup[] {
  if (role === "consumer") {
    return groups
      .map((g) => {
        if (g.id === "api-services") {
          return {
            ...g,
            description: "Discover available API services for agent invocation.",
            routes: g.routes.filter((r) => r.id === "get-discover"),
          };
        }
        return g;
      })
      .filter((g) => g.routes.length > 0);
  }
  // provider: auth + balance + services (excluding discover)
  return groups
    .filter((g) => ["api-auth", "api-balance", "api-services"].includes(g.id))
    .map((g) => {
      if (g.id === "api-services") {
        return { ...g, routes: g.routes.filter((r) => r.id !== "get-discover") };
      }
      return g;
    });
}

// ─── Agent Quickstart ─────────────────────────────────────────────────────────

const FLOW_STEPS = [
  { n: 1, label: "GET /challenge", phase: "auth", hint: "owner" },
  { n: 2, label: "POST /verify", phase: "auth", hint: "→ JWT" },
  { n: 3, label: "POST /credentials", phase: "manage", hint: "→ token" },
  { n: 4, label: "GET /discover", phase: "discover", hint: "→ serviceId" },
  { n: 5, label: "POST /api/v1/agent/invoke", phase: "invoke", hint: "→ result" },
];

const FLOW_CLR: Record<string, string> = {
  auth: "border-[#7ff7be]/30 text-[#7ff7be] bg-[#7ff7be]/6",
  manage: "border-[#f9c74f]/30 text-[#f9c74f] bg-[#f9c74f]/6",
  discover: "border-[#6eb6f6]/30 text-[#6eb6f6] bg-[#6eb6f6]/6",
  invoke: "border-green-400/30 text-green-400 bg-green-400/6",
};

function AgentQuickstart() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[#6eb6f6]">Agent Quickstart</span>
          <span className="text-[12px] text-[#71767b]">Complete M2M flow — 5 API calls</span>
        </div>
        {open ? <ChevronDown size={14} className="text-[#4e535a] shrink-0" /> : <ChevronRight size={14} className="text-[#4e535a] shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-white/[0.04] px-5 pb-6">
          <div className="mt-4 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">Phase 1 — Owner (JWT)</div>
          <div className="flex flex-wrap items-center gap-2 mb-5">
            {FLOW_STEPS.slice(0, 3).map((s, i, arr) => (
              <React.Fragment key={s.n}>
                <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-mono ${FLOW_CLR[s.phase]}`}>
                  <span className="text-[9px] opacity-50">#{s.n}</span>
                  <span className="font-medium">{s.label}</span>
                  {s.hint && <span className="opacity-60 text-[10px]">{s.hint}</span>}
                </div>
                {i < arr.length - 1 && <ArrowRight size={11} className="text-[#3a3f46] shrink-0" />}
              </React.Fragment>
            ))}
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 bg-white/[0.04]" />
            <span className="text-[10px] text-[#3a3f46]">↓ pass token to agent runtime</span>
            <div className="h-px flex-1 bg-white/[0.04]" />
          </div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">Phase 2 — Agent Runtime (Credential token)</div>
          <div className="flex flex-wrap items-center gap-2">
            {FLOW_STEPS.slice(3).map((s, i, arr) => (
              <React.Fragment key={s.n}>
                <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-mono ${FLOW_CLR[s.phase]}`}>
                  <span className="text-[9px] opacity-50">#{s.n}</span>
                  <span className="font-medium">{s.label}</span>
                  {s.hint && <span className="opacity-60 text-[10px]">{s.hint}</span>}
                </div>
                {i < arr.length - 1 && <ArrowRight size={11} className="text-[#3a3f46] shrink-0" />}
              </React.Fragment>
            ))}
          </div>
          <p className="mt-5 text-[11px] text-[#4e535a] leading-5">
            The owner controls spend via{" "}
            <code className="text-[#c0c5cc] bg-white/[0.04] px-1 rounded text-[10px]">max_calls</code>{" "}
            and{" "}
            <code className="text-[#c0c5cc] bg-white/[0.04] px-1 rounded text-[10px]">credit_limit</code>{" "}
            on the credential. The agent runtime never sees the owner JWT.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Agent Meta Box ───────────────────────────────────────────────────────────

function AgentMetaBox({ meta }: Readonly<{ meta: AgentMeta }>) {
  const role = ROLE_BADGE[meta.role] ?? ROLE_BADGE.public;
  const phaseCls = PHASE_BADGE[meta.phase] ?? "text-[#71767b] bg-[#71767b]/8 border-[#71767b]/20";
  return (
    <div className="rounded-xl border border-[#6eb6f6]/14 bg-[#6eb6f6]/[0.03] px-4 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">Agent Context</span>
        <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold ${role.cls}`}>{role.label}</span>
        <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold capitalize ${phaseCls}`}>{meta.phase}</span>
      </div>
      <p className="text-[12px] leading-[1.65] text-[#8b98a5]">{meta.note}</p>
      {meta.requires && (
        <div className="flex gap-2 items-start">
          <span className="text-[10px] font-semibold text-[#4e535a] shrink-0 mt-0.5 uppercase tracking-wider">Requires</span>
          <span className="text-[11px] text-[#71767b] leading-5">{meta.requires}</span>
        </div>
      )}
      {meta.outputs && meta.outputs.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#4e535a]">Produces</div>
          {meta.outputs.map((o) => (
            <div key={o.key} className="flex gap-2 items-start">
              <code className="text-[11px] font-mono text-[#7ff7be] bg-[#7ff7be]/8 px-1.5 py-0.5 rounded shrink-0">{o.key}</code>
              <span className="text-[11px] text-[#71767b] leading-5">{o.desc}</span>
            </div>
          ))}
        </div>
      )}
      {meta.next && (
        <div className="flex gap-2 items-start">
          <ArrowRight size={11} className="text-[#6eb6f6] shrink-0 mt-0.5" />
          <span className="text-[11px] text-[#6eb6f6] leading-5">{meta.next}</span>
        </div>
      )}
    </div>
  );
}

// ─── Parameter Row ────────────────────────────────────────────────────────────

const PARAM_LOC_CLR: Record<string, string> = {
  path: "text-[#c084fc] border-[#c084fc]/30 bg-[#c084fc]/8",
  query: "text-[#6eb6f6] border-[#6eb6f6]/30 bg-[#6eb6f6]/8",
  body: "text-[#f9c74f] border-[#f9c74f]/30 bg-[#f9c74f]/8",
  header: "text-[#7ff7be] border-[#7ff7be]/30 bg-[#7ff7be]/8",
};

function ParamRow({ param, value, onChange }: Readonly<{ param: RouteParam; value: string; onChange: (v: string) => void }>) {
  const locCls = PARAM_LOC_CLR[param.in] ?? "text-[#71767b] border-[#71767b]/20 bg-[#71767b]/8";
  return (
    <div className="border-b border-white/[0.04] py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <code className="text-[12px] font-mono font-semibold text-[#c0c5cc]">{param.name}</code>
        <span className="text-[10px] text-[#4e535a] font-mono">{param.type}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${locCls}`}>{param.in}</span>
        {param.required && (
          <span className="rounded border border-red-400/30 bg-red-400/8 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-400">required</span>
        )}
      </div>
      <p className="text-[11px] text-[#71767b] leading-5 mb-2">{param.description}</p>
      {param.enum && param.enum.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {param.enum.map((v) => (
            <code key={v} className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-[#9aa4af] font-mono">{v}</code>
          ))}
        </div>
      )}
      <input
        className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[12px] text-[#c0c5cc] placeholder:text-[#4e535a] focus:border-white/20 focus:outline-none transition-colors"
        placeholder={param.example ?? param.name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// ─── Error Codes ──────────────────────────────────────────────────────────────

function statusBadgeCls(status: number): string {
  if (status >= 500) return "bg-red-400/10 text-red-400";
  if (status >= 400) return "bg-[#f9c74f]/10 text-[#f9c74f]";
  return "bg-[#7ff7be]/10 text-[#7ff7be]";
}

function ErrorCodesTable({ errors }: Readonly<{ errors: ErrorCode[] }>) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">Error Codes</div>
      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        {errors.map((e, i) => (
          <div key={e.code} className={`flex items-start gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-white/[0.04]" : ""}`}>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold ${statusBadgeCls(e.status)}`}>{e.status}</span>
            <code className="text-[11px] font-mono text-[#c0c5cc] shrink-0">{e.code}</code>
            <span className="text-[11px] text-[#71767b] leading-5">{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Try It Panel ─────────────────────────────────────────────────────────────

function TryItPanel({ route, gatewayUrl, token }: Readonly<{ route: RouteEndpoint; gatewayUrl: string; token: string }>) {
  const [paramValues, setParamValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    (route.params ?? []).forEach((p) => { if (p.example) init[p.name] = p.example; });
    return init;
  });
  const [bodyText, setBodyText] = useState(route.bodyExample ? JSON.stringify(route.bodyExample, null, 2) : "");
  const [response, setResponse] = useState<{ status: number; body: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const curl = useMemo(() => buildCurl(route, gatewayUrl, token, paramValues, bodyText), [route, gatewayUrl, token, paramValues, bodyText]);

  const handleSend = useCallback(async () => {
    setLoading(true);
    setResponse(null);
    try {
      let url = `${gatewayUrl}${route.path}`;
      (route.params ?? []).filter((p) => p.in === "path").forEach((p) => { url = url.replace(`:${p.name}`, paramValues[p.name] ?? `:${p.name}`); });
      const qs = (route.params ?? []).filter((p) => p.in === "query" && paramValues[p.name]).map((p) => `${p.name}=${encodeURIComponent(paramValues[p.name])}`).join("&");
      if (qs) url += `?${qs}`;
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (route.idempotency) headers["X-Idempotency-Key"] = `idem-${Date.now()}`;
      if (["POST", "PUT", "PATCH"].includes(route.method) && bodyText.trim()) headers["Content-Type"] = "application/json";
      const res = await fetch(url, { method: route.method, headers, body: ["POST", "PUT", "PATCH"].includes(route.method) && bodyText.trim() ? bodyText : undefined });
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      setResponse({ status: res.status, body: pretty });
    } catch (e: unknown) {
      setResponse({ status: 0, body: String(e) });
    } finally { setLoading(false); }
  }, [route, gatewayUrl, token, paramValues, bodyText]);

  const handleCopy = useCallback(() => { navigator.clipboard.writeText(curl); setCopied(true); setTimeout(() => setCopied(false), 2000); }, [curl]);

  const pathParams = (route.params ?? []).filter((p) => p.in === "path");
  const queryParams = (route.params ?? []).filter((p) => p.in === "query");

  return (
    <div className="mt-0 grid grid-cols-1 rounded-b-2xl border border-t-0 border-white/[0.06] xl:grid-cols-[1fr_1fr]">
      {/* Left: agent meta + params + body */}
      <div className="space-y-5 border-b border-white/[0.04] bg-[#070809] p-5 xl:border-b-0 xl:border-r xl:border-white/[0.04]">
        <AgentMetaBox meta={route.agentMeta} />

        {pathParams.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">Path Parameters</div>
            <div className="rounded-xl border border-white/[0.06] px-4">
              {pathParams.map((p) => <ParamRow key={p.name} param={p} value={paramValues[p.name] ?? ""} onChange={(v) => setParamValues((prev) => ({ ...prev, [p.name]: v }))} />)}
            </div>
          </div>
        )}

        {queryParams.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">Query Parameters</div>
            <div className="rounded-xl border border-white/[0.06] px-4">
              {queryParams.map((p) => <ParamRow key={p.name} param={p} value={paramValues[p.name] ?? ""} onChange={(v) => setParamValues((prev) => ({ ...prev, [p.name]: v }))} />)}
            </div>
          </div>
        )}

        {route.bodyExample && (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">Request Body</div>
            <textarea className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 font-mono text-[12px] text-[#c0c5cc] focus:border-white/20 focus:outline-none resize-none" rows={Math.min(14, bodyText.split("\n").length + 1)} value={bodyText} onChange={(e) => setBodyText(e.target.value)} spellCheck={false} />
          </div>
        )}

        {route.auth !== "none" && (
          <div className="flex items-center gap-2 text-[11px] text-[#4e535a]">
            <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px]">{route.auth === "credential" ? "CRED" : "JWT"}</span>
            <span>{route.auth === "credential" ? "Requires Agent Credential token (snk_agent_...)" : "Requires owner JWT — configure above"}</span>
          </div>
        )}

        <button onClick={handleSend} disabled={loading} className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-[13px] font-semibold text-[#0f1419] transition-all hover:bg-[#e7e9ea] active:scale-[0.98] disabled:opacity-50">
          <Send size={14} />{loading ? "Sending…" : "Send Request"}
        </button>

        {route.errors && route.errors.length > 0 && <ErrorCodesTable errors={route.errors} />}
      </div>

      {/* Right: cURL + response */}
      <div className="space-y-4 bg-[#040506] p-5 rounded-b-2xl xl:rounded-none xl:rounded-br-2xl">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">cURL</div>
            <button onClick={handleCopy} className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] px-2.5 py-1 text-[11px] text-[#71767b] transition-colors hover:border-white/[0.1] hover:text-[#c0c5cc]">
              {copied ? <Check size={11} /> : <Copy size={11} />}{copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-xl border border-white/[0.05] bg-[#020304] p-4 text-[11px] leading-6 text-[#9aa4af] min-h-[80px]"><code>{curl}</code></pre>
        </div>

        {response && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">Response</div>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold ${response.status >= 200 && response.status < 300 ? "bg-[#7ff7be]/10 text-[#7ff7be]" : "bg-red-400/10 text-red-400"}`}>{response.status || "Error"}</span>
            </div>
            <pre className="max-h-80 overflow-auto rounded-xl border border-white/[0.05] bg-[#020304] p-4 text-[11px] leading-6 text-[#9aa4af]"><code>{response.body}</code></pre>
          </div>
        )}

        {!response && route.responseExample && (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">Example Response</div>
            <pre className="overflow-x-auto rounded-xl border border-white/[0.05] bg-[#020304] p-4 text-[11px] leading-6 text-[#9aa4af] opacity-55"><code>{JSON.stringify(route.responseExample, null, 2)}</code></pre>
          </div>
        )}

        {route.idempotency && (
          <div className="rounded-xl border border-[#f9c74f]/14 bg-[#f9c74f]/[0.03] px-3 py-2.5 text-[11px] text-[#f9c74f] leading-5">
            <span className="font-semibold">Idempotent.</span> Pass{" "}
            <code className="font-mono bg-[#f9c74f]/10 px-1 rounded text-[10px]">X-Idempotency-Key</code>{" "}
            to safely retry without duplicate charges.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Endpoint Row ─────────────────────────────────────────────────────────────

function EndpointRow({ route, gatewayUrl, token, expanded, onToggle }: Readonly<{ route: RouteEndpoint; gatewayUrl: string; token: string; expanded: boolean; onToggle: () => void }>) {
  return (
    <div id={`endpoint-${route.id}`}>
      <button
        onClick={onToggle}
        className="group w-full rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-left transition-all hover:border-white/[0.1] hover:bg-white/[0.03] data-[exp=true]:rounded-b-none data-[exp=true]:border-b-transparent"
        data-exp={expanded}
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown size={13} className="text-[#4e535a] shrink-0" /> : <ChevronRight size={13} className="text-[#4e535a] shrink-0" />}
          <span className={`inline-block w-[52px] text-center text-[10px] font-semibold tracking-wider border rounded px-1 py-0.5 font-mono shrink-0 ${METHOD_COLOR[route.method] ?? ""}`}>{route.method}</span>
          <code className="text-[12px] font-mono text-[#c0c5cc] truncate">{route.path}</code>
          <span className="hidden text-[12px] text-[#71767b] md:block truncate">{route.summary}</span>
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {route.auth !== "none" && (
              <span className="text-[9px] text-[#4e535a] border border-white/[0.08] px-1.5 py-0.5 rounded font-mono">{route.auth === "credential" ? "CRED" : "JWT"}</span>
            )}
            <span className={`hidden sm:inline-flex rounded border px-1.5 py-0.5 text-[9px] font-semibold ${ROLE_BADGE[route.agentMeta.role]?.cls ?? ""}`}>
              {ROLE_BADGE[route.agentMeta.role]?.label}
            </span>
          </div>
        </div>
        {!expanded && <p className="mt-1.5 pl-[88px] text-[11px] text-[#71767b] leading-5 md:hidden">{route.summary}</p>}
      </button>

      {expanded && (
        <>
          <div className="border border-t-0 border-b-0 border-white/[0.06] bg-[#070809] px-5 py-4">
            <p className="text-[13px] leading-[1.75] text-[#8b98a5]">{route.description}</p>
          </div>
          <TryItPanel route={route} gatewayUrl={gatewayUrl} token={token} />
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ApiReferencePage() {
  const { t, tList } = useLanguage();
  useActiveSection(PAGE_SECTIONS, "api-auth");

  const groupTitles = tList("docsPage.apiGroupTitles");
  const groupDescriptions = tList("docsPage.apiGroupDescriptions");
  const groups = ROUTE_GROUPS.map((g, i) => ({ ...g, title: groupTitles[i] ?? g.title, description: groupDescriptions[i] ?? g.description }));

  useDocsPageNav(groups.map((g) => ({ id: g.id, label: g.title })));

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [viewRole, setViewRole] = useState<"consumer" | "provider">("consumer");

  const toggle = useCallback((id: string) => { setExpandedId((cur) => (cur === id ? null : id)); }, []);

  return (
    <div className="space-y-12">
      {/* Header */}
      <div className="space-y-4 border-b border-white/[0.06] pb-8">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">{t("docsPage.apiEyebrow")}</span>
          <StatusBadge status="GA" />
        </div>
        <h1 className="x-page-title text-white">{t("docsPage.apiTitle")}</h1>
        <p className="x-body-copy max-w-[560px]">
          {t("docsPage.apiDescription")}{" "}
          <code className="text-[#7ff7be] font-mono text-[13px] bg-[#7ff7be]/8 px-1.5 py-0.5 rounded">/api</code>{" "}
          <code className="text-[#c0c5cc] font-mono text-[13px] ml-1">https://gateway.synapse.network</code>
        </p>
        {/* Method legend */}
        <div className="flex flex-wrap gap-4 pt-1">
          {(["GET", "POST", "PUT", "DELETE"] as const).map((m) => (
            <div key={m} className="flex items-center gap-2">
              <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border font-mono ${METHOD_COLOR[m]}`}>{m}</span>
              <span className="text-[12px] text-[#71767b]">{{ GET: t("docsPage.apiLegendRead"), POST: t("docsPage.apiLegendCreate"), PUT: t("docsPage.apiLegendUpdate"), DELETE: t("docsPage.apiLegendDelete") }[m]}</span>
            </div>
          ))}
        </div>
        {/* Role legend */}
        <div className="flex flex-wrap gap-3">
          {(Object.entries(ROLE_BADGE) as [string, { label: string; cls: string }][]).map(([key, val]) => (
            <span key={key} className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${val.cls}`}>{val.label}</span>
          ))}
          <span className="text-[11px] text-[#4e535a] self-center">— identity that calls the endpoint</span>
        </div>
      </div>

      {/* Agent Quickstart */}
      <AgentQuickstart />

      {/* Config Bar */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-[12px] font-semibold text-[#c0c5cc]">Try It</div>
            <span className="text-[11px] text-[#4e535a]">— configure bearer token</span>
          </div>
          <button onClick={() => setShowConfig((v) => !v)} className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] px-2.5 py-1.5 text-[11px] text-[#71767b] transition-colors hover:border-white/[0.1] hover:text-[#c0c5cc]">
            <Settings2 size={12} />{showConfig ? "Collapse" : "Configure"}
          </button>
        </div>
        {showConfig && (
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="cfg-tok" className="text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">Bearer Token</label>
              <input id="cfg-tok" className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[12px] text-[#c0c5cc] placeholder:text-[#4e535a] focus:border-white/20 focus:outline-none" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste JWT or snk_agent_... here" type="password" />
              <p className="text-[11px] text-[#4e535a]"><span className="font-mono text-[#c0c5cc]">JWT</span> for owner endpoints · <span className="font-mono text-[#c0c5cc]">CRED</span> for agent invocation endpoints</p>
            </div>
            <GetTokenGuide />
          </div>
        )}
      </div>

      {/* Role Tabs */}
      <div className="space-y-2">
        <p className="text-[11px] text-[#4e535a]">按角色查看相关端点：</p>
        <RoleTabs active={viewRole} onChange={(r) => { setViewRole(r); setExpandedId(null); }} />
      </div>

      {/* Route Groups */}
      {getGroupsForRole(groups, viewRole).map((group) => (
        <section key={group.id} id={group.id} className="space-y-3">
          <div className="space-y-1">
            <h2 className="x-section-title text-white">{group.title}</h2>
            <p className="text-[13px] text-[#71767b]">{group.description}</p>
          </div>
          <div className="space-y-1">
            {group.routes.map((route) => (
              <EndpointRow key={route.id} route={route} gatewayUrl={GATEWAY_BASE_URL} token={token} expanded={expandedId === route.id} onToggle={() => toggle(route.id)} />
            ))}
          </div>
        </section>
      ))}

      {/* Machine-readable spec */}
      <section className="rounded-2xl border border-white/[0.04]">
        <details>
          <summary className="cursor-pointer select-none px-5 py-4 text-[12px] text-[#4e535a] hover:text-[#71767b] transition-colors list-none flex items-center justify-between">
            <span>📡 Machine-Readable OpenAPI Spec <span className="ml-2 text-[10px] opacity-60">(for agents and LLMs)</span></span>
            <span className="text-[10px]">▸</span>
          </summary>
          <div className="border-t border-white/[0.04] p-5">
            <pre className="overflow-auto rounded-xl border border-white/[0.05] bg-[#020304] p-4 text-[10px] leading-5 text-[#71767b] max-h-96 font-mono" id="api-machine-spec">
              <code>
                {JSON.stringify({
                  openapi: "3.0.0",
                  info: { title: "Synapse Gateway API", version: "1.0.0", description: "AI-native payment gateway for Machine-to-Machine API invocations. Base URL: https://gateway.synapse.network/api" },
                  "x-agent-workflow": FLOW_STEPS.map((s) => ({ step: s.n, path: s.label, phase: s.phase, hint: s.hint })),
                  paths: Object.fromEntries(
                    ROUTE_GROUPS.flatMap((g) =>
                      g.routes.map((r) => [
                        r.path,
                        {
                          [r.method.toLowerCase()]: {
                            summary: r.summary,
                            description: r.description,
                            tags: [g.title],
                            security: r.auth === "none" ? [] : [{ BearerAuth: [] }],
                            "x-agent-meta": r.agentMeta,
                            parameters: (r.params ?? []).filter((p) => p.in !== "body").map((p) => ({ name: p.name, in: p.in, required: p.required, schema: { type: p.type }, description: p.description, example: p.example })),
                            requestBody: r.bodyExample ? { content: { "application/json": { example: r.bodyExample } } } : undefined,
                            responses: {
                              "200": { description: "Success", content: { "application/json": { example: r.responseExample } } },
                              ...(r.errors ? Object.fromEntries(r.errors.map((e) => [String(e.status), { description: `${e.code}: ${e.message}` }])) : {}),
                            },
                          },
                        },
                      ]),
                    ),
                  ),
                }, null, 2)}
              </code>
            </pre>
          </div>
        </details>
      </section>

      {/* Auth note */}
      <div className="x-panel-muted rounded-xl p-5 flex gap-3">
        <span className="text-[#7ff7be] mt-0.5 shrink-0">🔐</span>
        <div className="space-y-1">
          <p className="text-[13px] font-semibold text-[#c0c5cc]">{t("docsPage.apiAuthNoteTitle")}</p>
          <p className="text-[13px] text-[#71767b] leading-relaxed">{t("docsPage.apiAuthNoteDescription")}</p>
        </div>
      </div>
    </div>
  );
}
