"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";

type SupportedWalletConnectButtonProps = {
  compact?: boolean;
};

export default function SupportedWalletConnectButton({
  compact = false,
}: Readonly<SupportedWalletConnectButtonProps>) {
  const { openConnectModal } = useConnectModal();

  if (!openConnectModal) {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
        Wallet connection is unavailable. Please refresh the page or install a
        supported Arbitrum wallet such as MetaMask or Rabby.
      </div>
    );
  }

  const buttonClassName = compact
    ? "inline-flex items-center justify-center rounded-full border border-white/14 bg-white px-4 py-2 text-sm font-semibold text-black shadow-[0_10px_30px_rgba(255,255,255,0.12)] transition hover:bg-[#e9fff4]"
    : "inline-flex w-full items-center justify-center rounded-xl border border-white/14 bg-white px-5 py-3 text-sm font-bold text-black shadow-[0_18px_50px_rgba(255,255,255,0.12)] transition hover:bg-[#e9fff4]";

  return (
    <button
      type="button"
      onClick={openConnectModal}
      className={buttonClassName}
    >
      Connect Wallet
    </button>
  );
}
