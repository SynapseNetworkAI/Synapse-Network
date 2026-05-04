import { describe, expect, it } from "vitest";

import {
  normalizeTokenDecimals,
  shortAddress,
} from "@/utils/vaultDepositDisplay";

describe("vaultDepositDisplay", () => {
  it("formats short addresses and empty wallet labels", () => {
    expect(shortAddress()).toBe("-");
    expect(shortAddress("0x1234")).toBe("0x1234");
    expect(shortAddress("0x82f1c188327bfc265357a85e8a6b4a34d562d6f8")).toBe(
      "0x82f1...d6f8"
    );
  });

  it("normalizes token decimals with an 18-decimal fallback", () => {
    expect(normalizeTokenDecimals(6)).toBe(6);
    expect(normalizeTokenDecimals(18n)).toBe(18);
    expect(normalizeTokenDecimals(99)).toBe(18);
    expect(normalizeTokenDecimals("bad")).toBe(18);
  });
});
