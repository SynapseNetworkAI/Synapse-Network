"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, ReceiptText, Activity, Wallet, ShieldCheck, Loader2 } from "lucide-react";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import toast from "react-hot-toast";
import { useDashboardData } from "@/hooks/useDashboardData";
import SynapseCoreABI from "@/SynapseCoreABI.json";
import contractConfig from "@/contract-config.json";
import {
  completeProviderWithdrawal,
  createProviderWithdrawIntent,
  listProviderWithdrawals,
  type ProviderWithdrawRecord,
  type ProviderWithdrawTicket,
} from "@/utils/providerWithdrawApi";

const VAULT_ADDRESS = (contractConfig as { SynapseCore?: string }).SynapseCore as `0x${string}` | undefined;

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

export default function ProviderSettlementsPage() {
  const { providerStats, paidEvents, handleRefresh: reloadDashboard } = useDashboardData();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

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

  const PAGE_SIZE = 10;
  const availableReceivable = Number(providerStats.receivable || 0);

  const { data: txHash, writeContractAsync, isPending: isWalletPrompting } = useWriteContract();
  const { isLoading: isTxConfirming, isSuccess: isTxConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const pendingWithdrawal = useMemo(
    () =>
      withdrawals.find((row) =>
        ["REQUESTED", "APPROVED_AUTO", "PENDING_MANUAL_REVIEW"].includes(row.status)
      ) || null,
    [withdrawals]
  );

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

  useEffect(() => {
    if (!address) {
      setWithdrawals([]);
      return;
    }
    void refreshWithdrawals();
  }, [address, refreshWithdrawals]);

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
      }
    };
    void complete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTxConfirmed, txHash, address, activeWithdrawalId]);

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

  const handleCreateWithdrawalIntent = async () => {
    if (!address || !isConnected) {
      openConnectModal?.();
      return;
    }
    if (!VAULT_ADDRESS) {
      toast.error("Vault contract address missing");
      return;
    }
    if (pendingWithdrawal) {
      toast.error("An active withdrawal exists. Complete or review it before creating a new one.");
      return;
    }

    const requestedAmount = withdrawAmountInput.trim();
    let amountUsdc: number | undefined = undefined;
    if (requestedAmount) {
      const parsed = Number(requestedAmount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        toast.error("Enter a valid withdrawal amount");
        return;
      }
      amountUsdc = parsed;
    }

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
      await Promise.all([refreshWithdrawals(), reloadDashboard()]);
      setWithdrawAmountInput("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create provider withdrawal";
      toast.error(message, { id: toastId });
    } finally {
      setCreatingIntent(false);
    }
  };

  const startWalletWithdraw = async (withdrawalId: string, ticket: ProviderWithdrawTicket) => {
    if (!VAULT_ADDRESS) {
      throw new Error("Vault address not configured");
    }

    const hash = await writeContractAsync({
      address: VAULT_ADDRESS,
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

    setActiveWithdrawalId(withdrawalId);
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
      const message = error instanceof Error ? error.message : "Failed to submit withdrawal tx";
      toast.error(message);
    }
  };

  const isAnyLoading = creatingIntent || isWalletPrompting || isTxConfirming;
  let txStateLabel = "0";
  if (isWalletPrompting) {
    txStateLabel = "Wallet Prompt";
  }
  if (isTxConfirming) {
    txStateLabel = "Confirming";
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

          <div className="mt-5 flex flex-col sm:flex-row gap-3">
            <input
              type="number"
              min="0"
              step="0.000001"
              value={withdrawAmountInput}
              onChange={(e) => setWithdrawAmountInput(e.target.value)}
              placeholder={`Amount (blank = full ${availableReceivable.toFixed(6)} USDC)`}
              className="w-full sm:max-w-md px-3 py-2 rounded-lg border border-[#222222] bg-[#050505] text-sm text-white outline-none placeholder:text-[#86868b]"
              disabled={isAnyLoading}
            />
            <button
              onClick={handleCreateWithdrawalIntent}
              disabled={!isConnected || availableReceivable <= 0 || isAnyLoading || Boolean(pendingWithdrawal)}
              className="px-4 py-2 rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e] text-sm font-semibold hover:bg-[#22c55e] hover:text-black transition-colors disabled:opacity-40"
            >
              {creatingIntent ? "Creating Ticket..." : "Generate & Claim"}
            </button>
            <button
              onClick={resumePendingWithdraw}
              disabled={!pendingWithdrawal?.ticket || pendingWithdrawal?.status !== "APPROVED_AUTO" || isAnyLoading}
              className="px-4 py-2 rounded-lg border border-[#222222] bg-[#111111] text-white text-sm font-semibold hover:bg-[#1a1a1a] transition-colors disabled:opacity-40"
            >
              Resume Pending
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border border-[#222222] bg-[#050505] p-3">
              <div className="uppercase tracking-[0.15em] text-[#86868b]">Available</div>
              <div className="mt-1 font-mono text-white text-sm">{availableReceivable.toFixed(6)} USDC</div>
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
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#86868b] mb-2">Net Earnings</div>
          <div className="text-2xl font-mono font-bold text-white">{providerStats.receivable.toFixed(4)} USDC</div>
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
