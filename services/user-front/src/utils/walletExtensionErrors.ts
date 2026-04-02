type WalletExtensionErrorDetails = {
  message?: string | null;
  filename?: string | null;
  stack?: string | null;
};

function normalizeErrorPart(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function isIgnorableWalletExtensionError(details: WalletExtensionErrorDetails): boolean {
  const combined = [details.message, details.filename, details.stack]
    .map(normalizeErrorPart)
    .filter(Boolean)
    .join("\n");

  if (!combined) {
    return false;
  }

  const isInjectedWalletBridge = /chrome-extension:\/\/[^/]+\/scripts\/inpage\.js/.test(combined)
    || combined.includes("metamask");

  if (!isInjectedWalletBridge) {
    return false;
  }

  return combined.includes("failed to connect")
    || combined.includes("wallet is still reconnecting")
    || combined.includes("connector not connected")
    || combined.includes("unavailable while reconnecting");
}

export function toWalletExtensionErrorDetails(error: unknown): WalletExtensionErrorDetails {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === "string") {
    return {
      message: error,
    };
  }

  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; stack?: unknown };
    return {
      message: typeof candidate.message === "string" ? candidate.message : null,
      stack: typeof candidate.stack === "string" ? candidate.stack : null,
    };
  }

  return {
    message: null,
  };
}