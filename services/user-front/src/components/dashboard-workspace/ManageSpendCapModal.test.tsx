// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

import ManageSpendCapModal from "@/components/dashboard-workspace/ManageSpendCapModal";
import { renderWithLanguage } from "@/test/renderWithLanguage";

const { toastErrorMock, updateOwnerSpendingLimitMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  updateOwnerSpendingLimitMock: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: {
    error: toastErrorMock,
    success: vi.fn(),
  },
}));

vi.mock("@/utils/balanceApi", async () => {
  const actual = await vi.importActual<typeof import("@/utils/balanceApi")>(
    "@/utils/balanceApi"
  );
  return {
    ...actual,
    updateOwnerSpendingLimit: updateOwnerSpendingLimitMock,
  };
});

function renderModal(language: "en" | "zh") {
  return renderWithLanguage(
    createElement(ManageSpendCapModal, {
      open: true,
      userAddress: "0xabc",
      spendingLimit: {
        ownerAddress: "0xabc",
        spendingLimitUsdc: null,
        allowUnlimited: true,
        cycleInterval: "monthly",
        currentCycleSpendUsdc: "0",
        remainingSpendUsdc: null,
        updatedAt: null,
      },
      onClose: vi.fn(),
    }),
    language
  );
}

describe("ManageSpendCapModal error copy", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    updateOwnerSpendingLimitMock.mockRejectedValue(
      new Error("503: {'code': 'HTTPException', 'message': 'Internal error'}")
    );
  });

  it("shows localized English fallback instead of raw backend errors", async () => {
    const user = userEvent.setup();
    renderModal("en");

    await user.click(screen.getByLabelText("Amount (USDC)"));
    await user.type(screen.getByLabelText("Amount (USDC)"), "25");
    await user.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Failed to save spending limit."
      );
    });
    expect(screen.getByText("Failed to save spending limit.")).toBeTruthy();
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      expect.stringContaining("503:")
    );
  });

  it("shows localized Chinese fallback instead of raw backend errors", async () => {
    const user = userEvent.setup();
    renderModal("zh");

    await user.click(screen.getByLabelText("金额 (USDC)"));
    await user.type(screen.getByLabelText("金额 (USDC)"), "25");
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("保存消费上限失败。");
    });
    expect(screen.getByText("保存消费上限失败。")).toBeTruthy();
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      expect.stringContaining("HTTPException")
    );
  });
});
