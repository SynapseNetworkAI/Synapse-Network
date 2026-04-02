import { describe, expect, it } from "vitest";

import { applyOtpSlotEdit, getOtpSlots, normalizeOtpCode } from "@/components/auth-code-slots.helpers";

describe("auth-code-slots helpers", () => {
  it("normalizes OTP payload to numeric length", () => {
    expect(normalizeOtpCode("12a3-45 678", 6)).toBe("123456");
  });

  it("builds fixed slot arrays", () => {
    expect(getOtpSlots("123", 6)).toEqual(["1", "2", "3", "", "", ""]);
  });

  it("fills sequential slots when pasting into a position", () => {
    expect(applyOtpSlotEdit("12", 2, "3456", 6)).toBe("123456");
  });

  it("clears a single slot without dropping later digits", () => {
    expect(applyOtpSlotEdit("123456", 2, "", 6)).toBe("12456");
  });
});