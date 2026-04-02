/**
 * SynapseClient — Consumer API client.
 *
 * Uses an agent credential (X-Credential header) for service discovery,
 * quoting, and invocation. Get a credential via SynapseAuth.issueCredential().
 */
import { v4 as uuidv4 } from "uuid";
import {
  SynapseClientOptions,
  ServiceRecord,
  DiscoverOptions,
  QuoteOptions,
  QuoteResult,
  InvokeOptions,
  InvocationResult,
  InvocationStatus,
  TERMINAL_STATUSES,
} from "./types";
import {
  AuthenticationError,
  InsufficientFundsError,
  QuoteError,
  InvokeError,
  DiscoveryError,
  TimeoutError,
} from "./errors";

export class SynapseClient {
  private readonly credential: string;
  private readonly gatewayUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: SynapseClientOptions) {
    if (!opts.credential?.trim()) {
      throw new Error("credential is required. Get one via SynapseAuth.issueCredential().");
    }
    this.credential = opts.credential.trim();
    this.gatewayUrl = (opts.gatewayUrl ?? "http://127.0.0.1:8000").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  // ── Service Discovery ──────────────────────────────────────────────────────

  /** Discover registered services on the platform. */
  async discover(opts: DiscoverOptions = {}): Promise<ServiceRecord[]> {
    const params = new URLSearchParams();
    if (opts.limit != null) params.set("limit", String(opts.limit));
    if (opts.offset != null) params.set("offset", String(opts.offset));
    if (opts.tags?.length) params.set("tags", opts.tags.join(","));

    const qs = params.toString();
    const url = `${this.gatewayUrl}/api/v1/services/discover${qs ? `?${qs}` : ""}`;

    try {
      const resp = await this._fetch<{ services?: ServiceRecord[]; items?: ServiceRecord[] }>(url);
      return resp.services ?? resp.items ?? (Array.isArray(resp) ? resp : []);
    } catch (err) {
      throw new DiscoveryError(String(err instanceof Error ? err.message : err));
    }
  }

  /** Search for services by text query. */
  async search(query: string, opts: DiscoverOptions = {}): Promise<ServiceRecord[]> {
    try {
      const resp = await this._fetch<{ services?: ServiceRecord[]; results?: ServiceRecord[] }>(
        `${this.gatewayUrl}/api/v1/agent/discovery/search`,
        {
          method: "POST",
          body: JSON.stringify({
            query,
            tags: opts.tags,
            limit: opts.limit ?? 20,
            offset: opts.offset ?? 0,
          }),
        }
      );
      return resp.services ?? resp.results ?? (Array.isArray(resp) ? resp : []);
    } catch (err) {
      throw new DiscoveryError(String(err instanceof Error ? err.message : err));
    }
  }

  // ── Quote ──────────────────────────────────────────────────────────────────

  /** Create a quote for a service (first step of invocation). */
  async quote(serviceId: string, opts: QuoteOptions = {}): Promise<QuoteResult> {
    const body: Record<string, unknown> = {
      serviceId,
      responseMode: opts.responseMode ?? "sync",
    };
    if (opts.inputPreview) {
      body["inputPreview"] = opts.inputPreview;
    }

    let resp: Record<string, unknown>;
    try {
      resp = await this._fetch<Record<string, unknown>>(
        `${this.gatewayUrl}/api/v1/agent/quotes`,
        { method: "POST", body: JSON.stringify(body) }
      );
    } catch (err) {
      throw new QuoteError(String(err instanceof Error ? err.message : err));
    }

    const quoteId =
      (resp["quoteId"] as string) ||
      (resp["id"] as string) ||
      (resp["quote_id"] as string);
    if (!quoteId) throw new QuoteError(`quoteId missing from quote response: ${JSON.stringify(resp)}`);

    return { quoteId, ...resp } as QuoteResult;
  }

  // ── Invocation ─────────────────────────────────────────────────────────────

  /**
   * Invoke a service by ID. Internally performs quote → invoke → optional poll.
   * This is the one-liner "just call it" API.
   */
  async invoke(
    serviceId: string,
    payload: Record<string, unknown> = {},
    opts: InvokeOptions = {}
  ): Promise<InvocationResult> {
    // 1. Quote
    const quoteResult = await this.quote(serviceId, { responseMode: opts.responseMode });

    // 2. Invoke
    const idempotencyKey = opts.idempotencyKey ?? uuidv4();
    return this.invokeByQuote(quoteResult.quoteId, payload, {
      ...opts,
      idempotencyKey,
    });
  }

  /**
   * Create an invocation from an existing quoteId.
   * Use `invoke()` instead unless you need manual quote control.
   */
  async invokeByQuote(
    quoteId: string,
    payload: Record<string, unknown> = {},
    opts: InvokeOptions = {}
  ): Promise<InvocationResult> {
    const idempotencyKey = opts.idempotencyKey ?? uuidv4();
    const requestHeaders: Record<string, string> = {};
    if (opts.requestId) requestHeaders["X-Request-Id"] = opts.requestId;

    let resp: Record<string, unknown>;
    try {
      resp = await this._fetch<Record<string, unknown>>(
        `${this.gatewayUrl}/api/v1/agent/invocations`,
        {
          method: "POST",
          extraHeaders: requestHeaders,
          body: JSON.stringify({
            quoteId,
            idempotencyKey,
            payload,
            responseMode: opts.responseMode ?? "sync",
          }),
        }
      );
    } catch (err) {
      throw new InvokeError(String(err instanceof Error ? err.message : err));
    }

    const result = this._parseInvocationResponse(resp);

    if (TERMINAL_STATUSES.has(result.status)) return result;
    if (opts.pollTimeoutMs === 0) return result;

    return this.waitForInvocation(result.invocationId, opts);
  }

  /** Poll invocation receipt until it reaches a terminal status. */
  async waitForInvocation(
    invocationId: string,
    opts: { pollTimeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<InvocationResult> {
    const timeoutMs = opts.pollTimeoutMs ?? 90_000;
    const intervalMs = opts.pollIntervalMs ?? 1_500;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const receipt = await this.getInvocation(invocationId);
      if (TERMINAL_STATUSES.has(receipt.status)) return receipt;
      await _sleep(intervalMs);
    }
    throw new TimeoutError(`Invocation ${invocationId} still pending after ${timeoutMs}ms`);
  }

  /** Fetch an invocation receipt by ID. */
  async getInvocation(invocationId: string): Promise<InvocationResult> {
    const resp = await this._fetch<Record<string, unknown>>(
      `${this.gatewayUrl}/api/v1/agent/invocations/${encodeURIComponent(invocationId)}`
    );
    return this._parseInvocationResponse(resp);
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private _parseInvocationResponse(resp: Record<string, unknown>): InvocationResult {
    const invocationId =
      (resp["invocationId"] as string) ||
      (resp["id"] as string) ||
      (resp["invocation_id"] as string) ||
      "";
    const status =
      ((resp["status"] as string) || "PENDING") as InvocationStatus;
    const chargedUsdc = Number(resp["chargedUsdc"] ?? resp["charged_usdc"] ?? 0);

    return {
      invocationId,
      status,
      chargedUsdc,
      result: resp["result"] ?? null,
      error: (resp["error"] as Record<string, unknown>) ?? null,
      receipt: (resp["receipt"] as Record<string, unknown>) ?? null,
      quoteId: (resp["quoteId"] as string) ?? undefined,
      ...resp,
    };
  }

  private async _fetch<T>(
    url: string,
    init: {
      method?: string;
      body?: string;
      extraHeaders?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Credential": this.credential,
      ...(init.extraHeaders ?? {}),
    };

    try {
      const resp = await fetch(url, {
        method: init.method ?? "GET",
        body: init.body,
        headers,
        signal: controller.signal,
      });
      const text = await resp.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      if (!resp.ok) {
        const d = data as Record<string, unknown>;
        const detail = d?.["detail"];
        const msg = typeof detail === "string" ? detail
          : typeof detail === "object" && detail !== null ? JSON.stringify(detail)
          : text;

        if (resp.status === 401) throw new AuthenticationError(`401: ${msg}`);
        if (resp.status === 402) throw new InsufficientFundsError(`402: ${msg}`);
        throw new Error(`HTTP ${resp.status}: ${msg}`);
      }
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

function _sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
