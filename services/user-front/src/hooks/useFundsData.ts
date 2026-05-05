"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import contractConfig from "@/contract-config.json";
import SynapseCoreABI from "@/SynapseCoreABI.json";
import MockUSDCABI from "@/MockUSDCABI.json";
import { fetchRefunds, type RefundRecord } from "@/utils/refundApi";
import {
  listConsumerWithdrawals,
  listDepositIntents,
  type DepositIntentRecord,
  type RefundIntentRecord,
} from "@/utils/balanceApi";
import {
  formatMoneyString,
  moneyStringToNumber,
  normalizeMoneyString,
} from "@/utils/money";
import { getRpcUrl } from "@/utils/runtimeEnv";

export type LedgerRecord = {
  id: string;
  type: "Deposit" | "Withdraw" | "Refund" | "Claim";
  amount: number;
  txHash: string | null;
  timestamp: number;
  status: "PENDING" | "COMPLETED" | "FAILED";
  failureReason?: string;
};

type LedgerLog = {
  blockNumber: number;
  transactionHash: string;
  logIndex?: number;
  args: [unknown, bigint];
};

type LedgerBlock = {
  timestamp: number;
};

type LocalFailureDeposit = {
  id: string;
  address?: string;
  amountUsdc?: unknown;
  timestamp: number;
  failureReason?: string;
};

