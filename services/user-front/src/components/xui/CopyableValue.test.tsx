// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import CopyableValue, {
  shortenCopyValue,
} from "@/components/xui/CopyableValue";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";

const { toastSuccess, toastError, writeText } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: {
    success: toastSuccess,
    error: toastError,
  },
}));

function renderCopyable(value?: string | null) {
  return render(
    <LanguageProvider>
      <CopyableValue value={value} label="Transaction ID" />
    </LanguageProvider>
  );
}

describe("CopyableValue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem(I18N_STORAGE_KEY, "en");
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    writeText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("shortens long values in the middle", () => {
    expect(shortenCopyValue("0x1234567890abcdef", 6, 4)).toBe("0x1234...cdef");
  });

  it("copies the full value and shows a success toast", async () => {
    renderCopyable("0x1234567890abcdef");

    fireEvent.click(
      screen.getByRole("button", { name: "Copy Transaction ID" })
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("0x1234567890abcdef");
    });
    expect(toastSuccess).toHaveBeenCalledWith("Transaction ID copied");
  });

  it("does not render a copy button for an empty value", () => {
    renderCopyable("");

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("shows an error toast when clipboard write fails", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    renderCopyable("tx_123");

    fireEvent.click(
      screen.getByRole("button", { name: "Copy Transaction ID" })
    );

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Copy failed. Please try again.");
    });
  });
});
