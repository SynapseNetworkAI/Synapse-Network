"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { formatEther, parseUnits } from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  usePublicClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import toast from "react-hot-toast";
import Link from "next/link";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { ProviderWithdrawAmountPanel } from "@/components/provider-workspace/ProviderWithdrawAmountPanel";
import { ProviderWithdrawBalanceSummary } from "@/components/provider-workspace/ProviderWithdrawBalanceSummary";
import CopyableValue from "@/components/xui/CopyableValue";
import { useDashboardData } from "@/hooks/useDashboardData";
import SynapseCoreABI from "@/SynapseCoreABI.json";
import contractConfig from "@/contract-config.json";
import {
  completeProviderWithdrawal,
  createProviderWithdrawIntent,
  getProviderWithdrawCapability,
  ProviderWithdrawApiError,
  isWithdrawTicketNearExpiry,
  type ProviderWithdrawCapability,
  listProviderWithdrawals,
  type ProviderWithdrawRecord,
  type ProviderWithdrawTicket,
} from "@/utils/providerWithdrawApi";
import {
  compareMoneyStrings,
  formatMoneyString,
  normalizeMoneyString,
  type MoneyString,
} from "@/utils/money";
import {
  showWithdrawWalletErrorToast,
  toSafeErrorMessage,
} from "@/utils/providerWithdrawWallet";

const VAULT_ADDRESS = (contractConfig as { SynapseCore?: string })
  .SynapseCore as `0x${string}` | undefined;
const USDC_TOKEN_ADDRESS = (contractConfig as { MockUSDC?: string })
  .MockUSDC as `0x${string}` | undefined;
const PROVIDER_WITHDRAW_MIN_USDC = "10.00";
const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
const CHAIN_LABELS: Record<number, string> = {
  31337: "Hardhat Local",
  11155111: "Sepolia",
  84532: "Base Sepolia",
  421614: "Arbitrum Sepolia",
};
const WITHDRAWAL_HISTORY_STATUS_FILTERS = [
  "ALL",
  "REQUESTED",
  "APPROVED_AUTO",
  "PENDING_MANUAL_REVIEW",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
  "FAILED_EXPIRED",
] as const;

type WithdrawalHistoryStatusFilter =
  (typeof WITHDRAWAL_HISTORY_STATUS_FILTERS)[number];
type TranslateFn = (
  key: string,
  vars?: Record<string, string | number>,
  fallbackText?: string
) => string;

function normalizeSignature(signature: string): `0x${string}` {
  const normalized = signature.startsWith("0x") ? signature : `0x${signature}`;
  return normalized as `0x${string}`;
}

function formatChainLabel(chainId: number | undefined, t: TranslateFn): string {
  if (!chainId || !Number.isFinite(chainId))
    return t("providerSettlements.chainRequiredNetwork");
  return CHAIN_LABELS[chainId] || `chain ${chainId}`;
}

function formatTimestamp(seconds?: number | string, locale?: string): string {
  if (!seconds) return "-";
  const numSeconds =
    typeof seconds === "string" ? Number.parseInt(seconds, 10) : seconds;
  if (Number.isNaN(numSeconds)) return "-";
  return new Date(numSeconds * 1000).toLocaleString(locale);
}

function withdrawalStatusLabel(
  status: ProviderWithdrawRecord["status"],
  t: TranslateFn
): string {
  if (status === "APPROVED_AUTO")
    return t("providerSettlements.historyStatusApprovedAuto");
  if (status === "PENDING_MANUAL_REVIEW")
    return t("providerSettlements.historyStatusPendingManualReview");
  if (status === "CANCELLED")
    return t("providerSettlements.historyStatusCancelled");
  if (status === "FAILED_EXPIRED")
    return t("providerSettlements.historyStatusFailedExpired", {}, "Expired");
  if (status === "REQUESTED")
    return t("providerSettlements.historyStatusRequested");
  if (status === "COMPLETED")
    return t("providerSettlements.historyStatusCompleted");
  if (status === "REJECTED")
    return t("providerSettlements.historyStatusRejected");
  return status;
}

function withdrawalHistoryReasonLabel(
  status: ProviderWithdrawRecord["status"],
  t: TranslateFn
): string {
  if (status === "PENDING_MANUAL_REVIEW") {
    return t("providerSettlements.manualReviewQueued");
  }
  if (status === "CANCELLED" || status === "FAILED_EXPIRED") {
    return t("providerSettlements.expiredTicketReleasedRow");
  }
  if (status === "APPROVED_AUTO") {
    return t("providerSettlements.ticketGenerated");
  }
  if (status === "REJECTED") {
    return t("providerSettlements.historyStatusRejected");
  }
  return "-";
}

