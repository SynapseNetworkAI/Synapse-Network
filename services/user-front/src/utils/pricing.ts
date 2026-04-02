type PricingObject = {
  amount?: string | number | null;
  currency?: string | null;
};

export type PricingValue = string | PricingObject | null | undefined;

export function extractPricingAmount(value: PricingValue, fallback = "0.01"): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }

  if (value && typeof value === "object") {
    const amount = value.amount;
    if (typeof amount === "number" && Number.isFinite(amount)) {
      return String(amount);
    }
    if (typeof amount === "string") {
      const trimmed = amount.trim();
      return trimmed || fallback;
    }
  }

  return fallback;
}

export function formatPricing(value: PricingValue, defaultCurrency = "USDC"): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || "N/A";
  }

  if (value && typeof value === "object") {
    const amount = extractPricingAmount(value, "");
    const currency = typeof value.currency === "string" ? value.currency.trim() : "";
    if (amount && currency) {
      return `${amount} ${currency}`;
    }
    if (amount) {
      return defaultCurrency ? `${amount} ${defaultCurrency}` : amount;
    }
  }

  return "N/A";
}