"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Database,
  ReceiptText,
  Activity,
  Wallet,
  Loader2,
  Info,
} from "lucide-react";
import { formatEther, formatUnits, parseUnits } from "viem";
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
import { useLanguage } from "@/components/i18n/LanguageProvider";
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
  normalizeWithdrawWalletError,
  toSafeErrorMessage,
} from "@/utils/providerWithdrawWallet";

const VAULT_ADDRESS = (contractConfig as { SynapseCore?: string })
  .SynapseCore as `0x${string}` | undefined;
const USDC_TOKEN_ADDRESS = (contractConfig as { MockUSDC?: string })
  .MockUSDC as `0x${string}` | undefined;
const WITHDRAW_AMOUNT_INPUT_PATTERN = /^\d*(?:\.\d{0,2})?$/;
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

function formatTimestamp(seconds?: number | string, locale?: string): string {
  if (!seconds) return "-";
  const numSeconds =
    typeof seconds === "string" ? Number.parseInt(seconds, 10) : seconds;
  if (Number.isNaN(numSeconds)) return "-";
  return new Date(numSeconds * 1000).toLocaleString(locale);
}

function normalizeSignature(signature: string): `0x${string}` {
  const normalized = signature.startsWith("0x") ? signature : `0x${signature}`;
  return normalized as `0x${string}`;
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

function formatChainLabel(chainId: number | undefined, t: TranslateFn): string {
  if (!chainId || !Number.isFinite(chainId))
    return t("providerSettlements.chainRequiredNetwork");
  return CHAIN_LABELS[chainId] || `chain ${chainId}`;
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
  if (!WITHDRAW_AMOUNT_INPUT_PATTERN.test(requestedAmount)) {
    return t("providerSettlements.invalidAmountPrecision");
  }

  const normalizedAmount = normalizeMoneyString(requestedAmount, "");
  if (!normalizedAmount || normalizedAmount === "0") {
    return t("providerSettlements.invalidAmountValue");
  }

  if (compareMoneyStrings(normalizedAmount, availableReceivable) > 0) {
    return t("providerSettlements.amountExceedsAvailable", {
      amount: formatMoneyString(availableReceivable, 6),
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
    return t("providerSettlements.withdrawalCreateFailed");
  }

  return t("providerSettlements.withdrawalCreateFailed");
}

export default function ProviderSettlementsPage() {
  const {
    providerStats,
    paidEvents,
    handleRefresh: reloadDashboard,
  } = useDashboardData();
  const { t, lang } = useLanguage();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const chainId = useChainId();
  const publicClient = usePublicClient();

  const [requestInput, setRequestInput] = useState("");
  const [serviceInput, setServiceInput] = useState("");
  const [requestQuery, setRequestQuery] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const [page, setPage] = useState(1);
  const [withdrawAmountInput, setWithdrawAmountInput] = useState("");
  const [creatingIntent, setCreatingIntent] = useState(false);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);
  const [withdrawals, setWithdrawals] = useState<ProviderWithdrawRecord[]>([]);
  const [withdrawalStatusFilter, setWithdrawalStatusFilter] =
    useState<WithdrawalHistoryStatusFilter>("ALL");
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
  const [estimatedWithdrawGasFee, setEstimatedWithdrawGasFee] = useState<
    string | null
  >(null);
  const locale = lang === "zh" ? "zh-CN" : "en-US";

  const withdrawWalletErrorMessages = useMemo(
    () => ({
      fallback: t("providerSettlements.withdrawalCreateFailed"),
      walletRejected: t("providerSettlements.walletRejected"),
      insufficientNativeGas: t("providerSettlements.insufficientNativeGas"),
      ticketExpired: t("providerSettlements.ticketExpired"),
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

  const PAGE_SIZE = 10;
  const availableReceivable = normalizeMoneyString(providerStats.receivable);

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
    if (withdrawalStatusFilter === "ALL") {
      return withdrawals;
    }
    return withdrawals.filter((row) => row.status === withdrawalStatusFilter);
  }, [withdrawalStatusFilter, withdrawals]);
  const withdrawalHistoryEmptyMessage = useMemo(() => {
    if (withdrawals.length === 0 || withdrawalStatusFilter === "ALL") {
      return t("providerSettlements.historyEmpty");
    }
    return t("providerSettlements.historyFilteredEmpty", {
      status: withdrawalStatusLabel(withdrawalStatusFilter, t),
    });
  }, [t, withdrawalStatusFilter, withdrawals.length]);
  const lockedReceivable = normalizeMoneyString(pendingWithdrawal?.amountUsdc);
  const pendingTicket = pendingWithdrawal?.ticket;
  const pendingTicketChainMismatch = Boolean(
    pendingTicket?.chainId && chainId !== pendingTicket.chainId
  );
  const pendingTicketExpired = Boolean(
    pendingTicket?.deadline &&
      pendingTicket.deadline < Math.floor(Date.now() / 1000)
  );
  const nativeGasWarning = useMemo(() => {
    if (!isConnected || !nativeBalanceData) return null;
    if (nativeBalanceData.value > BigInt(0)) return null;
    return t("providerSettlements.walletNoGas", {
      symbol:
        nativeBalanceData.symbol ||
        t("providerSettlements.nativeTokenFallback"),
      chainLabel: formatChainLabel(chainId, t),
    });
  }, [chainId, isConnected, nativeBalanceData, t]);
  const walletGasGuidance = useMemo(() => {
    if (!isConnected) {
      return t("providerSettlements.walletPaysGasDisconnected");
    }

    const symbol =
      nativeBalanceData?.symbol || t("providerSettlements.nativeTokenFallback");
    const balanceText = nativeBalanceData
      ? `${Number(
          formatUnits(nativeBalanceData.value, nativeBalanceData.decimals)
        ).toFixed(6)} ${symbol}`
      : `an available ${symbol} balance`;
    return t("providerSettlements.walletPaysGasConnected", {
      symbol,
      balance: balanceText,
      estimate: estimatedWithdrawGasFee
        ? t("providerSettlements.walletPaysGasEstimate", {
            estimate: estimatedWithdrawGasFee,
          })
        : "",
    });
  }, [estimatedWithdrawGasFee, isConnected, nativeBalanceData, t]);

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
    toast.error(
      normalizeWithdrawWalletError(txReceiptError, withdrawWalletErrorMessages)
    );
    setActiveWithdrawalId(null);
    setActiveTxChainId(undefined);
  }, [
    activeWithdrawalId,
    isTxFailed,
    txHash,
    txReceiptError,
    withdrawWalletErrorMessages,
  ]);

  useEffect(() => {
    setEstimatedWithdrawGasFee(null);
  }, [address, chainId]);

  const applySearch = () => {
    setRequestQuery(requestInput);
    setServiceQuery(serviceInput);
    setPage(1);
  };

  const handleSearch = () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    applySearch();
  };

  const filtered = useMemo(() => {
    const rq = requestQuery.trim().toLowerCase();
    const sq = serviceQuery.trim().toLowerCase();
    return paidEvents.filter((event) => {
      const matchesRequest = !rq || event.txHash.toLowerCase().includes(rq);
      const matchesService =
        !sq || (event.serviceId || "").toLowerCase().includes(sq);
      return matchesRequest && matchesService;
    });
  }, [paidEvents, requestQuery, serviceQuery]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

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
        toast.error(
          normalizeWithdrawWalletError(error, withdrawWalletErrorMessages)
        );
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
    if (!withdrawCapability?.ticketSigningEnabled) {
      toast.error(t("providerSettlements.ticketSigningUnavailable"));
      return;
    }

    const requestedAmount = withdrawAmountInput.trim();
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

    const amountUsdc = resolveRequestedWithdrawAmount() ?? availableReceivable;

    try {
      await validateWithdrawIntentReadiness(amountUsdc);
    } catch (error) {
      toast.error(
        normalizeWithdrawWalletError(error, withdrawWalletErrorMessages)
      );
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
        toast.success(
          intent.message || t("providerSettlements.manualReviewQueued"),
          { id: toastId }
        );
      } else if (intent.ticket) {
        try {
          await startWalletWithdraw(intent.withdrawalId, intent.ticket);
          toast.success(t("providerSettlements.ticketGenerated"), {
            id: toastId,
          });
        } catch (error) {
          toast.error(
            normalizeWithdrawWalletError(error, withdrawWalletErrorMessages),
            { id: toastId }
          );
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
      setEstimatedWithdrawGasFee(`${formatEther(estimatedFeeWei)} ${symbol}`);
      if (liveNativeBalance < estimatedFeeWei) {
        throw new Error(
          t("providerSettlements.gasEstimateInsufficient", {
            estimateFee: formatEther(estimatedFeeWei),
            balance: formatEther(liveNativeBalance),
            symbol,
          })
        );
      }
    } else {
      setEstimatedWithdrawGasFee(null);
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
      toast.error(
        normalizeWithdrawWalletError(error, withdrawWalletErrorMessages)
      );
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
  let txStateLabel = "-";
  if (isWalletPrompting) {
    txStateLabel = t("providerSettlements.txStateWalletPrompt");
  }
  if (isTxConfirming) {
    txStateLabel = t("providerSettlements.txStateConfirming");
  }
  if (isTxFailed) {
    txStateLabel = t("providerSettlements.txStateFailed");
  }

  return (
    <div className="p-6 md:p-10 mx-auto max-w-7xl text-white bg-[#000000] min-h-screen space-y-6">
      <div className="border-b border-[#222222] pb-5">
        <h1 className="text-3xl md:text-4xl font-[800] tracking-tight text-white flex items-center gap-3">
          <Database className="w-8 h-8 text-[#22c55e]" />
          {t("providerSettlements.title")}
        </h1>
        <p className="mt-2 text-sm text-[#86868b]">
          {t("providerSettlements.description")}
          <span
            className="inline-block ml-1 align-text-bottom cursor-help"
            title={t("providerSettlements.descriptionTip")}
          >
            <Info className="w-3.5 h-3.5 text-[#555]" />
          </span>
        </p>
      </div>

      <div>
        <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[#86868b]">
            <Wallet className="w-4 h-4" />
            {t("providerSettlements.providerWithdrawalEyebrow")}
          </div>
          <h2 className="mt-3 text-xl font-semibold text-white">
            {t("providerSettlements.withdrawalTitle")}
          </h2>
          {!loadingWithdrawCapability &&
            withdrawCapability &&
            !ticketSigningEnabled && (
              <div className="mt-4 rounded-xl border border-[#ff9f0a]/30 bg-[#ff9f0a]/10 px-4 py-3 text-sm text-[#ffd7a1]">
                {t("providerSettlements.ticketSigningUnavailable")}
              </div>
            )}
          {pendingTicketChainMismatch && pendingTicket?.chainId && (
            <div className="mt-4 rounded-xl border border-[#ff9f0a]/30 bg-[#ff9f0a]/10 px-4 py-3 text-sm text-[#ffd7a1]">
              {t("providerSettlements.pendingWrongNetwork", {
                requiredChain: formatChainLabel(pendingTicket.chainId, t),
                currentChain: formatChainLabel(chainId, t),
              })}
            </div>
          )}
          {!pendingTicketChainMismatch && nativeGasWarning && (
            <div className="mt-4 rounded-xl border border-[#ff9f0a]/30 bg-[#ff9f0a]/10 px-4 py-3 text-sm text-[#ffd7a1]">
              {nativeGasWarning}
            </div>
          )}
          <div className="mt-4 rounded-xl border border-[#22c55e]/20 bg-[#22c55e]/[0.06] px-4 py-3 text-sm text-[#d9ffe7] flex items-center gap-1">
            <span>{walletGasGuidance}</span>
            <span
              className="shrink-0 cursor-help"
              title={t("providerSettlements.walletGasTip")}
            >
              <Info className="w-3.5 h-3.5 text-[#22c55e]/50" />
            </span>
          </div>
          {pendingTicketExpired && (
            <div className="mt-4 rounded-xl border border-[#ef4444]/30 bg-[#ef4444]/10 px-4 py-3 text-sm text-[#fecaca]">
              {t("providerSettlements.pendingTicketExpiredBanner")}
            </div>
          )}

          <div className="mt-5 flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              inputMode="decimal"
              value={withdrawAmountInput}
              onChange={(e) => {
                const nextValue = e.target.value;
                if (
                  nextValue === "" ||
                  WITHDRAW_AMOUNT_INPUT_PATTERN.test(nextValue)
                ) {
                  setWithdrawAmountInput(nextValue);
                }
              }}
              placeholder={`${formatMoneyString(availableReceivable, 6)} USDC`}
              className={`w-full sm:max-w-md px-3 py-2 rounded-lg border bg-[#050505] text-sm text-white outline-none placeholder:text-[#86868b] ${
                withdrawAmountValidationMessage
                  ? "border-[#ef4444] focus:border-[#ef4444]"
                  : "border-[#222222]"
              }`}
              disabled={isAnyLoading}
            />
            <button
              onClick={handleCreateWithdrawalIntent}
              disabled={
                !isConnected ||
                compareMoneyStrings(availableReceivable, "0") <= 0 ||
                isAnyLoading ||
                !ticketSigningEnabled ||
                loadingWithdrawCapability ||
                Boolean(withdrawAmountValidationMessage)
              }
              className="px-4 py-2 rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e] text-sm font-semibold hover:bg-[#22c55e] hover:text-black transition-colors disabled:opacity-40"
            >
              {generateClaimLabel}
            </button>
            <button
              onClick={resumePendingWithdraw}
              disabled={
                !pendingWithdrawal?.ticket ||
                pendingWithdrawal?.status !== "APPROVED_AUTO" ||
                isAnyLoading ||
                isWithdrawTicketNearExpiry(pendingWithdrawal.ticket)
              }
              className="px-4 py-2 rounded-lg border border-[#222222] bg-[#111111] text-white text-sm font-semibold hover:bg-[#1a1a1a] transition-colors disabled:opacity-40"
            >
              {t("providerSettlements.resumePending")}
            </button>
          </div>
          {withdrawAmountValidationMessage && (
            <p className="mt-3 text-xs text-[#f87171]">
              {withdrawAmountValidationMessage}
            </p>
          )}

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
            <div className="rounded-lg border border-[#222222] bg-[#050505] p-3">
              <div className="uppercase tracking-[0.15em] text-[#86868b]">
                {t("providerSettlements.metricAvailable")}
              </div>
              <div className="mt-1 font-mono text-white text-sm">
                {formatMoneyString(availableReceivable, 6)} USDC
              </div>
            </div>
            <div className="rounded-lg border border-[#222222] bg-[#050505] p-3">
              <div className="uppercase tracking-[0.15em] text-[#86868b]">
                {t("providerSettlements.metricPendingLocked")}
              </div>
              <div className="mt-1 font-mono text-[#ff9f0a] text-sm">
                {formatMoneyString(lockedReceivable, 6)} USDC
              </div>
            </div>
            <div className="rounded-lg border border-[#222222] bg-[#050505] p-3">
              <div className="uppercase tracking-[0.15em] text-[#86868b]">
                {t("providerSettlements.metricPendingTicket")}
              </div>
              <div className="mt-1 font-mono text-white text-sm">
                {pendingWithdrawal ? pendingWithdrawal.id.slice(0, 10) : "0"}
              </div>
            </div>
            <div className="rounded-lg border border-[#222222] bg-[#050505] p-3">
              <div className="uppercase tracking-[0.15em] text-[#86868b]">
                {t("providerSettlements.metricTxState")}
              </div>
              <div className="mt-1 font-mono text-white text-sm flex items-center gap-2">
                {(isWalletPrompting || isTxConfirming) && (
                  <Loader2 className="w-3 h-3 animate-spin" />
                )}
                {txStateLabel}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-3 flex flex-col lg:flex-row lg:items-center gap-2">
        <input
          value={requestInput}
          onChange={(e) => setRequestInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSearch();
            }
          }}
          placeholder={t("providerSettlements.searchRequestPlaceholder")}
          className="px-3 py-2 rounded-lg border border-[#222222] bg-[#050505] text-sm text-white outline-none placeholder:text-[#86868b] w-full lg:w-[320px]"
        />
        <input
          value={serviceInput}
          onChange={(e) => setServiceInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSearch();
            }
          }}
          placeholder={t("providerSettlements.searchServicePlaceholder")}
          className="px-3 py-2 rounded-lg border border-[#222222] bg-[#050505] text-sm text-white outline-none placeholder:text-[#86868b] w-full lg:w-[320px]"
        />
        <button
          onClick={handleSearch}
          className="px-4 py-2 rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e] text-sm font-semibold hover:bg-[#22c55e] hover:text-black transition-colors lg:ml-auto"
        >
          {t("providerSettlements.searchButton")}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">
            {t("providerSettlements.summaryNetEarned")}
          </div>
          <div className="text-2xl font-mono font-bold text-white">
            {providerStats.netEarned.toFixed(4)} USDC
          </div>
        </div>
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">
            {t("providerSettlements.summaryGrossEarnings")}
          </div>
          <div className="text-2xl font-mono font-bold text-white">
            {providerStats.totalEarned.toFixed(4)} USDC
          </div>
        </div>
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">
            {t("providerSettlements.summaryProtocolFee")}
          </div>
          <div className="text-2xl font-mono font-bold text-[#ff9f0a]">
            {providerStats.totalFees.toFixed(4)} USDC
          </div>
        </div>
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">
            {t("providerSettlements.summaryRoutingTax")}
          </div>
          <div className="text-2xl font-mono font-bold text-[#22c55e]">
            {providerStats.totalRoutingTax.toFixed(4)} USDC
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[1.5rem] border border-[#222222] bg-[#0a0a0a]">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-[#222222] text-[10px] text-[#86868b] uppercase tracking-[0.2em] font-semibold bg-[#050505]">
              <th className="py-5 px-6">
                {t("providerSettlements.eventsTableRequestId")}
              </th>
              <th className="py-5 px-6">
                {t("providerSettlements.eventsTableService")}
              </th>
              <th className="py-5 px-6 text-right">
                {t("providerSettlements.eventsTableGross")}
              </th>
              <th className="py-5 px-6 text-right">
                {t("providerSettlements.eventsTableProtocolFee")}
              </th>
              <th className="py-5 px-6 text-right">
                {t("providerSettlements.eventsTableRoutingTax")}
              </th>
              <th className="py-5 px-6 text-right">
                {t("providerSettlements.eventsTableNet")}
              </th>
              <th className="py-5 px-6 text-right">
                {t("providerSettlements.eventsTableCallTime")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515]">
            {pageRows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="py-14 text-center text-sm text-[#86868b]"
                >
                  {t("providerSettlements.eventsTableEmpty")}
                </td>
              </tr>
            )}
            {pageRows.map((event) => (
              <tr
                key={event.txHash + String(event.blockNumber)}
                className="hover:bg-[#111111] transition-colors"
              >
                <td className="py-4 px-6 text-xs font-mono text-[#86868b]">
                  <CopyableValue
                    value={event.txHash}
                    label={t("providerSettlements.eventsTableRequestId")}
                    valueClassName="font-mono text-xs text-[#86868b]"
                    startChars={10}
                    endChars={8}
                  />
                </td>
                <td className="py-4 px-6 text-sm font-semibold text-white">
                  <CopyableValue
                    value={event.serviceId}
                    label={t("providerSettlements.eventsTableService")}
                    valueClassName="text-sm font-semibold text-white"
                    emptyValue={t("providerSettlements.unknownService")}
                    startChars={18}
                    endChars={8}
                  />
                </td>
                <td className="py-4 px-6 text-sm text-right font-mono text-white">
                  {event.amount.toFixed(4)}
                </td>
                <td className="py-4 px-6 text-sm text-right font-mono text-[#ff9f0a]">
                  {event.fee.toFixed(4)}
                </td>
                <td className="py-4 px-6 text-sm text-right font-mono text-[#22c55e]">
                  {event.routingTax.toFixed(4)}
                </td>
                <td className="py-4 px-6 text-sm text-right font-mono text-white">
                  {(event.amount - event.fee).toFixed(4)}
                </td>
                <td className="py-4 px-6 text-xs text-right text-[#86868b]">
                  {formatTimestamp(event.timestamp, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-[1.5rem] border border-[#222222] bg-[#0a0a0a]">
        <div className="flex flex-col gap-3 border-b border-[#222222] bg-[#050505] px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b]">
              {t("providerSettlements.historyTitle")}
            </div>
            <div className="mt-1 text-sm text-[#c5c5c7]">
              {t("providerSettlements.historyDescription")}
              <span
                className="inline-block ml-1 align-text-bottom cursor-help"
                title={t("providerSettlements.historyDescriptionTip")}
              >
                <Info className="w-3 h-3 text-[#555]" />
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {WITHDRAWAL_HISTORY_STATUS_FILTERS.map((status) => {
              const isActive = withdrawalStatusFilter === status;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => setWithdrawalStatusFilter(status)}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                    isActive
                      ? "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#86efac]"
                      : "border-[#222222] bg-[#0a0a0a] text-[#86868b] hover:border-[#3a3a3a] hover:text-white"
                  }`}
                >
                  {status === "ALL"
                    ? t("providerSettlements.historyFilterAll")
                    : withdrawalStatusLabel(status, t)}
                </button>
              );
            })}
          </div>
        </div>
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-[#222222] text-[10px] text-[#86868b] uppercase tracking-[0.2em] font-semibold bg-[#050505]">
              <th className="py-4 px-6">
                {t("providerSettlements.historyTableWithdrawalId")}
              </th>
              <th className="py-4 px-6 text-right">
                {t("providerSettlements.historyTableAmount")}
              </th>
              <th className="py-4 px-6">
                {t("providerSettlements.historyTableStatus")}
              </th>
              <th className="py-4 px-6">
                {t("providerSettlements.historyTableReason")}
              </th>
              <th className="py-4 px-6">
                {t("providerSettlements.historyTableNonce")}
              </th>
              <th className="py-4 px-6">
                {t("providerSettlements.historyTableCreated")}
              </th>
              <th className="py-4 px-6">
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
              <tr key={row.id} className="hover:bg-[#111111] transition-colors">
                <td className="py-4 px-6 text-xs font-mono text-[#86868b]">
                  <CopyableValue
                    value={row.id}
                    label={t("providerSettlements.historyTableWithdrawalId")}
                    valueClassName="font-mono text-xs text-[#86868b]"
                    startChars={14}
                    endChars={8}
                  />
                </td>
                <td className="py-4 px-6 text-sm text-right font-mono text-white">
                  {formatMoneyString(row.amountUsdc, 6)} USDC
                </td>
                <td className="py-4 px-6 text-xs">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${withdrawalStatusBadgeClass(
                      row.status
                    )}`}
                  >
                    {withdrawalStatusLabel(row.status, t)}
                  </span>
                </td>
                <td className="py-4 px-6 text-xs text-[#c5c5c7]">
                  {row.message ||
                    (row.status === "CANCELLED" ||
                    row.status === "FAILED_EXPIRED"
                      ? t("providerSettlements.expiredTicketReleasedRow")
                      : "-")}
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

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-[#86868b]">
        <div>
          {t("providerSettlements.paginationShowing", {
            start: (safePage - 1) * PAGE_SIZE + (filtered.length ? 1 : 0),
            end: Math.min(safePage * PAGE_SIZE, filtered.length),
            total: filtered.length,
          })}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#0a0a0a] disabled:opacity-40"
          >
            {t("providerSettlements.paginationPrev")}
          </button>
          <span className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#050505] text-white">
            {safePage} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={safePage >= pageCount}
            className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#0a0a0a] disabled:opacity-40"
          >
            {t("providerSettlements.paginationNext")}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[#222222] bg-[#0a0a0a] p-4 text-xs text-[#86868b] flex items-center gap-2">
        <ReceiptText className="w-4 h-4 text-[#22c55e]" />
        <span>
          {t("providerSettlements.dedupeNote")}
          <span
            className="inline-block ml-1 align-text-bottom cursor-help"
            title={t("providerSettlements.dedupeNoteTip")}
          >
            <Info className="w-3 h-3 text-[#555]" />
          </span>
        </span>
        <Activity className="w-4 h-4 text-[#86868b] ml-auto" />
      </div>
    </div>
  );
}
