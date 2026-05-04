import { describe, expect, it } from "vitest";

import {
  createWalletUserRejectedError,
  isWalletUserRejectedError,
} from "@/utils/walletActionErrors";

describe("walletActionErrors", () => {
  it("detects common user rejection shapes", () => {
    expect(isWalletUserRejectedError("User denied message signature")).toBe(
      true
    );
    expect(
      isWalletUserRejectedError({ cause: { name: "ACTION_REJECTED" } })
    ).toBe(true);
    expect(isWalletUserRejectedError(createWalletUserRejectedError())).toBe(
      true
    );
    expect(isWalletUserRejectedError(42)).toBe(false);
  });
});
