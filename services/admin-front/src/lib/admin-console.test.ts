import { describe, expect, it } from "vitest";

import { formatDateTime, formatUsdc, toneFromStatus } from "./admin-console";

describe("formatUsdc", () => {
  it("renders two decimal places for numeric values", () => {
    expect(formatUsdc(103.5)).toBe("103.50");
  });

  it("falls back to zero for invalid values", () => {
    expect(formatUsdc("not-a-number")).toBe("0.00");
  });
});

describe("formatDateTime", () => {
  it("returns n/a when no timestamp is provided", () => {
    expect(formatDateTime(null)).toBe("n/a");
  });

  it("returns the original string when the date is invalid", () => {
    expect(formatDateTime("bad-date")).toBe("bad-date");
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