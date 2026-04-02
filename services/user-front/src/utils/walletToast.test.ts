import { describe, expect, it, vi } from "vitest";

const { toastDefault, toastError } = vi.hoisted(() => ({
  toastDefault: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: Object.assign(toastDefault, {
    error: toastError,
  }),
}));

import {
  WALLET_STATUS_TOAST_ID,
  showWalletStatusErrorToast,
  showWalletStatusToast,
} from "@/utils/walletToast";

describe("walletToast", () => {
  it("reuses one toast id for wallet status updates", () => {
    showWalletStatusToast("Wallet reconnecting, please wait a moment.", { icon: "⏳" });

    expect(toastDefault).toHaveBeenCalledWith(
      "Wallet reconnecting, please wait a moment.",
      expect.objectContaining({
        icon: "⏳",
        id: WALLET_STATUS_TOAST_ID,
      }),
    );
  });

  it("reuses the same toast id for wallet errors", () => {
    showWalletStatusErrorToast("Auth failed: wallet disconnected");

    expect(toastError).toHaveBeenCalledWith(
      "Auth failed: wallet disconnected",
      expect.objectContaining({
        id: WALLET_STATUS_TOAST_ID,
      }),
    );
  });
});
