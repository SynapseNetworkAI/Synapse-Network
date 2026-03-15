export type PayForServiceFn = () => Promise<string>;

export type InvokePaidServiceParams<TPayload = unknown> = {
  endpoint: string;
  serviceId: string;
  payload: TPayload;
  payForService: PayForServiceFn;
  credential?: string;
  maxWaitMs?: number;
  defaultRetryAfterMs?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
};

export type InvokePaidServiceResult<TResponse = unknown> = {
  txHash: string;
  attempts: number;
  response: TResponse;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const toRetryDelay = (value: unknown, fallbackMs: number) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value * 1000);
  }
  return fallbackMs;
};

const extractErrorMessage = async (res: Response) => {
  try {
    const data = await res.json();
    if (typeof data?.detail?.message === "string") {
      return data.detail.message;
    }
    if (typeof data?.message === "string") {
      return data.message;
    }
    if (typeof data?.detail === "string") {
      return data.detail;
    }
  } catch {
    return res.statusText || "Request failed";
  }
  return res.statusText || "Request failed";
};

export async function invokePaidService<TPayload = unknown, TResponse = unknown>(
  params: InvokePaidServiceParams<TPayload>
): Promise<InvokePaidServiceResult<TResponse>> {
  const {
    endpoint,
    serviceId,
    payload,
    payForService,
    credential,
    maxWaitMs = 60_000,
    defaultRetryAfterMs = 2_000,
    maxAttempts = 20,
    signal,
  } = params;

  const txHash = await payForService();
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw new Error("Request aborted");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Tx-Hash": txHash,
      "X-Service-Id": serviceId,
    };
    if (credential) {
      headers["X-Credential"] = credential;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });

    if (res.status === 202) {
      const pending = await res.json().catch(() => ({}));
      const retryAfterMs = toRetryDelay(pending?.retryAfterSec, defaultRetryAfterMs);
      if (Date.now() - startedAt + retryAfterMs > maxWaitMs) {
        throw new Error("Payment confirmation timeout");
      }
      await sleep(retryAfterMs);
      continue;
    }

    if (!res.ok) {
      const errorMessage = await extractErrorMessage(res);
      throw new Error(`Service call failed (${res.status}): ${errorMessage}`);
    }

    const data = (await res.json()) as TResponse;
    return {
      txHash,
      attempts: attempt,
      response: data,
    };
  }

  throw new Error("Exceeded maximum attempts while waiting for payment confirmation");
}
