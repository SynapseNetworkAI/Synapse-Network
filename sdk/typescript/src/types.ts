// ── Auth ────────────────────────────────────────────────────────────────────

export interface SynapseAuthOptions {
  /** Gateway base URL. Default: http://127.0.0.1:8000 */
  gatewayUrl?: string;
  /** Timeout per request in milliseconds. Default: 30000 */
  timeoutMs?: number;
}

export interface ChallengeResponse {
  success: boolean;
  challenge: string;
  domain: string;
}

export interface TokenResponse {
  success: boolean;
  access_token: string;
  token_type: string;
  expires_in: number;
}

// ── Credentials ─────────────────────────────────────────────────────────────

export interface IssueCredentialOptions {
  name?: string;
  maxCalls?: number;
  /** Per-window USDC budget. Window size is controlled by resetInterval (default: "daily"). */
  creditLimit?: number;
  /** Budget reset cadence: "hourly" | "daily" | "weekly" | "monthly" | "never" */
  resetInterval?: "hourly" | "daily" | "weekly" | "monthly" | "never";
  rpm?: number;
  expiresInSec?: number;
}

export interface AgentCredential {
  id: string;
  credential_id: string;
  token: string;
  name?: string;
  maxCalls?: number;
  rpm?: number;
  creditLimit?: number;
  status: string;
  createdAt?: string | number;
}

export interface IssueCredentialResult {
  credential: AgentCredential;
  /** The agent token used as X-Credential header value */
  token: string;
}

// ── Balance ──────────────────────────────────────────────────────────────────

export interface BalanceSummary {
  ownerBalance: string | number;
  consumerAvailableBalance: string | number;
  providerReceivable: string | number;
  platformFeeAccrued: string | number;
  [key: string]: unknown;
}

// ── Deposit ──────────────────────────────────────────────────────────────────

export interface DepositIntentResult {
  status: string;
  tx_hash: string;
  intent: {
    id?: string;
    intentId?: string;
    depositIntentId?: string;
    eventKey?: string;
    event_key?: string;
    txHash?: string;
    [key: string]: unknown;
  };
}

// ── Services ─────────────────────────────────────────────────────────────────

export interface ServiceRecord {
  serviceId?: string;
  id?: string;
  agentToolName?: string;
  serviceName?: string;
  status?: string;
  pricing?: { amount?: string; currency?: string } | string;
  summary?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface DiscoverOptions {
  limit?: number;
  offset?: number;
  tags?: string[];
}

// ── Quote ────────────────────────────────────────────────────────────────────

export interface QuoteOptions {
  responseMode?: "sync" | "async" | "stream";
  inputPreview?: Record<string, unknown>;
}

export interface QuoteResult {
  quoteId: string;
  serviceId?: string;
  estimatedCostUsdc?: string | number;
  overallStatus?: string;
  [key: string]: unknown;
}

// ── Invocation ───────────────────────────────────────────────────────────────

export type InvocationStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUCCEEDED"
  | "SETTLED"
  | "FAILED_RETRYABLE"
  | "FAILED_FINAL";

export const TERMINAL_STATUSES = new Set<InvocationStatus>([
  "SUCCEEDED",
  "SETTLED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
]);

export interface InvokeOptions {
  idempotencyKey?: string;
  responseMode?: "sync" | "async" | "stream";
  requestId?: string;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface InvocationResult {
  invocationId: string;
  status: InvocationStatus;
  chargedUsdc: number;
  result?: unknown;
  error?: { message?: string; code?: string } | null;
  receipt?: Record<string, unknown> | null;
  quoteId?: string;
  [key: string]: unknown;
}

// ── Client constructor ────────────────────────────────────────────────────────

export interface SynapseClientOptions {
  /** Agent credential token (X-Credential header). Required. */
  credential: string;
  /** Gateway base URL. Default: http://127.0.0.1:8000 */
  gatewayUrl?: string;
  /** Timeout per request in ms. Default: 30000 */
  timeoutMs?: number;
}
