type PricingObject = {
  amount?: string | number | null;
  currency?: string | null;
  inputPricePer1MTokensUsdc?: string | number | null;
  outputPricePer1MTokensUsdc?: string | number | null;
  priceModel?: string | null;
};

export type PricingValue = string | PricingObject | null | undefined;

export function extractPricingAmount(
  value: PricingValue,
  fallback = "0.01"
): string {
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

export function formatPricing(
  value: PricingValue,
  defaultCurrency = "USDC"
): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || "N/A";
  }

  if (value && typeof value === "object") {
    if (value.priceModel === "token_metered") {
      const inputPrice = String(value.inputPricePer1MTokensUsdc ?? "").trim();
      const outputPrice = String(value.outputPricePer1MTokensUsdc ?? "").trim();
      const currency =
        typeof value.currency === "string" && value.currency.trim()
          ? value.currency.trim()
          : defaultCurrency;
      if (inputPrice && outputPrice) {
        return `${inputPrice} in / ${outputPrice} out ${currency} per 1M tokens`;
      }
    }

    const amount = extractPricingAmount(value, "");
    const currency =
      typeof value.currency === "string" ? value.currency.trim() : "";
    if (amount && currency) {
      return `${amount} ${currency}`;
    }
    if (amount) {
      return defaultCurrency ? `${amount} ${defaultCurrency}` : amount;
    }
  }

  return "N/A";
}
