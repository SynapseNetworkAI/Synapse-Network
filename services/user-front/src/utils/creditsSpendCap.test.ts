import { describe, expect, it } from "vitest";
import {
  calculateSpendRatio,
  getBillingCycleWindow,
} from "@/utils/creditsSpendCap";

describe("creditsSpendCap", () => {
  it("builds the current monthly billing cycle window", () => {
    const cycle = getBillingCycleWindow(new Date("2026-04-10T10:00:00Z"));

    expect(cycle.cycleLabel).toContain("Apr");
    expect(cycle.daysRemaining).toBeGreaterThanOrEqual(20);
    expect(cycle.cycleStartMs).toBe(new Date("2026-04-01T00:00:00").getTime());
    expect(cycle.cycleEndMs).toBe(
      new Date("2026-05-01T00:00:00").getTime() - 1
    );
  });

  it("calculates spend ratio for a configured owner billing cap", () => {
    expect(calculateSpendRatio(2.5, 10)).toBe(25);
  });

  it("returns null when the account has no billing cap", () => {
    expect(calculateSpendRatio(2.5, null)).toBeNull();
  });

  it("caps the progress bar ratio at 100 percent", () => {
    expect(calculateSpendRatio(15, 10)).toBe(100);
  });
});
