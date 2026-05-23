// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { openConnectModalMock, rainbowState } = vi.hoisted(() => ({
  openConnectModalMock: vi.fn(),
  rainbowState: {
    hasConnectModal: true,
  },
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({
    openConnectModal: rainbowState.hasConnectModal
      ? openConnectModalMock
      : undefined,
  }),
}));

import SupportedWalletConnectButton from "@/components/SupportedWalletConnectButton";

describe("SupportedWalletConnectButton", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    rainbowState.hasConnectModal = true;
  });

  it("renders a single RainbowKit wallet entrypoint", () => {
    render(<SupportedWalletConnectButton />);

    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "MetaMask" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Phantom" })).toBeNull();
    expect(screen.queryByRole("button", { name: "WalletConnect" })).toBeNull();
  });

  it("opens the RainbowKit connect modal", async () => {
    const user = userEvent.setup();
    render(<SupportedWalletConnectButton />);

    await user.click(screen.getByRole("button", { name: "Connect Wallet" }));

    expect(openConnectModalMock).toHaveBeenCalledTimes(1);
  });

  it("shows a bounded fallback when RainbowKit modal is unavailable", () => {
    rainbowState.hasConnectModal = false;

    render(<SupportedWalletConnectButton />);

    expect(screen.getByText(/Wallet connection is unavailable/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect Wallet" })).toBeNull();
  });
});
