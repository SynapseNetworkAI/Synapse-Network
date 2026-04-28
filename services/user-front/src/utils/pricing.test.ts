import { describe, expect, it } from "vitest";

import { formatPricing } from "./pricing";

describe("formatPricing", () => {
  it("renders token-metered LLM prices per 1M tokens", () => {
    expect(
      formatPricing({
        amount: "0",
        currency: "USDC",
        priceModel: "token_metered",
        inputPricePer1MTokensUsdc: "0.140000",
        outputPricePer1MTokensUsdc: "0.280000",
      })
    ).toBe("0.140000 in / 0.280000 out USDC per 1M tokens");
  });
});
