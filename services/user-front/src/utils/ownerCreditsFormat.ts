import { formatMoneyString, normalizeMoneyString } from "@/utils/money";

export function formatUsd(value: number | string): string {
  return `$${formatMoneyString(
    typeof value === "number" ? normalizeMoneyString(value) : value,
    2
  )}`;
}

export function formatPlainAmount(value: number | string): string {
  return formatMoneyString(
    typeof value === "number" ? normalizeMoneyString(value) : value,
    2
  );
}

export function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, value)).toFixed(1).replace(/\.0$/, "")}%`;
}
