export function shortAddress(address?: string): string {
  if (!address) return "-";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function normalizeTokenDecimals(value: unknown): number {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 36 ? parsed : 18;
}
