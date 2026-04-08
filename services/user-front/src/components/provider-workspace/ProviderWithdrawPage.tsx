"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet, Loader2, Info } from "lucide-react";
import { formatEther, formatUnits, parseUnits } from "viem";
import { useAccount, useBalance, useChainId, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import toast from "react-hot-toast";
import Link from "next/link";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useDashboardData } from "@/hooks/useDashboardData";
import SynapseCoreABI from "@/SynapseCoreABI.json";
import contractConfig from "@/contract-config.json";
import {
  completeProviderWithdrawal,
  createProviderWithdrawIntent,
  getProviderWithdrawCapability,
  ProviderWithdrawApiError,
  type ProviderWithdrawCapability,
  listProviderWithdrawals,
  type ProviderWithdrawRecord,
  type ProviderWithdrawTicket,
} from "@/utils/providerWithdrawApi";
import { normalizeWithdrawWalletError, toSafeErrorMessage } from "@/utils/providerWithdrawWallet";

const VAULT_ADDRESS = (contractConfig as { SynapseCore?: string }).SynapseCore as `0x${string}` | undefined;
const USDC_TOKEN_ADDRESS = (contractConfig as { MockUSDC?: string }).MockUSDC as `0x${string}` | undefined;
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

type TranslateFn = (key: string, vars?: Record<string, string | number>, fallbackText?: string) => string;

function normalizeSignature(signature: string): `0x${string}` {
  const normalized = signature.startsWith("0x") ? signature : `0x${signature}`;
  return normalized as `0x${string}`;
}

function formatChainLabel(chainId: number | undefined, t: TranslateFn): string {
  if (!chainId || !Number.isFinite(chainId)) return t("providerSettlements.chainRequiredNetwork");
  return CHAIN_LABELS[chainId] || `chain ${chainId}`;
}

function resolveTicketContractAddress(ticket: ProviderWithdrawTicket): `0x${string}` | undefined {
  const contractAddress = String(ticket.contractAddress || VAULT_ADDRESS || "").trim();
  return contractAddress ? (contractAddress as `0x${string}`) : undefined;
}

function validateRequestedWithdrawAmount(
  requestedAmount: string,
  availableReceivable: number,
  t: TranslateFn,
): string | null {
  if (!requestedAmount) {
    return null;
  }
  if (!WITHDRAW_AMOUNT_INPUT_PATTERN.test(requestedAmount)) {
    return t("providerSettlements.invalidAmountPrecision");
  }

  const parsed = Number(requestedAmount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return t("providerSettlements.invalidAmountValue");
  }

  if (parsed > availableReceivable) {
    return t("providerSettlements.amountExceedsAvailable", {
      amount: availableReceivable.toFixed(6),
    });
  }

  return null;
}

function resolveCreateWithdrawalIntentErrorMessage(
  error: unknown,
  t: TranslateFn,
): string {
  if (error instanceof ProviderWithdrawApiError) {
    if (error.code === "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE") {
      return t("providerSettlements.vaultLiquidityCheckUnavailable");
    }
    if (error.code === "CHAIN_RPC_UNAVAILABLE") {
      return t("providerSettlements.chainRpcUnavailable");
    }
  }

  return error instanceof Error ? error.message : t("providerSettlements.withdrawalCreateFailed");
}

