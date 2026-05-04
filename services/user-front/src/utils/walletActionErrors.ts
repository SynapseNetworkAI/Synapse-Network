type WalletErrorLike = {
  code?: unknown;
  name?: unknown;
  message?: unknown;
  shortMessage?: unknown;
  details?: unknown;
  cause?: unknown;
};

function collectErrorText(error: unknown, output: string[] = []): string[] {
  if (!error) return output;
  if (typeof error === "string") {
    output.push(error);
    return output;
  }
  if (typeof error !== "object") return output;

  const item = error as WalletErrorLike;
  for (const value of [
    item.code,
    item.name,
    item.message,
    item.shortMessage,
    item.details,
  ]) {
    if (value !== undefined && value !== null) output.push(String(value));
  }
  if (item.cause && item.cause !== error) {
    collectErrorText(item.cause, output);
  }
  return output;
}

export function isWalletUserRejectedError(error: unknown): boolean {
  const normalized = collectErrorText(error).join(" | ").toLowerCase();
  return (
    normalized.includes("4001") ||
    normalized.includes("action_rejected") ||
    normalized.includes("user rejected") ||
    normalized.includes("user denied") ||
    normalized.includes("rejected the request") ||
    normalized.includes("denied message signature") ||
    normalized.includes("denied transaction signature")
  );
}

export function createWalletUserRejectedError(): Error & { code: number } {
  const error = new Error("ACTION_REJECTED") as Error & { code: number };
  error.code = 4001;
  return error;
}
