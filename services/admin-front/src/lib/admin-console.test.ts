import { describe, expect, it } from "vitest";

import {
  absMoneyString,
  addMoneyStrings,
  compareMoneyStrings,
  formatDateTime,
  formatUsdc,
  parseMoneyStringForChart,
  subtractMoneyStrings,
  toneFromStatus,
} from "./admin-console";

describe("formatUsdc", () => {
  it("renders two decimal places for numeric values", () => {
    expect(formatUsdc(103.5)).toBe("103.50");
  });

  it("falls back to zero for invalid values", () => {
    expect(formatUsdc("not-a-number")).toBe("0.00");
  });
});

describe("money helpers", () => {
  it("parses string money for chart-only numeric use", () => {
    expect(parseMoneyStringForChart("12.345678")).toBe(12.345678);
  });

  it("compares, sums, and subtracts money strings", () => {
    expect(compareMoneyStrings("2.5", "2.4")).toBe(1);
    expect(addMoneyStrings(["1.25", "2.50", "0.25"])).toBe("4");
    expect(subtractMoneyStrings("10.50", "0.25")).toBe("10.25");
    expect(absMoneyString("-0.75")).toBe("0.75");
  });
});

describe("formatDateTime", () => {
  it("returns n/a when no timestamp is provided", () => {
    expect(formatDateTime(null)).toBe("n/a");
  });

  it("returns the original string when the date is invalid", () => {
    expect(formatDateTime("bad-date")).toBe("bad-date");
  });

  it("formats timestamps in the staging business timezone", () => {
    expect(formatDateTime("2026-03-21T10:05:00Z")).toBe("03/21 18:05");
  });
});

describe("toneFromStatus", () => {
  it("maps healthy and active states to green", () => {
    expect(toneFromStatus("healthy")).toBe("green");
    expect(toneFromStatus("active queue")).toBe("green");
  });

  it("maps review and warning states to orange", () => {
    expect(toneFromStatus("pending_review")).toBe("orange");
  });

  it("maps failed or alert states to red", () => {
    expect(toneFromStatus("failed")).toBe("red");
  });
});