export default function ProviderWithdrawPage() {
  const { providerStats, handleRefresh: reloadDashboard } = useDashboardData();
  const { t } = useLanguage();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const chainId = useChainId();
  const publicClient = usePublicClient();

  const [withdrawAmountInput, setWithdrawAmountInput] = useState("");
  const [creatingIntent, setCreatingIntent] = useState(false);
  const [withdrawals, setWithdrawals] = useState<ProviderWithdrawRecord[]>([]);
  const [activeWithdrawalId, setActiveWithdrawalId] = useState<string | null>(null);
  const [activeTxChainId, setActiveTxChainId] = useState<number | undefined>(undefined);
  const [withdrawCapability, setWithdrawCapability] = useState<ProviderWithdrawCapability | null>(null);
  const [loadingWithdrawCapability, setLoadingWithdrawCapability] = useState(false);
  const [estimatedWithdrawGasFee, setEstimatedWithdrawGasFee] = useState<string | null>(null);

  const withdrawWalletErrorMessages = useMemo(() => ({
    fallback: t("providerSettlements.withdrawalCreateFailed"),
    walletRejected: t("providerSettlements.walletRejected"),
    insufficientNativeGas: t("providerSettlements.insufficientNativeGas"),
    ticketExpired: t("providerSettlements.ticketExpired"),
    staleTicket: t("providerSettlements.staleTicket"),
    invalidSignature: t("providerSettlements.invalidSignature"),
    vaultLiquidityInsufficient: t("providerSettlements.vaultLiquidityInsufficient"),
    vaultAllowanceUnavailable: t("providerSettlements.vaultAllowanceUnavailable"),
    contractRejectedWithName: (name: string) => t("providerSettlements.contractRejectedWithName", { name }),
    contractRejectedWithReason: (reason: string) => t("providerSettlements.contractRejectedWithReason", { reason }),
  }), [t]);

  const availableReceivable = Number(providerStats.receivable || 0);

  const { data: nativeBalanceData } = useBalance({ address });
  const { data: txHash, writeContractAsync, isPending: isWalletPrompting } = useWriteContract();
  const {
    isLoading: isTxConfirming,
    isSuccess: isTxConfirmed,
    isError: isTxFailed,
    error: txReceiptError,
  } = useWaitForTransactionReceipt({ hash: txHash, chainId: activeTxChainId });

  const pendingWithdrawal = useMemo(
    () =>
      withdrawals.find((row) =>
        ["REQUESTED", "APPROVED_AUTO", "PENDING_MANUAL_REVIEW"].includes(row.status)
      ) || null,
    [withdrawals]
  );
  const lockedReceivable = Number(pendingWithdrawal?.amountUsdc || 0);
  const pendingTicket = pendingWithdrawal?.ticket;
  const pendingTicketChainMismatch = Boolean(pendingTicket?.chainId && chainId !== pendingTicket.chainId);
  const pendingTicketExpired = Boolean(
    pendingTicket?.deadline && pendingTicket.deadline < Math.floor(Date.now() / 1000),
  );
  const nativeGasWarning = useMemo(() => {
    if (!isConnected || !nativeBalanceData) return null;
    if (nativeBalanceData.value > BigInt(0)) return null;
    return t("providerSettlements.walletNoGas", {
      symbol: nativeBalanceData.symbol || t("providerSettlements.nativeTokenFallback"),
      chainLabel: formatChainLabel(chainId, t),
    });
  }, [chainId, isConnected, nativeBalanceData, t]);
  const walletGasGuidance = useMemo(() => {
    if (!isConnected) {
      return t("providerSettlements.walletPaysGasDisconnected");
    }

    const symbol = nativeBalanceData?.symbol || t("providerSettlements.nativeTokenFallback");
    const balanceText = nativeBalanceData
      ? `${Number(formatUnits(nativeBalanceData.value, nativeBalanceData.decimals)).toFixed(6)} ${symbol}`
      : `an available ${symbol} balance`;
    return t("providerSettlements.walletPaysGasConnected", {
      symbol,
      balance: balanceText,
      estimate: estimatedWithdrawGasFee
        ? t("providerSettlements.walletPaysGasEstimate", { estimate: estimatedWithdrawGasFee })
        : "",
    });
  }, [estimatedWithdrawGasFee, isConnected, nativeBalanceData, t]);

  const refreshWithdrawals = useCallback(async () => {
    if (!address) return;
    try {
      const rows = await listProviderWithdrawals(address);
      setWithdrawals(rows);
    } catch (error) {
      console.error("Failed to load provider withdrawals", error);
      toast.error(toSafeErrorMessage(error, t("providerSettlements.loadHistoryFailed")));
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
    toast.error(normalizeWithdrawWalletError(txReceiptError, withdrawWalletErrorMessages));
    setActiveWithdrawalId(null);
    setActiveTxChainId(undefined);
  }, [activeWithdrawalId, isTxFailed, txHash, txReceiptError, withdrawWalletErrorMessages]);

  useEffect(() => {
    setEstimatedWithdrawGasFee(null);
  }, [address, chainId]);

  const withdrawAmountValidationMessage = useMemo(() => {
    return validateRequestedWithdrawAmount(withdrawAmountInput.trim(), availableReceivable, t);
  }, [availableReceivable, t, withdrawAmountInput]);

  const resolveRequestedWithdrawAmount = (): number | undefined => {
    const requestedAmount = withdrawAmountInput.trim();
    return requestedAmount ? Number(requestedAmount) : undefined;
  };

  const validateWithdrawIntentReadiness = async (amountUsdc: number): Promise<void> => {
    if (!publicClient) {
      throw new Error(t("providerSettlements.walletClientUnavailable"));
    }
    if (!USDC_TOKEN_ADDRESS || !VAULT_ADDRESS) {
      throw new Error(t("providerSettlements.vaultLiquidityInsufficient"));
    }

    const requestedAmountWei = parseUnits(amountUsdc.toFixed(6), 18);
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
    if (pendingWithdrawal.status === "APPROVED_AUTO" && pendingWithdrawal.ticket) {
      try {
        await startWalletWithdraw(pendingWithdrawal.id, pendingWithdrawal.ticket);
      } catch (error) {
        toast.error(normalizeWithdrawWalletError(error, withdrawWalletErrorMessages));
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
      toast.error(
        withdrawCapability?.message ||
          t("providerSettlements.ticketSigningUnavailable"),
      );
      return;
    }

    const requestedAmount = withdrawAmountInput.trim();
    const validationMessage = validateRequestedWithdrawAmount(requestedAmount, availableReceivable, t);
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
      toast.error(normalizeWithdrawWalletError(error, withdrawWalletErrorMessages));
      return;
    }

    setCreatingIntent(true);
    const toastId = toast.loading(t("providerSettlements.generatingTicket"));
    try {
      const intent = await createProviderWithdrawIntent(address, amountUsdc);
      await Promise.all([refreshWithdrawals(), refreshWithdrawCapability(), reloadDashboard()]);
      setWithdrawAmountInput("");

      if (intent.status === "PENDING_MANUAL_REVIEW") {
        toast.success(intent.message || t("providerSettlements.manualReviewQueued"), { id: toastId });
      } else if (intent.ticket) {
        try {
          await startWalletWithdraw(intent.withdrawalId, intent.ticket);
          toast.success(t("providerSettlements.ticketGenerated"), { id: toastId });
        } catch (error) {
          toast.error(normalizeWithdrawWalletError(error, withdrawWalletErrorMessages), { id: toastId });
        }
      } else {
        toast.success(t("providerSettlements.withdrawalIntentCreated"), { id: toastId });
      }
    } catch (error) {
      const message = resolveCreateWithdrawalIntentErrorMessage(error, t);
      toast.error(message, { id: toastId });
    } finally {
      setCreatingIntent(false);
    }
  };

  const validateWalletWithdrawReadiness = async (ticket: ProviderWithdrawTicket): Promise<{
    contractAddress: `0x${string}`;
    targetChainId?: number;
  }> => {
    const contractAddress = resolveTicketContractAddress(ticket);
    if (!contractAddress) {
      throw new Error(t("providerSettlements.withdrawalContractMissing"));
    }

    if (ticket.chainId && chainId !== ticket.chainId) {
      throw new Error(
        t("providerSettlements.wrongNetwork", { chainLabel: formatChainLabel(ticket.chainId, t) }),
      );
    }

    if (ticket.deadline && ticket.deadline < Math.floor(Date.now() / 1000)) {
      throw new Error(t("providerSettlements.ticketExpired"));
    }

    const symbol = nativeBalanceData?.symbol || t("providerSettlements.nativeTokenFallback");
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
        }),
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
        BigInt(ticket.nonce),
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
          }),
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

  const startWalletWithdraw = async (withdrawalId: string, ticket: ProviderWithdrawTicket) => {
    const { contractAddress, targetChainId } = await validateWalletWithdrawReadiness(ticket);

    const hash = await writeContractAsync({
      address: contractAddress,
      abi: SynapseCoreABI,
      chainId: targetChainId,
      functionName: "withdraw",
      args: [
        BigInt(ticket.amount),
        BigInt(ticket.fee),
        BigInt(ticket.nonce),
        BigInt(ticket.deadline),
        normalizeSignature(ticket.signature),
      ],
    });

    setActiveWithdrawalId(withdrawalId);
    setActiveTxChainId(targetChainId);
    toast.success(t("providerSettlements.txSubmitted", { hash: hash.slice(0, 10) }));
  };

  const resumePendingWithdraw = async () => {
    if (!pendingWithdrawal?.ticket) {
      toast.error(t("providerSettlements.noPendingTicket"));
      return;
    }
    try {
      await startWalletWithdraw(pendingWithdrawal.id, pendingWithdrawal.ticket);
    } catch (error) {
      toast.error(normalizeWithdrawWalletError(error, withdrawWalletErrorMessages));
    }
  };

  const isAnyLoading = creatingIntent || isWalletPrompting || isTxConfirming;
  const ticketSigningEnabled = Boolean(withdrawCapability?.ticketSigningEnabled);
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
          <Wallet className="w-8 h-8 text-[#22c55e]" />
          {t("providerSettlements.withdrawPageTitle")}
        </h1>
        <p className="mt-2 text-sm text-[#86868b]">
          {t("providerSettlements.withdrawPageDescription")}
        </p>
      </div>

      <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-5">
        <h2 className="text-xl font-semibold text-white">{t("providerSettlements.withdrawalTitle")}</h2>
        {!loadingWithdrawCapability && withdrawCapability && !ticketSigningEnabled && (
          <div className="mt-4 rounded-xl border border-[#ff9f0a]/30 bg-[#ff9f0a]/10 px-4 py-3 text-sm text-[#ffd7a1]">
            {withdrawCapability.message}
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
          <span title={t("providerSettlements.walletGasTip")}><Info className="w-3.5 h-3.5 text-[#22c55e]/50 shrink-0 cursor-help" /></span>
        </div>
        {pendingTicketExpired && (
          <div className="mt-4 rounded-xl border border-[#ef4444]/30 bg-[#ef4444]/10 px-4 py-3 text-sm text-[#fecaca]">
            {t("providerSettlements.pendingTicketExpiredBanner")}
          </div>
        )}

        <div className="flex flex-col gap-3 mt-5 sm:flex-row">
          <input
            type="text"
            inputMode="decimal"
            value={withdrawAmountInput}
            onChange={(e) => {
              const nextValue = e.target.value;
              if (nextValue === "" || WITHDRAW_AMOUNT_INPUT_PATTERN.test(nextValue)) {
                setWithdrawAmountInput(nextValue);
              }
            }}
            placeholder={`${availableReceivable.toFixed(6)} USDC`}
            className={`w-full sm:max-w-md px-3 py-2 rounded-lg border bg-[#050505] text-sm text-white outline-none placeholder:text-[#86868b] ${withdrawAmountValidationMessage ? "border-[#ef4444] focus:border-[#ef4444]" : "border-[#222222]"}`}
            disabled={isAnyLoading}
          />
          <button
            onClick={handleCreateWithdrawalIntent}
            disabled={!isConnected || availableReceivable <= 0 || isAnyLoading || !ticketSigningEnabled || loadingWithdrawCapability || Boolean(withdrawAmountValidationMessage)}
            className="px-4 py-2 rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e] text-sm font-semibold hover:bg-[#22c55e] hover:text-black transition-colors disabled:opacity-40"
          >
            {generateClaimLabel}
          </button>
          <button
            onClick={resumePendingWithdraw}
            disabled={!pendingWithdrawal?.ticket || pendingWithdrawal?.status !== "APPROVED_AUTO" || isAnyLoading}
            className="px-4 py-2 rounded-lg border border-[#222222] bg-[#111111] text-white text-sm font-semibold hover:bg-[#1a1a1a] transition-colors disabled:opacity-40"
          >
            {t("providerSettlements.resumePending")}
          </button>
        </div>
        {withdrawAmountValidationMessage && (
          <p className="mt-3 text-xs text-[#f87171]">{withdrawAmountValidationMessage}</p>
        )}

        <div className="grid grid-cols-1 gap-3 mt-4 text-xs sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-[#222222] bg-[#050505] p-3">
            <div className="uppercase tracking-[0.15em] text-[#86868b]">{t("providerSettlements.metricAvailable")}</div>
            <div className="mt-1 font-mono text-sm text-white">{availableReceivable.toFixed(6)} USDC</div>
          </div>
          <div className="rounded-lg border border-[#222222] bg-[#050505] p-3">
            <div className="uppercase tracking-[0.15em] text-[#86868b]">{t("providerSettlements.metricPendingLocked")}</div>
            <div className="mt-1 font-mono text-[#ff9f0a] text-sm">{lockedReceivable.toFixed(6)} USDC</div>
          </div>
          <div className="rounded-lg border border-[#222222] bg-[#050505] p-3">
            <div className="uppercase tracking-[0.15em] text-[#86868b]">{t("providerSettlements.metricPendingTicket")}</div>
            <div className="mt-1 font-mono text-sm text-white">{pendingWithdrawal ? pendingWithdrawal.id.slice(0, 10) : "0"}</div>
          </div>
          <div className="rounded-lg border border-[#222222] bg-[#050505] p-3">
            <div className="uppercase tracking-[0.15em] text-[#86868b]">{t("providerSettlements.metricTxState")}</div>
            <div className="flex items-center gap-2 mt-1 font-mono text-sm text-white">
              {(isWalletPrompting || isTxConfirming) && <Loader2 className="w-3 h-3 animate-spin" />}
              {txStateLabel}
            </div>
          </div>
        </div>
      </div>

      <div className="text-right">
        <Link
          href="/provider/withdraw/history"
          className="text-sm text-[#22c55e] hover:text-[#86efac] transition-colors"
        >
          {t("providerSettlements.viewHistory")} →
        </Link>
      </div>
    </div>
  );
}
