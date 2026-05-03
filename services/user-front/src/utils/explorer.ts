type AppEnvironment = "local" | "staging" | "prod";

const DEFAULT_EXPLORERS: Record<AppEnvironment, string | null> = {
  local: "http://localhost:5100",
  staging: "https://sepolia.arbiscan.io",
  prod: "https://arbiscan.io",
};

function normalizeExplorerBase(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return value.replace(/\/+$/, "");
}

function appEnvironment(): AppEnvironment {
  const raw = process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase();
  if (raw === "staging" || raw === "stage") return "staging";
  if (raw === "prod" || raw === "production") return "prod";
  return "local";
}

export function getTransactionExplorerBaseUrl(): string | null {
  const configured = normalizeExplorerBase(
    process.env.NEXT_PUBLIC_TX_EXPLORER_BASE_URL
  );
  if (configured) return configured;
  return DEFAULT_EXPLORERS[appEnvironment()];
}

export function getTransactionExplorerUrl(
  txHash: string | null | undefined
): string | null {
  const hash = txHash?.trim();
  if (!hash) return null;
  const baseUrl = getTransactionExplorerBaseUrl();
  if (!baseUrl) return null;
  return `${baseUrl}/tx/${hash}`;
}