function withdrawalStatusBadgeClass(
  status: ProviderWithdrawRecord["status"]
): string {
  if (status === "COMPLETED")
    return "border-[#22c55e]/30 bg-[#22c55e]/10 text-[#86efac]";
  if (status === "REJECTED")
    return "border-[#ef4444]/30 bg-[#ef4444]/10 text-[#fca5a5]";
  if (status === "CANCELLED" || status === "FAILED_EXPIRED")
    return "border-[#94a3b8]/30 bg-[#94a3b8]/10 text-[#cbd5e1]";
  if (status === "APPROVED_AUTO")
    return "border-[#22c55e]/30 bg-[#22c55e]/10 text-[#bbf7d0]";
  return "border-[#ff9f0a]/30 bg-[#ff9f0a]/10 text-[#ffd7a1]";
}

function resolveTicketContractAddress(
  ticket: ProviderWithdrawTicket
): `0x${string}` | undefined {
  const contractAddress = String(
    ticket.contractAddress || VAULT_ADDRESS || ""
  ).trim();
  return contractAddress ? (contractAddress as `0x${string}`) : undefined;
}

function validateRequestedWithdrawAmount(
  requestedAmount: string,
  availableReceivable: MoneyString,
  t: TranslateFn
): string | null {
  if (!requestedAmount) {
    return null;
  }
  if (!/^\d*(?:\.\d{0,2})?$/.test(requestedAmount)) {
    return t("providerSettlements.invalidAmountPrecision");
  }

  const normalizedAmount = normalizeMoneyString(requestedAmount, "");
  if (!normalizedAmount || normalizedAmount === "0") {
    return t("providerSettlements.invalidAmountValue");
  }

  if (compareMoneyStrings(normalizedAmount, PROVIDER_WITHDRAW_MIN_USDC) < 0) {
    return t("providerSettlements.amountBelowMinimum", {
      amount: PROVIDER_WITHDRAW_MIN_USDC,
    });
  }

  if (compareMoneyStrings(normalizedAmount, availableReceivable) > 0) {
    return t("providerSettlements.amountExceedsAvailable", {
      amount: formatMoneyString(availableReceivable, 2),
    });
  }

  return null;
}

function resolveCreateWithdrawalIntentErrorMessage(
  error: unknown,
  t: TranslateFn
): string {
  if (error instanceof ProviderWithdrawApiError) {
    if (error.code === "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE") {
      return t("providerSettlements.vaultLiquidityCheckUnavailable");
    }
    if (error.code === "CHAIN_RPC_UNAVAILABLE") {
      return t("providerSettlements.chainRpcUnavailable");
    }
    if (error.code === "PROVIDER_RECEIVABLE_NOT_MATURED") {
      return t("providerSettlements.providerReceivableNotMatured");
    }
    if (error.code === "MIN_WITHDRAWAL_AMOUNT_NOT_MET") {
      return t("providerSettlements.minWithdrawalAmountNotMet");
    }
    if (error.code === "INSUFFICIENT_PROVIDER_RECEIVABLE") {
      return t("providerSettlements.insufficientProviderReceivable");
    }
    if (error.code === "PENDING_WITHDRAWAL_EXISTS") {
      return t("providerSettlements.pendingWithdrawalExists");
    }
    if (error.code === "ACTION_REJECTED") {
      return t("providerSettlements.walletRejected");
    }
    return t("providerSettlements.withdrawalCreateFailed");
  }

  return t("providerSettlements.withdrawalCreateFailed");
}

