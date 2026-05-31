import { describe, expect, it } from "vitest";

import {
  formatPercent,
  formatPlainAmount,
  formatUsd,
} from "@/utils/ownerCreditsFormat";

describe("ownerCreditsFormat", () => {
  it("formats dashboard money and percentage labels", () => {
    expect(formatUsd(12.6)).toBe("$12.60");
    expect(formatPlainAmount("7.5")).toBe("7.50");
    expect(formatPercent(10)).toBe("10%");
    expect(formatPercent(10.25)).toBe("10.3%");
    expect(formatPercent(120)).toBe("100%");
  });
});