function normalizeTxHash(value?: string | null): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function timestampFromIntent(intent?: DepositIntentRecord): number | null {
  if (!intent) return null;
  const raw = intent.updatedAt ?? intent.createdAt;
  if (typeof raw === "number") {
    return raw > 10_000_000_000 ? raw : raw * 1000;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function moneyFromTokenUnits(value: bigint, decimals = 18): number {
  const raw = ethers.formatUnits(value, decimals);
  const [whole, fraction = ""] = raw.split(".");
  return moneyStringToNumber(
    normalizeMoneyString(`${whole}.${fraction.slice(0, 6)}`)
  );
}

function moneyFromDepositIntent(intent: DepositIntentRecord): number {
  const raw =
    intent.amountUsdc ??
    (intent as unknown as { amount_usdc?: unknown; amount?: unknown })
      .amount_usdc ??
    (intent as unknown as { amount?: unknown }).amount ??
    "0";
  return moneyStringToNumber(normalizeMoneyString(raw));
}

export function mapDepositStatusFromGatewayIntent(
  intent?: DepositIntentRecord
): LedgerRecord["status"] {
  if (!intent) return "PENDING";
  const normalized = String(intent.status || "")
    .trim()
    .toUpperCase();
  if (normalized === "CONFIRMED" || normalized === "COMPLETED") {
    return "COMPLETED";
  }
  if (
    normalized === "FAILED" ||
    normalized === "DUPLICATE" ||
    normalized === "REJECTED" ||
    normalized === "CANCELLED" ||
    normalized === "CANCELED"
  ) {
    return "FAILED";
  }
  return "PENDING";
}

async function fetchLedgerInputs(userAddress: string) {
  const provider = new ethers.JsonRpcProvider(getRpcUrl());
  const vault = new ethers.Contract(
    contractConfig.SynapseCore,
    SynapseCoreABI,
    provider
  );
  const usdc = new ethers.Contract(
    contractConfig.MockUSDC,
    MockUSDCABI,
    provider
  );
  const decimals =
    typeof usdc.decimals === "function"
      ? await usdc.decimals().catch(() => 18)
      : 18;
  const filterDeposit = vault.filters.DepositInfo(userAddress);
  const filterWithdraw = vault.filters.WithdrawInfo(userAddress);

  const [depositLogs, withdrawLogs, refunds, withdrawals, depositIntents] =
    await Promise.all([
      vault.queryFilter(filterDeposit, 0, "latest"),
      vault.queryFilter(filterWithdraw, 0, "latest"),
      fetchRefunds(userAddress),
      listConsumerWithdrawals(userAddress),
      listDepositIntents(userAddress, 100).catch(() => []),
    ]);

  return {
    provider,
    decimals,
    depositEntries: depositLogs as unknown as LedgerLog[],
    withdrawEntries: withdrawLogs as unknown as LedgerLog[],
    refunds,
    withdrawals,
    depositIntents,
  };
}

async function buildBlockMap(
  provider: ethers.JsonRpcProvider,
  logs: LedgerLog[]
): Promise<Map<number, LedgerBlock>> {
  const blockMap = new Map<number, LedgerBlock>();
  const uniqueBlockNumbers = [...new Set(logs.map((log) => log.blockNumber))];
  await Promise.all(
    uniqueBlockNumbers.map(async (blockNum) => {
      const block = await provider.getBlock(blockNum);
      if (block) blockMap.set(blockNum, { timestamp: Number(block.timestamp) });
    })
  );
  return blockMap;
}

function mapChainDepositRecords(
  depositEntries: LedgerLog[],
  depositIntents: DepositIntentRecord[],
  blockMap: Map<number, LedgerBlock>,
  decimals: number
): LedgerRecord[] {
  const depositIntentByTxHash = new Map(
    depositIntents
      .filter((intent) => normalizeTxHash(intent.txHash))
      .map((intent) => [normalizeTxHash(intent.txHash), intent])
  );

  return depositEntries.map((log) => {
    const intent = depositIntentByTxHash.get(
      normalizeTxHash(log.transactionHash)
    );
    const block = blockMap.get(log.blockNumber);
    return {
      id: intent?.id || `${log.transactionHash}-${log.logIndex ?? 0}`,
      type: "Deposit",
      amount: moneyFromTokenUnits(log.args[1], decimals),
      txHash: log.transactionHash,
      timestamp:
        timestampFromIntent(intent) ??
        (block ? block.timestamp * 1000 : Date.now()),
      status: mapDepositStatusFromGatewayIntent(intent),
      failureReason: intent?.failureReason,
    };
  });
}

function mapGatewayOnlyDepositRecords(
  depositIntents: DepositIntentRecord[],
  depositEntries: LedgerLog[]
): LedgerRecord[] {
  const onchainDepositTxHashes = new Set(
    depositEntries.map((log) => normalizeTxHash(log.transactionHash))
  );
  return depositIntents
    .filter((intent) => {
      const txHash = normalizeTxHash(intent.txHash);
      return txHash && !onchainDepositTxHashes.has(txHash);
    })
    .map((intent) => {
      const txHash = normalizeTxHash(intent.txHash);
      return {
        id: intent.id || txHash,
        type: "Deposit",
        amount: moneyFromDepositIntent(intent),
        txHash: intent.txHash,
        timestamp: timestampFromIntent(intent) ?? Date.now(),
        status: mapDepositStatusFromGatewayIntent(intent),
        failureReason: intent.failureReason,
      };
    });
}

function mapChainWithdrawRecords(
  withdrawEntries: LedgerLog[],
  blockMap: Map<number, LedgerBlock>,
  decimals: number
): LedgerRecord[] {
  return withdrawEntries.map((log) => {
    const block = blockMap.get(log.blockNumber);
    return {
      id: `${log.transactionHash}-${log.logIndex ?? 0}`,
      type: "Withdraw",
      amount: moneyFromTokenUnits(log.args[1], decimals),
      txHash: log.transactionHash,
      timestamp: block ? block.timestamp * 1000 : Date.now(),
      status: "COMPLETED",
    };
  });
}

function mapRefundRecords(refunds: RefundRecord[]): LedgerRecord[] {
  return refunds.map((refund) => ({
    id: refund.id || `refund-${Math.random()}`,
    type: refund.type === "refund" ? "Refund" : "Claim",
    amount: moneyStringToNumber(refund.amountUsdc),
    txHash: refund.txHash,
    timestamp: refund.timestamp * 1000,
    status: refund.status,
  }));
}

function mapConsumerWithdrawalRecords(
  withdrawals: RefundIntentRecord[]
): LedgerRecord[] {
  const statusMap: Record<string, LedgerRecord["status"]> = {
    REQUESTED: "PENDING",
    PENDING_MANUAL_REVIEW: "PENDING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    REJECTED: "FAILED",
    CANCELLED: "FAILED",
  };
  return withdrawals.map((withdrawal) => ({
    id: withdrawal.id,
    type: "Withdraw",
    amount: moneyStringToNumber(withdrawal.amountUsdc ?? "0"),
    txHash: withdrawal.txHash ?? null,
    timestamp: withdrawal.createdAt
      ? new Date(withdrawal.createdAt).getTime()
      : Date.now(),
    status: statusMap[withdrawal.status?.toUpperCase()] ?? "PENDING",
  }));
}

function mapLocalFailureRecords(userAddress: string): LedgerRecord[] {
  const failedStorage = localStorage.getItem("synapse_failed_deposits");
  const parsed = failedStorage ? (JSON.parse(failedStorage) as unknown) : [];
  const localFailures = Array.isArray(parsed)
    ? (parsed as LocalFailureDeposit[])
    : [];
  return localFailures
    .filter((failure) => failure.address === userAddress)
    .map((failure) => ({
      id: failure.id,
      type: "Deposit",
      amount: moneyStringToNumber(failure.amountUsdc ?? "0"),
      txHash: null,
      timestamp: failure.timestamp,
      status: "FAILED",
      failureReason: failure.failureReason,
    }));
}

export function useFundsData() {
  const { address: userAddress } = useAccount();
  const [records, setRecords] = useState<LedgerRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [vaultBalance, setVaultBalance] = useState("0.00");
  const [walletBalance, setWalletBalance] = useState("0.00");

  const fetchBalances = useCallback(async () => {
    if (!userAddress) {
      setVaultBalance("0.00");
      setWalletBalance("0.00");
      return;
    }
    try {
      const provider = new ethers.JsonRpcProvider(getRpcUrl());
      const usdc = new ethers.Contract(
        contractConfig.MockUSDC,
        MockUSDCABI,
        provider
      );
      const decimals =
        typeof usdc.decimals === "function"
          ? await usdc.decimals().catch(() => 18)
          : 18;

      const [vaultBal, walletBal] = await Promise.all([
        usdc
          .balanceOf(contractConfig.SynapseCore)
          .catch(() => ethers.toBigInt(0)),
        usdc.balanceOf(userAddress).catch(() => ethers.toBigInt(0)),
      ]);

      setVaultBalance(
        formatMoneyString(ethers.formatUnits(vaultBal, decimals), 2)
      );
      setWalletBalance(
        formatMoneyString(ethers.formatUnits(walletBal, decimals), 2)
      );
    } catch (e) {
      console.error("fetch balances error", e);
    }
  }, [userAddress]);

  const loadLedger = useCallback(async () => {
    if (!userAddress) {
      setRecords([]);
      return;
    }
    setLoading(true);
    try {
      const ledger = await fetchLedgerInputs(userAddress);
      const blockMap = await buildBlockMap(ledger.provider, [
        ...ledger.depositEntries,
        ...ledger.withdrawEntries,
      ]);
      const allRecords = [
        ...mapChainDepositRecords(
          ledger.depositEntries,
          ledger.depositIntents,
          blockMap,
          ledger.decimals
        ),
        ...mapGatewayOnlyDepositRecords(
          ledger.depositIntents,
          ledger.depositEntries
        ),
        ...mapChainWithdrawRecords(
          ledger.withdrawEntries,
          blockMap,
          ledger.decimals
        ),
        ...mapRefundRecords(ledger.refunds),
        ...mapConsumerWithdrawalRecords(ledger.withdrawals),
        ...mapLocalFailureRecords(userAddress),
      ];
      allRecords.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(allRecords);
    } catch (error) {
      console.error("Failed to load ledger:", error);
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    fetchBalances();
    loadLedger();

    const handleStorageUpdate = () => loadLedger();
    window.addEventListener(
      "synapse_failed_deposits_updated",
      handleStorageUpdate
    );
    return () =>
      window.removeEventListener(
        "synapse_failed_deposits_updated",
        handleStorageUpdate
      );
  }, [fetchBalances, loadLedger]);

  return {
    loading,
    records,
    vaultBalance,
    walletBalance,
    refetch: () => {
      fetchBalances();
      loadLedger();
    },
  };
}