export default function ProviderWithdrawPage() {
  const { providerStats, handleRefresh: reloadDashboard } = useDashboardData();
  const { t, lang } = useLanguage();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const chainId = useChainId();
  const publicClient = usePublicClient();

  const [withdrawAmountInput, setWithdrawAmountInput] = useState("");
  const [showAmountInput, setShowAmountInput] = useState(false);
  const [creatingIntent, setCreatingIntent] = useState(false);
  const [withdrawals, setWithdrawals] = useState<ProviderWithdrawRecord[]>([]);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);
  const [withdrawalStatusFilter, setWithdrawalStatusFilter] =
    useState<WithdrawalHistoryStatusFilter>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activeWithdrawalId, setActiveWithdrawalId] = useState<string | null>(
    null
  );
  const [activeTxChainId, setActiveTxChainId] = useState<number | undefined>(
    undefined
  );
  const [withdrawCapability, setWithdrawCapability] =
    useState<ProviderWithdrawCapability | null>(null);
  const [loadingWithdrawCapability, setLoadingWithdrawCapability] =
    useState(false);
  const locale = lang === "zh" ? "zh-CN" : "en-US";

  const withdrawWalletErrorMessages = useMemo(
    () => ({
      fallback: t("providerSettlements.withdrawalCreateFailed"),
      walletRejected: t("providerSettlements.walletRejected"),
      insufficientNativeGas: t("providerSettlements.insufficientNativeGas"),
      ticketExpired: t("providerSettlements.ticketExpired"),
      ticketExpiringSoon: t("providerSettlements.ticketExpiringSoon"),
      staleTicket: t("providerSettlements.staleTicket"),
      invalidSignature: t("providerSettlements.invalidSignature"),
      vaultLiquidityInsufficient: t(
        "providerSettlements.vaultLiquidityInsufficient"
      ),
      vaultAllowanceUnavailable: t(
        "providerSettlements.vaultAllowanceUnavailable"
      ),
      contractRejectedWithName: (name: string) =>
        t("providerSettlements.contractRejectedWithName", { name }),
      contractRejectedWithReason: (reason: string) =>
        t("providerSettlements.contractRejectedWithReason", { reason }),
    }),
    [t]
  );

  const receivableBalance = normalizeMoneyString(providerStats.receivable);
  const availableReceivable = normalizeMoneyString(
    providerStats.matureReceivable ?? providerStats.receivable
  );
  const withdrawMaturityEnforced =
    providerStats.withdrawMaturityEnforced !== false;
  const hasImmatureReceivable =
    withdrawMaturityEnforced &&
    compareMoneyStrings(receivableBalance, availableReceivable) > 0;
  const matureReceivableBelowMinimum =
    compareMoneyStrings(availableReceivable, PROVIDER_WITHDRAW_MIN_USDC) < 0;

  const { data: nativeBalanceData } = useBalance({ address });
  const {
    data: txHash,
    writeContractAsync,
    isPending: isWalletPrompting,
  } = useWriteContract();
  const {
    isLoading: isTxConfirming,
    isSuccess: isTxConfirmed,
    isError: isTxFailed,
    error: txReceiptError,
  } = useWaitForTransactionReceipt({ hash: txHash, chainId: activeTxChainId });

  const pendingWithdrawal = useMemo(
    () =>
      withdrawals.find((row) =>
        ["REQUESTED", "APPROVED_AUTO", "PENDING_MANUAL_REVIEW"].includes(
          row.status
        )
      ) || null,
    [withdrawals]
  );
  const filteredWithdrawals = useMemo(() => {
    let result = withdrawals;
    if (withdrawalStatusFilter !== "ALL") {
      result = result.filter((row) => row.status === withdrawalStatusFilter);
    }
    if (dateFrom) {
      const fromTs = new Date(dateFrom).getTime() / 1000;
      result = result.filter((row) => {
        const ts =
          typeof row.createdAt === "string"
            ? Number(row.createdAt)
            : row.createdAt || 0;
        return ts >= fromTs;
      });
    }
    if (dateTo) {
      const toTs = new Date(dateTo + "T23:59:59").getTime() / 1000;
      result = result.filter((row) => {
        const ts =
          typeof row.createdAt === "string"
            ? Number(row.createdAt)
            : row.createdAt || 0;
        return ts <= toTs;
      });
    }
    return result;
  }, [withdrawalStatusFilter, withdrawals, dateFrom, dateTo]);
  const withdrawalHistoryEmptyMessage = useMemo(() => {
    if (withdrawals.length === 0 || withdrawalStatusFilter === "ALL") {
      return t("providerSettlements.historyEmpty");
    }
    return t("providerSettlements.historyFilteredEmpty", {
      status: withdrawalStatusLabel(withdrawalStatusFilter, t),
    });
  }, [t, withdrawalStatusFilter, withdrawals.length]);
  const pendingTicket = pendingWithdrawal?.ticket;
  const pendingTicketChainMismatch = Boolean(
    pendingTicket?.chainId && chainId !== pendingTicket.chainId
  );
  const pendingTicketExpired = Boolean(
    pendingTicket?.deadline &&
      pendingTicket.deadline < Math.floor(Date.now() / 1000)
  );
  const hasEnoughGas = useMemo(() => {
    if (!isConnected || !nativeBalanceData) return true;
    return nativeBalanceData.value > BigInt(0);
  }, [isConnected, nativeBalanceData]);

  const refreshWithdrawals = useCallback(async () => {
    if (!address) return;
    setLoadingWithdrawals(true);
    try {
      const rows = await listProviderWithdrawals(address);
      setWithdrawals(rows);
    } catch (error) {
      console.error("Failed to load provider withdrawals", error);
      toast.error(
        toSafeErrorMessage(error, t("providerSettlements.loadHistoryFailed"))
      );
    } finally {
      setLoadingWithdrawals(false);
    }
  }, [address, t]);

  const refreshWithdrawCapability = useCallback(async () => {
    if (!address) {
      setWithdrawCapability(null);
      return;
    }
    setLoadingWithdrawCapability(true);
    try {
      const capability = await getProviderWithdrawCapability(address);
      setWithdrawCapability(capability);
    } catch (error) {
      console.error("Failed to load provider withdrawal capability", error);
      setWithdrawCapability({
        ticketSigningEnabled: false,
        code: "WITHDRAW_CAPABILITY_UNAVAILABLE",
        message: t("providerSettlements.ticketSigningUnavailable"),
        contractAddress: null,
      });
    } finally {
      setLoadingWithdrawCapability(false);
    }
  }, [address, t]);

  useEffect(() => {
    if (!address) {
      setWithdrawals([]);
      return;
    }
    void refreshWithdrawals();
  }, [address, refreshWithdrawals]);

  useEffect(() => {
    void refreshWithdrawCapability();
  }, [refreshWithdrawCapability]);

  useEffect(() => {
    if (!isTxConfirmed || !txHash || !address || !activeWithdrawalId) return;
    const complete = async () => {
      try {
        await completeProviderWithdrawal(address, activeWithdrawalId, txHash);
        toast.success(t("providerSettlements.settledCompleted"));
        await Promise.all([refreshWithdrawals(), reloadDashboard()]);
      } catch (error) {
        console.error("Failed to complete provider withdrawal", error);
        toast.error(t("providerSettlements.backendCompletionFailed"));
      } finally {
        setActiveWithdrawalId(null);
        setActiveTxChainId(undefined);
      }
    };
    void complete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTxConfirmed, txHash, address, activeWithdrawalId]);

  useEffect(() => {
    if (!isTxFailed || !txHash || !activeWithdrawalId) return;
    showWithdrawWalletErrorToast(txReceiptError, withdrawWalletErrorMessages);
    setActiveWithdrawalId(null);
    setActiveTxChainId(undefined);
  }, [
    activeWithdrawalId,
    isTxFailed,
    txHash,
    txReceiptError,
    withdrawWalletErrorMessages,
  ]);

  const withdrawAmountValidationMessage = useMemo(() => {
    return validateRequestedWithdrawAmount(
      withdrawAmountInput.trim(),
      availableReceivable,
      t
    );
  }, [availableReceivable, t, withdrawAmountInput]);

  const resolveRequestedWithdrawAmount = (): MoneyString | undefined => {
    const requestedAmount = withdrawAmountInput.trim();
    return requestedAmount ? normalizeMoneyString(requestedAmount) : undefined;
  };

  const validateWithdrawIntentReadiness = async (
    amountUsdc: MoneyString
  ): Promise<void> => {
    if (!publicClient) {
      throw new Error(t("providerSettlements.walletClientUnavailable"));
    }
    if (!USDC_TOKEN_ADDRESS || !VAULT_ADDRESS) {
      throw new Error(t("providerSettlements.vaultLiquidityInsufficient"));
    }

    const requestedAmountWei = parseUnits(amountUsdc, 18);
    const vaultUsdcBalance = await publicClient.readContract({
      address: USDC_TOKEN_ADDRESS,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [VAULT_ADDRESS],
    });

    if (vaultUsdcBalance < requestedAmountWei) {
      throw new Error(t("providerSettlements.vaultLiquidityInsufficient"));
    }
  };

  const handleExistingPendingWithdrawal = async (): Promise<boolean> => {
    if (!pendingWithdrawal) {
      return false;
    }
    if (pendingTicketExpired) {
      await Promise.all([refreshWithdrawals(), reloadDashboard()]);
      toast.error(t("providerSettlements.pendingTicketExpiredReleased"));
      return true;
    }
    if (
      pendingWithdrawal.status === "APPROVED_AUTO" &&
      pendingWithdrawal.ticket
    ) {
      try {
        await startWalletWithdraw(
          pendingWithdrawal.id,
          pendingWithdrawal.ticket
        );
      } catch (error) {
        showWithdrawWalletErrorToast(error, withdrawWalletErrorMessages);
      }
      return true;
    }
    toast.error(t("providerSettlements.pendingReviewExists"));
    return true;
  };

  const handleCreateWithdrawalIntent = async () => {
    if (!address || !isConnected) {
      openConnectModal?.();
      return;
    }
    if (!VAULT_ADDRESS) {
      toast.error(t("providerSettlements.vaultAddressMissing"));
      return;
    }
    if (!hasEnoughGas) {
      toast.error(t("providerSettlements.insufficientGasWarning"));
      return;
    }
    if (!withdrawCapability?.ticketSigningEnabled) {
      toast.error(t("providerSettlements.ticketSigningUnavailable"));
      return;
    }

    const requestedAmount = withdrawAmountInput.trim();
    if (!requestedAmount) {
      toast.error(t("providerSettlements.invalidAmountValue"));
      return;
    }
    const validationMessage = validateRequestedWithdrawAmount(
      requestedAmount,
      availableReceivable,
      t
    );
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }

    if (await handleExistingPendingWithdrawal()) {
      return;
    }

    const amountUsdc = resolveRequestedWithdrawAmount();
    if (!amountUsdc) {
      toast.error(t("providerSettlements.invalidAmountValue"));
      return;
    }
    if (compareMoneyStrings(amountUsdc, PROVIDER_WITHDRAW_MIN_USDC) < 0) {
      toast.error(
        t("providerSettlements.amountBelowMinimum", {
          amount: PROVIDER_WITHDRAW_MIN_USDC,
        })
      );
      return;
    }

    try {
      await validateWithdrawIntentReadiness(amountUsdc);
    } catch (error) {
      showWithdrawWalletErrorToast(error, withdrawWalletErrorMessages);
      return;
    }

    setCreatingIntent(true);
    const toastId = toast.loading(t("providerSettlements.generatingTicket"));
    try {
      const intent = await createProviderWithdrawIntent(address, amountUsdc);
      await Promise.all([
        refreshWithdrawals(),
        refreshWithdrawCapability(),
        reloadDashboard(),
      ]);
      setWithdrawAmountInput("");

      if (intent.status === "PENDING_MANUAL_REVIEW") {
        toast.success(t("providerSettlements.manualReviewQueued"), {
          id: toastId,
        });
      } else if (intent.ticket) {
        try {
          await startWalletWithdraw(intent.withdrawalId, intent.ticket);
          toast.success(t("providerSettlements.ticketGenerated"), {
            id: toastId,
          });
        } catch (error) {
          showWithdrawWalletErrorToast(error, withdrawWalletErrorMessages, {
            id: toastId,
          });
        }
      } else {
        toast.success(t("providerSettlements.withdrawalIntentCreated"), {
          id: toastId,
        });
      }
    } catch (error) {
      const message = resolveCreateWithdrawalIntentErrorMessage(error, t);
      toast.error(message, { id: toastId });
    } finally {
      setCreatingIntent(false);
    }
  };

  const validateWalletWithdrawReadiness = async (
    ticket: ProviderWithdrawTicket
  ): Promise<{
    contractAddress: `0x${string}`;
    targetChainId?: number;
  }> => {
    const contractAddress = resolveTicketContractAddress(ticket);
    if (!contractAddress) {
      throw new Error(t("providerSettlements.withdrawalContractMissing"));
    }

    if (ticket.chainId && chainId !== ticket.chainId) {
      throw new Error(
        t("providerSettlements.wrongNetwork", {
          chainLabel: formatChainLabel(ticket.chainId, t),
        })
      );
    }

    if (ticket.deadline && ticket.deadline < Math.floor(Date.now() / 1000)) {
      throw new Error(t("providerSettlements.ticketExpired"));
    }
    if (isWithdrawTicketNearExpiry(ticket)) {
      throw new Error(t("providerSettlements.ticketExpiringSoon"));
    }

    const symbol =
      nativeBalanceData?.symbol || t("providerSettlements.nativeTokenFallback");
    if (!address) {
      throw new Error(t("providerSettlements.connectWalletFirst"));
    }
    if (!publicClient) {
      throw new Error(t("providerSettlements.walletClientUnavailable"));
    }
    if (!USDC_TOKEN_ADDRESS) {
      throw new Error(t("providerSettlements.vaultLiquidityInsufficient"));
    }

    const liveNativeBalance = await publicClient.getBalance({ address });
    if (liveNativeBalance <= BigInt(0)) {
      throw new Error(
        t("providerSettlements.walletNoGas", {
          symbol,
          chainLabel: formatChainLabel(chainId, t),
        })
      );
    }

    const vaultUsdcBalance = await publicClient.readContract({
      address: USDC_TOKEN_ADDRESS,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [contractAddress],
    });
    if (vaultUsdcBalance < BigInt(ticket.amount)) {
      throw new Error(t("providerSettlements.vaultLiquidityInsufficient"));
    }

    const gasLimit = await publicClient.estimateContractGas({
      account: address,
      address: contractAddress,
      abi: SynapseCoreABI,
      functionName: "withdraw",
      args: [
        BigInt(ticket.amount),
        BigInt(ticket.fee),
        ticket.ticketId,
        BigInt(ticket.deadline),
        normalizeSignature(ticket.signature),
      ],
    });
    const feeEstimate = await publicClient.estimateFeesPerGas();
    const perGasFee = feeEstimate.maxFeePerGas ?? feeEstimate.gasPrice;
    if (perGasFee && perGasFee > BigInt(0)) {
      const estimatedFeeWei = (gasLimit * perGasFee * BigInt(12)) / BigInt(10);
      if (liveNativeBalance < estimatedFeeWei) {
        throw new Error(
          t("providerSettlements.gasEstimateInsufficient", {
            estimateFee: formatEther(estimatedFeeWei),
            balance: formatEther(liveNativeBalance),
            symbol,
          })
        );
      }
    }

    return {
      contractAddress,
      targetChainId: ticket.chainId || chainId,
    };
  };

  const startWalletWithdraw = async (
    withdrawalId: string,
    ticket: ProviderWithdrawTicket
  ) => {
    const { contractAddress, targetChainId } =
      await validateWalletWithdrawReadiness(ticket);

    const hash = await writeContractAsync({
      address: contractAddress,
      abi: SynapseCoreABI,
      chainId: targetChainId,
      functionName: "withdraw",
      args: [
        BigInt(ticket.amount),
        BigInt(ticket.fee),
        ticket.ticketId,
        BigInt(ticket.deadline),
        normalizeSignature(ticket.signature),
      ],
    });

    setActiveWithdrawalId(withdrawalId);
    setActiveTxChainId(targetChainId);
    toast.success(
      t("providerSettlements.txSubmitted", { hash: hash.slice(0, 10) })
    );
  };

  const resumePendingWithdraw = async () => {
    if (!pendingWithdrawal?.ticket) {
      toast.error(t("providerSettlements.noPendingTicket"));
      return;
    }
    try {
      await startWalletWithdraw(pendingWithdrawal.id, pendingWithdrawal.ticket);
    } catch (error) {
      showWithdrawWalletErrorToast(error, withdrawWalletErrorMessages);
    }
  };

  const isAnyLoading = creatingIntent || isWalletPrompting || isTxConfirming;
  const ticketSigningEnabled = Boolean(
    withdrawCapability?.ticketSigningEnabled
  );
  let generateClaimLabel = t("providerSettlements.signerUnavailable");
  if (ticketSigningEnabled) {
    generateClaimLabel = t("providerSettlements.generateAndClaim");
  }
  if (creatingIntent) {
    generateClaimLabel = t("providerSettlements.creatingTicket");
  }

  return (
    <div className="min-h-screen bg-[#000000]">
      <div className="mx-auto w-full max-w-[768px] px-4 pb-24 pt-12 sm:px-6 lg:px-0 text-white space-y-6">
        <div className="border-b border-[#222222] pb-5">
          <h1 className="text-3xl md:text-4xl font-[800] tracking-tight text-white flex items-center gap-3">
            <Wallet className="w-8 h-8 text-[#22c55e]" />
            {t("providerSettlements.withdrawPageTitle")}
          </h1>
          <p className="mt-2 text-sm text-[#86868b]">
            {t("providerSettlements.withdrawPageDescription")}
          </p>
        </div>

        <div className="rounded-[16px] border border-[#2f3336] bg-[#16181c] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="flex flex-col gap-4 rounded-[12px] border border-[#232323] bg-[#1a1a1a] p-4 md:min-h-[116px] md:flex-row md:items-center md:justify-between md:gap-6">
            <ProviderWithdrawBalanceSummary
              withdrawableLabel={t(
                "providerSettlements.withdrawableReceivable"
              )}
              receivableLabel={t("providerSettlements.receivableBalance")}
              immatureNotice={t("providerSettlements.immatureReceivableNotice")}
              minimumHint={t("providerSettlements.withdrawAmountHint", {
                amount: PROVIDER_WITHDRAW_MIN_USDC,
              })}
              availableReceivable={availableReceivable}
              receivableBalance={receivableBalance}
              hasImmatureReceivable={hasImmatureReceivable}
            />
            <div className="flex flex-wrap items-center self-start gap-2 md:self-auto">
              <div className="relative group">
                <button
                  type="button"
                  onClick={() => {
                    if (!isConnected) {
                      openConnectModal?.();
                      return;
                    }
                    setShowAmountInput((prev) => !prev);
                  }}
                  disabled={
                    !isConnected ||
                    compareMoneyStrings(availableReceivable, "0") <= 0 ||
                    matureReceivableBelowMinimum ||
                    isAnyLoading ||
                    !ticketSigningEnabled ||
                    loadingWithdrawCapability ||
                    !hasEnoughGas
                  }
                  title={
                    matureReceivableBelowMinimum
                      ? t(
                          "providerSettlements.matureReceivableBelowMinimumTitle"
                        )
                      : undefined
                  }
                  className="inline-flex h-[36px] min-w-[143px] items-center justify-center whitespace-nowrap rounded-full border border-[#2f3336] bg-transparent px-4 py-2 text-[14px] font-normal leading-[20px] text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {generateClaimLabel}
                </button>
                {!ticketSigningEnabled &&
                  !loadingWithdrawCapability &&
                  withdrawCapability && (
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-[220px] rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-xs text-[#f59e0b] shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                      {t("providerSettlements.ticketSigningUnavailable")}
                    </div>
                  )}
              </div>
              {pendingWithdrawal?.ticket &&
                pendingWithdrawal?.status === "APPROVED_AUTO" && (
                  <button
                    type="button"
                    onClick={resumePendingWithdraw}
                    disabled={
                      isAnyLoading ||
                      isWithdrawTicketNearExpiry(pendingWithdrawal.ticket)
                    }
                    className="inline-flex h-[36px] min-w-[143px] items-center justify-center whitespace-nowrap rounded-full bg-[#eff3f4] px-4 py-2 text-[14px] font-normal leading-[20px] text-[#0f141a] transition hover:bg-[#e7eaeb] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("providerSettlements.resumePending")}
                  </button>
                )}
            </div>
          </div>

          {/* ── Inline amount input (expands on Generate & Claim click) ── */}
          {showAmountInput && (
            <ProviderWithdrawAmountPanel
              value={withdrawAmountInput}
              availableReceivable={availableReceivable}
              isLoading={isAnyLoading}
              placeholder={t("providerSettlements.withdrawAmountPlaceholder")}
              confirmLabel={t("providerSettlements.confirmWithdraw")}
              gasNote={t("providerSettlements.withdrawGasNote", {
                amount: PROVIDER_WITHDRAW_MIN_USDC,
              })}
              validationMessage={withdrawAmountValidationMessage}
              onChange={setWithdrawAmountInput}
              onConfirm={handleCreateWithdrawalIntent}
            />
          )}
        </div>

        {/* ── Warnings below card ────────────────────────────── */}
        {pendingTicketChainMismatch && pendingTicket?.chainId && (
          <div className="rounded-xl border border-[#ff9f0a]/30 bg-[#ff9f0a]/10 px-4 py-3 text-sm text-[#ffd7a1]">
            {t("providerSettlements.pendingWrongNetwork", {
              requiredChain: formatChainLabel(pendingTicket.chainId, t),
              currentChain: formatChainLabel(chainId, t),
            })}
          </div>
        )}
        {pendingTicketExpired && (
          <div className="rounded-xl border border-[#ef4444]/30 bg-[#ef4444]/10 px-4 py-3 text-sm text-[#fecaca]">
            {t("providerSettlements.pendingTicketExpiredBanner")}
          </div>
        )}
        {!hasEnoughGas && isConnected && (
          <div className="rounded-xl border border-[#ff9f0a]/30 bg-[#ff9f0a]/10 px-4 py-3 text-sm text-[#ffd7a1]">
            {t("providerSettlements.insufficientGasWarning")}
          </div>
        )}

        <div className="text-right">
          <Link
            href="/provider/withdraw/history"
            className="text-sm text-[#22c55e] hover:text-[#86efac] transition-colors"
          >
            {t("providerSettlements.viewInvocationRecords")} →
          </Link>
        </div>

        <h2 className="text-xl font-semibold text-white">
          {t("providerSettlements.historyTitle")}
        </h2>

        <div className="flex flex-col gap-2 rounded-2xl border border-[#222222] bg-[#0a0a0a] p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <select
              value={withdrawalStatusFilter}
              onChange={(e) =>
                setWithdrawalStatusFilter(
                  e.target.value as WithdrawalHistoryStatusFilter
                )
              }
              className="inline-flex min-h-10 items-center rounded-lg border border-[#222222] bg-[#050505] px-3 py-2 text-sm text-white outline-none cursor-pointer [color-scheme:dark]"
            >
              {WITHDRAWAL_HISTORY_STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {status === "ALL"
                    ? t("providerSettlements.historyFilterAll")
                    : withdrawalStatusLabel(status, t)}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="min-h-10 rounded-lg border border-[#222222] bg-[#050505] px-3 py-2 text-sm text-white outline-none [color-scheme:dark]"
            />
            <span className="text-sm text-[#86868b]">–</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="min-h-10 rounded-lg border border-[#222222] bg-[#050505] px-3 py-2 text-sm text-white outline-none [color-scheme:dark]"
            />
          </div>
          <div className="flex items-center gap-2 lg:justify-end">
            <button
              onClick={() => void refreshWithdrawals()}
              className="rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 px-4 py-2 text-sm font-semibold text-[#22c55e] transition-colors hover:bg-[#22c55e] hover:text-black"
            >
              {t("providerSettlements.searchButton")}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-[1.5rem] border border-[#222222] bg-[#0a0a0a]">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="border-b border-[#222222] text-[10px] text-[#86868b] uppercase tracking-[0.2em] font-semibold bg-[#050505]">
                <th className="px-6 py-4">
                  {t("providerSettlements.historyTableWithdrawalId")}
                </th>
                <th className="px-6 py-4 text-right">
                  {t("providerSettlements.historyTableAmount")}
                </th>
                <th className="px-6 py-4">
                  {t("providerSettlements.historyTableStatus")}
                </th>
                <th className="px-6 py-4">
                  {t("providerSettlements.historyTableReason")}
                </th>
                <th className="px-6 py-4">
                  {t("providerSettlements.historyTableNonce")}
                </th>
                <th className="px-6 py-4">
                  {t("providerSettlements.historyTableCreated")}
                </th>
                <th className="px-6 py-4">
                  {t("providerSettlements.historyTableTxHash")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#151515]">
              {!loadingWithdrawals && filteredWithdrawals.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-10 text-center text-sm text-[#86868b]"
                  >
                    {withdrawalHistoryEmptyMessage}
                  </td>
                </tr>
              )}
              {loadingWithdrawals && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-10 text-center text-sm text-[#86868b]"
                  >
                    {t("providerSettlements.loadingHistory")}
                  </td>
                </tr>
              )}
              {filteredWithdrawals.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-[#111111] transition-colors"
                >
                  <td className="py-4 px-6 text-xs font-mono text-[#86868b]">
                    <CopyableValue
                      value={row.id}
                      label={t("providerSettlements.historyTableWithdrawalId")}
                      valueClassName="font-mono text-xs text-[#86868b]"
                      startChars={14}
                      endChars={8}
                    />
                  </td>
                  <td className="px-6 py-4 font-mono text-sm text-right text-white">
                    {formatMoneyString(row.amountUsdc, 6)} USDC
                  </td>
                  <td className="px-6 py-4 text-xs">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${withdrawalStatusBadgeClass(
                        row.status
                      )}`}
                    >
                      {withdrawalStatusLabel(row.status, t)}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-xs text-[#c5c5c7]">
                    {withdrawalHistoryReasonLabel(row.status, t)}
                  </td>
                  <td className="py-4 px-6 text-xs font-mono text-[#c5c5c7]">
                    <CopyableValue
                      value={row.nonce ? String(row.nonce) : ""}
                      label={t("providerSettlements.historyTableNonce")}
                      valueClassName="font-mono text-xs text-[#c5c5c7]"
                    />
                  </td>
                  <td className="py-4 px-6 text-xs text-[#86868b]">
                    {formatTimestamp(row.createdAt, locale)}
                  </td>
                  <td className="py-4 px-6 text-xs font-mono text-[#86868b]">
                    <CopyableValue
                      value={row.txHash}
                      label={t("providerSettlements.historyTableTxHash")}
                      valueClassName="font-mono text-xs text-[#86868b]"
                      startChars={10}
                      endChars={8}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
