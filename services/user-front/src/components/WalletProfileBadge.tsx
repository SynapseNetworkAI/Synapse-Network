"use client";

import {
  useAccount,
  useDisconnect,
  useReadContract,
  useWatchContractEvent,
} from "wagmi";
import { Coins, LogOut } from "lucide-react";
import toast from "react-hot-toast";
import { useCallback } from "react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { clearAuthSession, buildAuthedHeaders } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";
import contractConfig from "@/contract-config.json";
import { parseAbi } from "viem";
import SupportedWalletConnectButton from "@/components/SupportedWalletConnectButton";

type WalletProfileBadgeProps = {
  compact?: boolean;
};

function useWalletUsdcBalance(address?: `0x${string}`) {
  const { data: walletUsdcBalanceRaw, refetch } = useReadContract({
    address: contractConfig.MockUSDC as `0x${string}`,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  useWatchContractEvent({
    address: contractConfig.MockUSDC as `0x${string}`,
    abi: parseAbi([
      "event Transfer(address indexed from, address indexed to, uint256 value)",
    ]),
    eventName: "Transfer",
    onLogs(logs) {
      if (
        logs.some((log) => log.args.from === address || log.args.to === address)
      ) {
        refetch();
      }
    },
  });

  return walletUsdcBalanceRaw === undefined
    ? "0.00"
    : (Number(walletUsdcBalanceRaw) / 1e18).toFixed(2);
}

function useWalletLogout(address: string | undefined) {
  const { disconnect } = useDisconnect();
  const { t } = useLanguage();

  const handleLogout = useCallback(async () => {
    await logoutBackendSession(address);
    clearAuthSession();
    disconnect();
    toast.success(t("nav.walletDisconnected"));
  }, [address, disconnect, t]);

  return { handleLogout, t };
}

async function logoutBackendSession(address: string | undefined) {
  if (!address) {
    return;
  }

  try {
    const response = await fetch(`${getGatewayBaseUrl()}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        ...buildAuthedHeaders(address, false),
      },
    });
    if (!response.ok && response.status !== 404) {
      console.warn("Backend logout warning:", response.status);
    }
  } catch (error) {
    console.warn("Backend logout warning:", error);
  }
}

function CompactWalletProfile({
  address,
  masterBalance,
  onLogout,
  t,
}: Readonly<{
  address?: string;
  masterBalance: string;
  onLogout: () => void;
  t: (key: string) => string;
}>) {
  return (
    <div className="flex items-center gap-2">
      <div className="hidden h-10 items-center gap-2 rounded-[14px] border border-white/10 bg-[#0b0f15] px-3.5 text-sm text-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:flex">
        <span className="inline-flex h-2 w-2 rounded-full bg-[#7ff7be] shadow-[0_0_10px_rgba(127,247,190,0.58)]" />
        <span className="font-semibold tracking-[-0.02em]">
          {address?.slice(0, 6)}...{address?.slice(-4)}
        </span>
      </div>
      <div className="hidden h-10 items-center gap-2 rounded-[14px] border border-white/10 bg-[#0b0f15] px-3.5 text-sm font-semibold text-[#7ff7be] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] xl:flex">
        <Coins className="h-4 w-4" />
        {masterBalance} USDC
      </div>
      <button
        onClick={onLogout}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-[14px] border border-[#ff6f6f]/18 bg-[#190d10] px-3 text-sm font-semibold text-[#ff8d8d] transition hover:border-[#ff6f6f]/28 hover:bg-[#221013] hover:text-[#ffb0b0]"
        title={t("nav.disconnectWallet")}
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden 2xl:inline">{t("nav.disconnect")}</span>
      </button>
    </div>
  );
}

function FullWalletProfile({
  address,
  masterBalance,
  onLogout,
  t,
}: Readonly<{
  address?: string;
  masterBalance: string;
  onLogout: () => void;
  t: (key: string) => string;
}>) {
  return (
    <div className="flex gap-4">
      <div className="flex items-center space-x-4 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2">
        <div className="flex items-center text-sm font-medium text-white">
          <div className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse" />
          {address?.slice(0, 6)}...{address?.slice(-4)}
        </div>
        <div className="h-4 w-px bg-gray-700" />
        <div className="flex items-center text-sm font-bold text-green-400">
          <Coins className="w-4 h-4 mr-1.5" />
          {masterBalance} USDC
        </div>
      </div>
      <button
        onClick={onLogout}
        className="flex items-center px-4 py-2 text-sm font-bold text-red-400 transition-colors bg-gray-900 border border-red-900/50 rounded-lg hover:bg-red-950/30"
        title={t("nav.disconnectWallet")}
      >
        <LogOut className="w-4 h-4 mr-2" />
        {t("nav.disconnect")}
      </button>
    </div>
  );
}

export default function WalletProfileBadge({
  compact = false,
}: Readonly<WalletProfileBadgeProps>) {
  const { address, isConnected } = useAccount();
  const masterBalance = useWalletUsdcBalance(address);
  const { handleLogout, t } = useWalletLogout(address);

  if (!isConnected) {
    return <SupportedWalletConnectButton compact={compact} />;
  }

  const profileProps = {
    address,
    masterBalance,
    onLogout: handleLogout,
    t,
  };

  return compact ? (
    <CompactWalletProfile {...profileProps} />
  ) : (
    <FullWalletProfile {...profileProps} />
  );
}
