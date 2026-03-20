"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, ReceiptText, Activity, Wallet, ShieldCheck, Loader2 } from "lucide-react";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { useAccount, useBalance, useChainId, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import toast from "react-hot-toast";
import { useDashboardData } from "@/hooks/useDashboardData";
import SynapseCoreABI from "@/SynapseCoreABI.json";
import contractConfig from "@/contract-config.json";
import {
  completeProviderWithdrawal,
  createProviderWithdrawIntent,
  getProviderWithdrawCapability,
  type ProviderWithdrawCapability,
  listProviderWithdrawals,
  type ProviderWithdrawRecord,
  type ProviderWithdrawTicket,
} from "@/utils/providerWithdrawApi";

const VAULT_ADDRESS = (contractConfig as { SynapseCore?: string }).SynapseCore as `0x${string}` | undefined;
const WITHDRAW_AMOUNT_INPUT_PATTERN = /^\d*(?:\.\d{0,2})?$/;
const CHAIN_LABELS: Record<number, string> = {
  31337: "Hardhat Local",
  11155111: "Sepolia",
  84532: "Base Sepolia",
  421614: "Arbitrum Sepolia",
};

function formatTimestamp(seconds?: number | string): string {
  if (!seconds) return "-";
  const numSeconds = typeof seconds === "string" ? Number.parseInt(seconds, 10) : seconds;
  if (Number.isNaN(numSeconds)) return "-";
  return new Date(numSeconds * 1000).toLocaleString();
}

function normalizeSignature(signature: string): `0x${string}` {
  const normalized = signature.startsWith("0x") ? signature : `0x${signature}`;
  return normalized as `0x${string}`;
}

function withdrawalStatusColor(status: ProviderWithdrawRecord["status"]): string {
  if (status === "COMPLETED") return "text-[#22c55e]";
  if (status === "REJECTED") return "text-[#ef4444]";
  return "text-[#ff9f0a]";
}

function formatChainLabel(chainId?: number): string {
  if (!chainId || !Number.isFinite(chainId)) return "the required network";
  return CHAIN_LABELS[chainId] || `chain ${chainId}`;
}

function resolveTicketContractAddress(ticket: ProviderWithdrawTicket): `0x${string}` | undefined {
  const contractAddress = String(ticket.contractAddress || VAULT_ADDRESS || "").trim();
  return contractAddress ? (contractAddress as `0x${string}`) : undefined;
}

function toSafeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function normalizeWithdrawWalletError(error: unknown): string {
  const baseError = error instanceof BaseError ? error : undefined;
  const revertError = baseError?.walk((walked) => walked instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | undefined;
  const rawMessage = toSafeErrorMessage(error, "Failed to submit withdrawal transaction.");
  const messageParts = [
    revertError?.reason,
    revertError?.data?.errorName,
    baseError?.shortMessage,
    baseError?.details,
    rawMessage,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  const normalizedMessage = messageParts.join(" | ").toLowerCase();

  if (
    normalizedMessage.includes("user rejected")
    || normalizedMessage.includes("user denied")
    || normalizedMessage.includes("rejected the request")
    || normalizedMessage.includes("denied transaction signature")
    || normalizedMessage.includes("4001")
  ) {
    return "Withdrawal was cancelled in wallet. No gas fee was spent and no funds were moved.";
  }
  if (
    normalizedMessage.includes("insufficient funds")
    || normalizedMessage.includes("intrinsic gas too low")
    || normalizedMessage.includes("gas required exceeds allowance")
    || normalizedMessage.includes("exceeds the balance of the account")
    || normalizedMessage.includes("out of gas")
  ) {
    return "Withdrawal could not be submitted because the wallet does not have enough native token to pay gas.";
  }
  if (revertError?.data?.errorName) {
    return `Withdrawal was rejected by the vault contract (${revertError.data.errorName}).`;
  }
  if (revertError?.reason) {
    return `Withdrawal was rejected by the vault contract: ${revertError.reason}.`;
  }
  return rawMessage;
}

function validateRequestedWithdrawAmount(
  requestedAmount: string,
  availableReceivable: number,
): string | null {
  if (!requestedAmount) {
    return null;
  }
  if (!WITHDRAW_AMOUNT_INPUT_PATTERN.test(requestedAmount)) {
    return "Use up to 2 decimal places for withdrawal amount.";
  }

  const parsed = Number(requestedAmount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "Enter a valid withdrawal amount.";
  }

  if (parsed > availableReceivable) {
    return `Amount exceeds available receivable (${availableReceivable.toFixed(6)} USDC).`;
  }

  return null;
}

export default function ProviderSettlementsPage() {
  const { providerStats, paidEvents, handleRefresh: reloadDashboard } = useDashboardData();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const chainId = useChainId();

  const [requestInput, setRequestInput] = useState("");
  const [serviceInput, setServiceInput] = useState("");
  const [requestQuery, setRequestQuery] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const [page, setPage] = useState(1);
  const [withdrawAmountInput, setWithdrawAmountInput] = useState("");
  const [creatingIntent, setCreatingIntent] = useState(false);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);
  const [withdrawals, setWithdrawals] = useState<ProviderWithdrawRecord[]>([]);
  const [activeWithdrawalId, setActiveWithdrawalId] = useState<string | null>(null);
  const [activeTxChainId, setActiveTxChainId] = useState<number | undefined>(undefined);
  const [withdrawCapability, setWithdrawCapability] = useState<ProviderWithdrawCapability | null>(null);
  const [loadingWithdrawCapability, setLoadingWithdrawCapability] = useState(false);

  const PAGE_SIZE = 10;
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
    return `Wallet has no ${nativeBalanceData.symbol || "native token"} to pay gas on ${formatChainLabel(chainId)}.`;
  }, [chainId, isConnected, nativeBalanceData]);

  const refreshWithdrawals = useCallback(async () => {
    if (!address) return;
    setLoadingWithdrawals(true);
    try {
      const rows = await listProviderWithdrawals(address);
      setWithdrawals(rows);
    } catch (error) {
      console.error("Failed to load provider withdrawals", error);
      toast.error("Failed to load withdrawal history");
    } finally {
      setLoadingWithdrawals(false);
    }
  }, [address]);

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
        message: "Unable to verify whether the gateway can issue withdrawal tickets right now.",
        contractAddress: null,
      });
    } finally {
      setLoadingWithdrawCapability(false);
    }
  }, [address]);

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
        toast.success("Withdrawal settled and marked completed");
        await Promise.all([refreshWithdrawals(), reloadDashboard()]);
      } catch (error) {
        console.error("Failed to complete provider withdrawal", error);
        toast.error("On-chain tx succeeded, but backend completion failed. Retry from history.");
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
    toast.error(normalizeWithdrawWalletError(txReceiptError));
    setActiveWithdrawalId(null);
    setActiveTxChainId(undefined);
  }, [activeWithdrawalId, isTxFailed, txHash, txReceiptError]);

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
      const matchesService = !sq || (event.serviceId || "").toLowerCase().includes(sq);
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
    return validateRequestedWithdrawAmount(withdrawAmountInput.trim(), availableReceivable);
  }, [availableReceivable, withdrawAmountInput]);

  const resolveRequestedWithdrawAmount = (): number | undefined => {
    const requestedAmount = withdrawAmountInput.trim();
    return requestedAmount ? Number(requestedAmount) : undefined;
  };

  const handleExistingPendingWithdrawal = async (): Promise<boolean> => {
    if (!pendingWithdrawal) {
      return false;
    }
    if (pendingTicketExpired) {
      await Promise.all([refreshWithdrawals(), reloadDashboard()]);
      toast.error("Previous withdrawal ticket expired. Locked receivable has been released back to available balance.");
      return true;
    }
    if (pendingWithdrawal.status === "APPROVED_AUTO" && pendingWithdrawal.ticket) {
      try {
        await startWalletWithdraw(pendingWithdrawal.id, pendingWithdrawal.ticket);
      } catch (error) {
        toast.error(normalizeWithdrawWalletError(error));
      }
      return true;
    }
    toast.error("A withdrawal is already pending review. Wait for review completion before creating a new one.");
    return true;
  };

  const handleCreateWithdrawalIntent = async () => {
    if (!address || !isConnected) {
      openConnectModal?.();
      return;
    }
    if (!VAULT_ADDRESS) {
      toast.error("Vault contract address missing");
      return;
    }
    if (!withdrawCapability?.ticketSigningEnabled) {
      toast.error(
        withdrawCapability?.message ||
          "Provider withdrawals are unavailable because the gateway cannot issue signed withdrawal tickets.",
      );
      return;
    }

    const requestedAmount = withdrawAmountInput.trim();
    const validationMessage = validateRequestedWithdrawAmount(requestedAmount, availableReceivable);
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }

    if (await handleExistingPendingWithdrawal()) {
      return;
    }

    const amountUsdc = resolveRequestedWithdrawAmount();

    setCreatingIntent(true);
    const toastId = toast.loading("Generating signed withdrawal ticket...");
    try {
      const intent = await createProviderWithdrawIntent(address, amountUsdc);
      if (intent.status === "PENDING_MANUAL_REVIEW") {
        toast.success(intent.message || "Withdrawal queued for manual security review.", { id: toastId });
      } else if (intent.ticket) {
        await startWalletWithdraw(intent.withdrawalId, intent.ticket);
        toast.success("Ticket generated. Confirm transaction in wallet.", { id: toastId });
      } else {
        toast.success("Withdrawal intent created.", { id: toastId });
      }
      await Promise.all([refreshWithdrawals(), refreshWithdrawCapability(), reloadDashboard()]);
      setWithdrawAmountInput("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create provider withdrawal";
      toast.error(message, { id: toastId });
    } finally {
      setCreatingIntent(false);
    }
  };

  const validateWalletWithdrawReadiness = (ticket: ProviderWithdrawTicket): {
    contractAddress: `0x${string}`;
    targetChainId?: number;
  } => {
    const contractAddress = resolveTicketContractAddress(ticket);
    if (!contractAddress) {
      throw new Error("Withdrawal contract address is missing from the signed ticket.");
    }

    if (ticket.chainId && chainId !== ticket.chainId) {
      throw new Error(
        `Wrong network. Switch wallet to ${formatChainLabel(ticket.chainId)} before resuming this withdrawal.`,
      );
    }

    if (ticket.deadline && ticket.deadline < Math.floor(Date.now() / 1000)) {
      throw new Error("This withdrawal ticket has expired. Generate a new ticket before retrying.");
    }

    if (nativeBalanceData && nativeBalanceData.value <= BigInt(0)) {
      throw new Error(
        `Withdrawal could not be submitted because the wallet has no ${nativeBalanceData.symbol || "native token"} to pay gas on ${formatChainLabel(chainId)}.`,
      );
    }

    return {
      contractAddress,
      targetChainId: ticket.chainId || chainId,
    };
  };

  const startWalletWithdraw = async (withdrawalId: string, ticket: ProviderWithdrawTicket) => {
    const { contractAddress, targetChainId } = validateWalletWithdrawReadiness(ticket);

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
    toast.success(`Tx submitted: ${hash.slice(0, 10)}...`);
  };

  const resumePendingWithdraw = async () => {
    if (!pendingWithdrawal?.ticket) {
      toast.error("No pending withdrawal ticket found");
      return;
    }
    try {
      await startWalletWithdraw(pendingWithdrawal.id, pendingWithdrawal.ticket);
    } catch (error) {
      toast.error(normalizeWithdrawWalletError(error));
    }
  };

  const isAnyLoading = creatingIntent || isWalletPrompting || isTxConfirming;
  const ticketSigningEnabled = Boolean(withdrawCapability?.ticketSigningEnabled);
  let generateClaimLabel = "Signer Unavailable";
  if (ticketSigningEnabled) {
    generateClaimLabel = "Generate & Claim";
  }
  if (creatingIntent) {
    generateClaimLabel = "Creating Ticket...";
  }
  let txStateLabel = "0";
  if (isWalletPrompting) {
    txStateLabel = "Wallet Prompt";
  }
  if (isTxConfirming) {
    txStateLabel = "Confirming";
  }
  if (isTxFailed) {
    txStateLabel = "Failed";
  }

  return (
    <div className="p-6 md:p-10 mx-auto max-w-7xl text-white bg-[#000000] min-h-screen space-y-6">
      <div className="border-b border-[#222222] pb-5">
        <h1 className="text-3xl md:text-4xl font-[800] tracking-tight text-white flex items-center gap-3">
          <Database className="w-8 h-8 text-[#22c55e]" />
          Settlement Pipeline
        </h1>
        <p className="mt-2 text-sm text-[#86868b]">
          Reconciled provider payouts from gateway settlement logs (deduplicated by request ID).
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-2xl border border-[#222222] bg-[#0a0a0a] p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[#86868b]">
            <Wallet className="w-4 h-4" />
            Provider Withdrawal (Self-pay Gas)
          </div>
          <h2 className="mt-3 text-xl font-semibold text-white">Claim Receivable to Wallet via EIP-712 Ticket</h2>
          <p className="mt-2 text-sm text-[#86868b] leading-relaxed">
            Gateway issues a signed withdrawal ticket; provider submits the on-chain withdraw transaction and pays gas.
            Pending tickets lock receivable to prevent duplicate withdrawal and replay at ledger layer.
          </p>
          {!loadingWithdrawCapability && withdrawCapability && !ticketSigningEnabled && (
            <div className="mt-4 rounded-xl border border-[#ff9f0a]/30 bg-[#ff9f0a]/10 px-4 py-3 text-sm text-[#ffd7a1]">
              {withdrawCapability.message}
            </div>
          )}
          {pendingTicketChainMismatch && pendingTicket?.chainId && (
            <div className="mt-4 rounded-xl border border-[#ff9f0a]/30 bg-[#ff9f0a]/10 px-4 py-3 text-sm text-[#ffd7a1]">
              Resume Pending requires the wallet to be on {formatChainLabel(pendingTicket.chainId)}. Current wallet network is {formatChainLabel(chainId)}.
            </div>
          )}
          {!pendingTicketChainMismatch && nativeGasWarning && (
            <div className="mt-4 rounded-xl border border-[#ff9f0a]/30 bg-[#ff9f0a]/10 px-4 py-3 text-sm text-[#ffd7a1]">
              {nativeGasWarning}
            </div>
          )}
          {pendingTicketExpired && (
            <div className="mt-4 rounded-xl border border-[#ef4444]/30 bg-[#ef4444]/10 px-4 py-3 text-sm text-[#fecaca]">
              The pending withdrawal ticket has expired. Generate a new ticket before retrying.
            </div>
          )}

          <div className="mt-5 flex flex-col sm:flex-row gap-3">
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
              placeholder={`Amount (blank = full ${availableReceivable.toFixed(6)} USDC)`}
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
              Resume Pending
            </button>
          </div>
          {withdrawAmountValidationMessage ? (
            <p className="mt-3 text-xs text-[#f87171]">{withdrawAmountValidationMessage}</p>
          ) : (
            <p className="mt-3 text-xs text-[#86868b]">
              Leave amount blank to withdraw the full available receivable. Any active ticket moves funds from
              Available into Pending / Locked until it is completed or released. Custom amount supports up to 2 decimal places.
            </p>
          )}

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
            <div className="rounded-lg border border-[#222222] bg-[#050505] p-3">
              <div className="uppercase tracking-[0.15em] text-[#86868b]">Available</div>
              <div className="mt-1 font-mono text-white text-sm">{availableReceivable.toFixed(6)} USDC</div>
            </div>
            <div className="rounded-lg border border-[#222222] bg-[#050505] p-3">
              <div className="uppercase tracking-[0.15em] text-[#86868b]">Pending / Locked</div>
              <div className="mt-1 font-mono text-[#ff9f0a] text-sm">{lockedReceivable.toFixed(6)} USDC</div>
            </div>
            <div className="rounded-lg border border-[#222222] bg-[#050505] p-3">
              <div className="uppercase tracking-[0.15em] text-[#86868b]">Pending Ticket</div>
              <div className="mt-1 font-mono text-white text-sm">{pendingWithdrawal ? pendingWithdrawal.id.slice(0, 10) : "0"}</div>
            </div>
            <div className="rounded-lg border border-[#222222] bg-[#050505] p-3">
              <div className="uppercase tracking-[0.15em] text-[#86868b]">Tx State</div>
              <div className="mt-1 font-mono text-white text-sm flex items-center gap-2">
                {(isWalletPrompting || isTxConfirming) && <Loader2 className="w-3 h-3 animate-spin" />}
                {txStateLabel}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#22c55e]/30 bg-[#0a0a0a] p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[#22c55e]">
            <ShieldCheck className="w-4 h-4" />
            Security Contract
          </div>
          <ul className="mt-3 space-y-2 text-xs text-[#c5c5c7] leading-relaxed">
            <li>One owner can only keep one PENDING withdrawal ticket at a time.</li>
            <li>Intent creation atomically locks receivable into providersLocked ledger bucket.</li>
            <li>Completion consumes lock once and binds txHash for idempotent finalize.</li>
            <li>EIP-712 payload includes nonce + deadline, contract enforces replay protection.</li>
          </ul>
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
          placeholder="Search RequestId"
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
          placeholder="Search Service (fuzzy)"
          className="px-3 py-2 rounded-lg border border-[#222222] bg-[#050505] text-sm text-white outline-none placeholder:text-[#86868b] w-full lg:w-[320px]"
        />
        <button
          onClick={handleSearch}
          className="px-4 py-2 rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e] text-sm font-semibold hover:bg-[#22c55e] hover:text-black transition-colors lg:ml-auto"
        >
          Search
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Net Earned</div>
          <div className="text-2xl font-mono font-bold text-white">{providerStats.netEarned.toFixed(4)} USDC</div>
        </div>
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Gross Earnings</div>
          <div className="text-2xl font-mono font-bold text-white">{providerStats.totalEarned.toFixed(4)} USDC</div>
        </div>
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Protocol Fee</div>
          <div className="text-2xl font-mono font-bold text-[#ff9f0a]">{providerStats.totalFees.toFixed(4)} USDC</div>
        </div>
        <div className="p-4 rounded-2xl border border-[#222222] bg-[#0a0a0a]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Routing Tax</div>
          <div className="text-2xl font-mono font-bold text-[#22c55e]">{providerStats.totalRoutingTax.toFixed(4)} USDC</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[1.5rem] border border-[#222222] bg-[#0a0a0a]">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-[#222222] text-[10px] text-[#86868b] uppercase tracking-[0.2em] font-semibold bg-[#050505]">
              <th className="py-5 px-6">RequestId</th>
              <th className="py-5 px-6">Service</th>
              <th className="py-5 px-6 text-right">Gross</th>
              <th className="py-5 px-6 text-right">Protocol Fee</th>
              <th className="py-5 px-6 text-right">Routing Tax</th>
              <th className="py-5 px-6 text-right">Net</th>
              <th className="py-5 px-6 text-right">Call Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515]">
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-14 text-center text-sm text-[#86868b]">
                  No settlement events yet.
                </td>
              </tr>
            )}
            {pageRows.map((event) => (
              <tr key={event.txHash + String(event.blockNumber)} className="hover:bg-[#111111] transition-colors">
                <td className="py-4 px-6 text-xs font-mono text-[#86868b]">{event.txHash}</td>
                <td className="py-4 px-6 text-sm font-semibold text-white">{event.serviceId || "unknown"}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-white">{event.amount.toFixed(4)}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-[#ff9f0a]">{event.fee.toFixed(4)}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-[#22c55e]">{event.routingTax.toFixed(4)}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-white">{(event.amount - event.fee).toFixed(4)}</td>
                <td className="py-4 px-6 text-xs text-right text-[#86868b]">{formatTimestamp(event.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-[1.5rem] border border-[#222222] bg-[#0a0a0a]">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-[#222222] text-[10px] text-[#86868b] uppercase tracking-[0.2em] font-semibold bg-[#050505]">
              <th className="py-4 px-6">Withdrawal ID</th>
              <th className="py-4 px-6 text-right">Amount</th>
              <th className="py-4 px-6">Status</th>
              <th className="py-4 px-6">Nonce</th>
              <th className="py-4 px-6">Created</th>
              <th className="py-4 px-6">Tx Hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515]">
            {!loadingWithdrawals && withdrawals.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sm text-[#86868b]">No withdrawal records yet.</td>
              </tr>
            )}
            {loadingWithdrawals && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sm text-[#86868b]">Loading withdrawal history...</td>
              </tr>
            )}
            {withdrawals.map((row) => (
              <tr key={row.id} className="hover:bg-[#111111] transition-colors">
                <td className="py-4 px-6 text-xs font-mono text-[#86868b]">{row.id}</td>
                <td className="py-4 px-6 text-sm text-right font-mono text-white">{row.amountUsdc.toFixed(6)} USDC</td>
                <td className="py-4 px-6 text-xs">
                  <span className={withdrawalStatusColor(row.status)}>{row.status}</span>
                </td>
                <td className="py-4 px-6 text-xs font-mono text-[#c5c5c7]">{row.nonce}</td>
                <td className="py-4 px-6 text-xs text-[#86868b]">{formatTimestamp(row.createdAt)}</td>
                <td className="py-4 px-6 text-xs font-mono text-[#86868b]">{row.txHash || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-[#86868b]">
        <div>
          Showing {(safePage - 1) * PAGE_SIZE + (filtered.length ? 1 : 0)}-
          {Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#0a0a0a] disabled:opacity-40"
          >
            Prev
          </button>
          <span className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#050505] text-white">
            {safePage} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={safePage >= pageCount}
            className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#0a0a0a] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[#222222] bg-[#0a0a0a] p-4 text-xs text-[#86868b] flex items-center gap-2">
        <ReceiptText className="w-4 h-4 text-[#22c55e]" />
        <span>
          Requests are deduplicated by request ID before summary aggregation to prevent double-counting across retries.
        </span>
        <Activity className="w-4 h-4 text-[#86868b] ml-auto" />
      </div>
    </div>
  );
}
