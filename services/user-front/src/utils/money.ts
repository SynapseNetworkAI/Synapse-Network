import { parseUnits } from "viem";

export type MoneyString = string;

const MONEY_SCALE = 6;
const MONEY_PATTERN = /^\d+(?:\.\d{1,6})?$/;

function trimLeadingZeros(value: string): string {
  const normalized = value.replace(/^0+(?=\d)/, "");
  return normalized.length > 0 ? normalized : "0";
}

export function normalizeMoneyString(value: unknown, fallback: MoneyString = "0"): MoneyString {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    if (!MONEY_PATTERN.test(trimmed)) return fallback;
    const [wholeRaw, fractionRaw = ""] = trimmed.split(".");
    const whole = trimLeadingZeros(wholeRaw);
    const fraction = fractionRaw.slice(0, MONEY_SCALE).replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return fallback;
    return normalizeMoneyString(value.toFixed(MONEY_SCALE), fallback);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return fallback;
}

export function isMoneyString(value: string): boolean {
  return MONEY_PATTERN.test(value.trim());
}

export function toMoneyAtomic(value: unknown): bigint {
  return parseUnits(normalizeMoneyString(value), MONEY_SCALE);
}

export function moneyStringToNumber(value: unknown): number {
  return Number(normalizeMoneyString(value));
}

export function compareMoneyStrings(left: unknown, right: unknown): number {
  const l = toMoneyAtomic(left);
  const r = toMoneyAtomic(right);
  if (l === r) return 0;
  return l > r ? 1 : -1;
}

export function formatMoneyString(value: unknown, fractionDigits: number = 2): string {
  const normalizedFractionDigits = Math.max(
    0,
    Math.min(fractionDigits, MONEY_SCALE)
  );
  const roundingUnit = 10n ** BigInt(MONEY_SCALE - normalizedFractionDigits);
  const roundedAtomic =
    normalizedFractionDigits === MONEY_SCALE
      ? toMoneyAtomic(value)
      : (toMoneyAtomic(value) + roundingUnit / 2n) / roundingUnit;

  const divisor = 10n ** BigInt(normalizedFractionDigits);
  const wholeValue =
    normalizedFractionDigits === 0
      ? roundedAtomic
      : roundedAtomic / divisor;
  const whole = wholeValue
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  if (normalizedFractionDigits <= 0) return whole;

  const fractionValue =
    normalizedFractionDigits === MONEY_SCALE
      ? roundedAtomic % divisor
      : roundedAtomic % divisor;
  return `${whole}.${fractionValue
    .toString()
    .padStart(normalizedFractionDigits, "0")}`;
}
