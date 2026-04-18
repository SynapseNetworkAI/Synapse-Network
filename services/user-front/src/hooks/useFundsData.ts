"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import contractConfig from "@/contract-config.json";
import SynapseCoreABI from "@/SynapseCoreABI.json";
import MockUSDCABI from "@/MockUSDCABI.json";
import { fetchRefunds, type RefundRecord } from "@/utils/refundApi";
import { listConsumerWithdrawals } from "@/utils/balanceApi";
import { formatMoneyString, moneyStringToNumber, normalizeMoneyString } from "@/utils/money";

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
      const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      const vault = new ethers.Contract(contractConfig.SynapseCore, SynapseCoreABI, provider);
      const usdc = new ethers.Contract(contractConfig.MockUSDC, MockUSDCABI, provider);

      const [vaultBal, walletBal] = await Promise.all([
        vault.balanceOf(userAddress).catch(() => ethers.toBigInt(0)),
        usdc.balanceOf(userAddress).catch(() => ethers.toBigInt(0)),
      ]);

      // Assuming mock USDC has 18 decimals
      setVaultBalance(formatMoneyString(ethers.formatUnits(vaultBal, 18), 2));
      setWalletBalance(formatMoneyString(ethers.formatUnits(walletBal, 18), 2));
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
      const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      const vault = new ethers.Contract(contractConfig.SynapseCore, SynapseCoreABI, provider);

      // fetch on-chain deposit + withdraw + off-chain data in parallel
      const filterDeposit = vault.filters.DepositInfo(userAddress);
      const filterWithdraw = vault.filters.WithdrawInfo(userAddress);

      const [depositLogs, withdrawLogs, refunds, withdrawals] = await Promise.all([
        vault.queryFilter(filterDeposit, 0, "latest"),
        vault.queryFilter(filterWithdraw, 0, "latest"),
        fetchRefunds(userAddress),
        listConsumerWithdrawals(userAddress),
      ]);

      // Deduplicate block fetches — fetch each unique block number only once
      const allLogs = [...depositLogs, ...withdrawLogs];
      const uniqueBlockNumbers = [...new Set(allLogs.map((log) => log.blockNumber))];
      const blockMap = new Map<number, Awaited<ReturnType<typeof provider.getBlock>>>();
      await Promise.all(uniqueBlockNumbers.map(async (blockNum: number) => {
        const block = await provider.getBlock(blockNum);
        if (block) blockMap.set(blockNum, block);
      }));

      const onchainRecords: LedgerRecord[] = [];
      const depositEntries = depositLogs as unknown as LedgerLog[];
      const withdrawEntries = withdrawLogs as unknown as LedgerLog[];

      for (const log of depositEntries) {
        const block = blockMap.get(log.blockNumber);
        onchainRecords.push({
          id: `${log.transactionHash}-${log.logIndex ?? 0}`,
          type: "Deposit",
          amount: moneyStringToNumber(normalizeMoneyString(ethers.formatUnits(log.args[1], 18))),
          txHash: log.transactionHash,
          timestamp: block ? Number(block.timestamp) * 1000 : Date.now(),
          status: "COMPLETED"
        });
      }

      for (const log of withdrawEntries) {
        const block = blockMap.get(log.blockNumber);
        onchainRecords.push({
          id: `${log.transactionHash}-${log.logIndex ?? 0}`,
          type: "Withdraw",
          amount: moneyStringToNumber(normalizeMoneyString(ethers.formatUnits(log.args[1], 18))),
          txHash: log.transactionHash,
          timestamp: block ? Number(block.timestamp) * 1000 : Date.now(),
          status: "COMPLETED"
        });
      }

      // fetch off-chain refunds
      const mappedRefunds: LedgerRecord[] = refunds.map((r: RefundRecord) => ({
        id: r.id || `refund-${Math.random()}`,
        type: r.type === "refund" ? "Refund" : "Claim",
        amount: moneyStringToNumber(r.amountUsdc),
        txHash: r.txHash,
        timestamp: r.timestamp * 1000, // convert python ts to JS ts
        status: r.status
      }));

      // consumer withdrawals (off-chain balance refunds) — already fetched in parallel above
      const mappedWithdrawals: LedgerRecord[] = withdrawals.map((w) => {
        const tsMs = w.createdAt
          ? new Date(w.createdAt).getTime()
          : Date.now();
        const statusMap: Record<string, LedgerRecord["status"]> = {
          REQUESTED: "PENDING",
          PENDING_MANUAL_REVIEW: "PENDING",
          COMPLETED: "COMPLETED",
          FAILED: "FAILED",
          REJECTED: "FAILED",
          CANCELLED: "FAILED",
        };
        return {
          id: w.id,
          type: "Withdraw" as const,
          amount: moneyStringToNumber(w.amountUsdc ?? "0"),
          txHash: w.txHash ?? null,
          timestamp: tsMs,
          status: statusMap[w.status?.toUpperCase()] ?? "PENDING",
        };
      });

      const failedStorage = localStorage.getItem("synapse_failed_deposits");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const localFailures: any[] = failedStorage ? JSON.parse(failedStorage) : [];
      const mappedFailures: LedgerRecord[] = localFailures
        .filter(f => f.address === userAddress)
        .map(f => ({
          id: f.id,
          type: "Deposit",
          amount: f.amountUsdc,
          txHash: null,
          timestamp: f.timestamp,
          status: "FAILED",
          failureReason: f.failureReason
      }));

      const allRecords = [...onchainRecords, ...mappedRefunds, ...mappedWithdrawals, ...mappedFailures];
      // Sort by timestamp desc
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
    window.addEventListener("synapse_failed_deposits_updated", handleStorageUpdate);
    return () => window.removeEventListener("synapse_failed_deposits_updated", handleStorageUpdate);
  }, [fetchBalances, loadLedger]);

  return { loading, records, vaultBalance, walletBalance, refetch: () => { fetchBalances(); loadLedger(); } };
}
