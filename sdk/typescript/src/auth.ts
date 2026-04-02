/**
 * SynapseAuth — Wallet-based authentication + credential management.
 *
 * Requires `ethers` (v6) as a peer dependency for EIP-191 signing.
 * Alternatively pass a custom `signer` function if you bring your own stack.
 */
import {
  SynapseAuthOptions,
  ChallengeResponse,
  TokenResponse,
  IssueCredentialOptions,
  IssueCredentialResult,
  AgentCredential,
  BalanceSummary,
  DepositIntentResult,
} from "./types";
import { AuthenticationError } from "./errors";

type SignerFn = (message: string) => Promise<string>;

export interface SynapseAuthConstructorOptions extends SynapseAuthOptions {
  /** EIP-191 signer function. Called with the challenge string, returns hex signature. */
  signer: SignerFn;
  /** Wallet address (lowercase hex). */
  walletAddress: string;
}

export class SynapseAuth {
  private readonly gatewayUrl: string;
  private readonly timeoutMs: number;
  private readonly signer: SignerFn;
  private readonly walletAddress: string;
  private _token: string | null = null;
  private _tokenExpiresAt: number = 0;

  constructor(opts: SynapseAuthConstructorOptions) {
    this.gatewayUrl = (opts.gatewayUrl ?? "http://127.0.0.1:8000").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.signer = opts.signer;
    this.walletAddress = opts.walletAddress.toLowerCase();
  }

  /**
   * Create a SynapseAuth instance from an ethers.js Wallet (v6 or v5).
   */
  static fromWallet(
    wallet: { signMessage: (msg: string) => Promise<string>; address: string },
    opts: SynapseAuthOptions = {}
  ): SynapseAuth {
    return new SynapseAuth({
      ...opts,
      signer: (msg) => wallet.signMessage(msg),
      walletAddress: wallet.address,
    });
  }

  /** Perform challenge → sign → verify and return a JWT. Caches for TTL. */
  async authenticate(): Promise<string> {
    const now = Date.now();
    if (this._token && now < this._tokenExpiresAt - 30_000) {
      return this._token;
    }

    const url = `${this.gatewayUrl}/api/v1/auth/challenge?address=${encodeURIComponent(this.walletAddress)}`;
    const challengeResp = await this._fetch<ChallengeResponse>(url, { method: "GET" });
    if (!challengeResp.success) {
      throw new AuthenticationError(`Challenge failed: ${JSON.stringify(challengeResp)}`);
    }

    const message = challengeResp.challenge;
    const signature = await this.signer(message);

    const tokenResp = await this._fetch<TokenResponse>(`${this.gatewayUrl}/api/v1/auth/verify`, {
      method: "POST",
      body: JSON.stringify({
        wallet_address: this.walletAddress,
        message,
        signature,
      }),
    });
    if (!tokenResp.success) {
      throw new AuthenticationError(`Auth verify failed: ${JSON.stringify(tokenResp)}`);
    }

    this._token = tokenResp.access_token;
    this._tokenExpiresAt = now + tokenResp.expires_in * 1_000;
    return this._token;
  }

  /** Returns the current JWT (auto-authenticates if needed). */
  async getToken(): Promise<string> {
    return this.authenticate();
  }

  /** Issue a new agent credential and return its token + metadata. */
  async issueCredential(opts: IssueCredentialOptions = {}): Promise<IssueCredentialResult> {
    const token = await this.getToken();
    const body: Record<string, unknown> = {};
    if (opts.name) body["name"] = opts.name;
    if (opts.maxCalls != null) body["maxCalls"] = opts.maxCalls;
    if (opts.creditLimit != null) body["creditLimit"] = opts.creditLimit;
    if (opts.resetInterval != null) body["resetInterval"] = opts.resetInterval;
    if (opts.rpm != null) body["rpm"] = opts.rpm;
    if (opts.expiresInSec != null) body["expiresInSec"] = opts.expiresInSec;

    const resp = await this._fetch<Record<string, unknown>>(
      `${this.gatewayUrl}/api/v1/credentials/agent/issue`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }
    );

    const credToken =
      (resp["token"] as string) ||
      ((resp["credential"] as Record<string, unknown>)?.["token"] as string) ||
      (resp["credential_token"] as string);
    const credId =
      (resp["credential_id"] as string) ||
      (resp["id"] as string) ||
      ((resp["credential"] as Record<string, unknown>)?.["id"] as string) ||
      ((resp["credential"] as Record<string, unknown>)?.["credential_id"] as string);

    if (!credToken) throw new AuthenticationError(`Credential token missing: ${JSON.stringify(resp)}`);
    if (!credId) throw new AuthenticationError(`Credential ID missing: ${JSON.stringify(resp)}`);

    const credential: AgentCredential = {
      id: credId,
      credential_id: credId,
      token: credToken,
      name: opts.name,
      status: "active",
      ...((resp["credential"] as Record<string, unknown>) ?? {}),
    };

    return { credential, token: credToken };
  }

  /** List all agent credentials for this wallet. */
  async listCredentials(): Promise<AgentCredential[]> {
    const token = await this.getToken();
    const resp = await this._fetch<{ credentials?: AgentCredential[] }>(
      `${this.gatewayUrl}/api/v1/credentials/agent/list`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return resp.credentials ?? [];
  }

  /** Get balance summary for this wallet. */
  async getBalance(): Promise<BalanceSummary> {
    const token = await this.getToken();
    const resp = await this._fetch<{ balance?: BalanceSummary }>(
      `${this.gatewayUrl}/api/v1/balance`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return resp.balance ?? ({} as BalanceSummary);
  }

  /**
   * Register a deposit intent with the gateway after an on-chain deposit tx.
   * Requires X-Idempotency-Key header (auto-generated if not provided).
   */
  async registerDepositIntent(
    txHash: string,
    amountUsdc: number,
    idempotencyKey?: string
  ): Promise<DepositIntentResult> {
    const token = await this.getToken();
    const idemKey = idempotencyKey ?? `deposit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const resp = await this._fetch<DepositIntentResult>(
      `${this.gatewayUrl}/api/v1/balance/deposit/intent`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Idempotency-Key": idemKey,
        },
        body: JSON.stringify({ txHash, amountUsdc }),
      }
    );
    return resp;
  }

  /** Confirm a previously registered deposit intent. */
  async confirmDeposit(intentId: string, eventKey: string): Promise<{ status: string }> {
    const token = await this.getToken();
    return this._fetch<{ status: string }>(
      `${this.gatewayUrl}/api/v1/balance/deposit/intents/${intentId}/confirm`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ eventKey, confirmations: 1 }),
      }
    );
  }

  /**
   * Set the owner-level monthly billing cap.
   * Pass `null` (or omit) to remove the cap (unlimited until balance = 0).
   */
  async setSpendingLimit(usdc: number | null): Promise<void> {
    const token = await this.getToken();
    await this._fetch(`${this.gatewayUrl}/api/v1/balance/spending-limit`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(
        usdc === null
          ? { allowUnlimited: true }
          : { spendingLimitUsdc: usdc, allowUnlimited: false }
      ),
    });
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private async _fetch<T>(url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...Object.fromEntries(Object.entries(init.headers ?? {})),
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
        const detail = (data as Record<string, unknown>)?.["detail"];
        const msg = typeof detail === "string" ? detail : typeof detail === "object" && detail !== null
          ? JSON.stringify(detail) : text;
        throw new Error(`HTTP ${resp.status}: ${msg}`);
      }
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
