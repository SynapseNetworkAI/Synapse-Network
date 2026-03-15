"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import contractConfig from "@/contract-config.json";
import SynapseCoreABI from "@/SynapseCoreABI.json";
import MockUSDCABI from "@/MockUSDCABI.json";
import { fetchRefunds, type RefundRecord } from "@/utils/refundApi";

export type LedgerRecord = {
  id: string;
  type: "Deposit" | "Withdraw" | "Refund" | "Claim";
  amount: number;
  txHash: string | null;
  timestamp: number;
  status: "PENDING" | "COMPLETED" | "FAILED";
  failureReason?: string;
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
      setVaultBalance(Number.parseFloat(ethers.formatUnits(vaultBal, 18)).toFixed(2));
      setWalletBalance(Number.parseFloat(ethers.formatUnits(walletBal, 18)).toFixed(2));
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

      // fetch on-chain deposit
      const filterDeposit = vault.filters.DepositInfo(userAddress);
      const depositLogs = await vault.queryFilter(filterDeposit, 0, "latest");
      
      // fetch on-chain withdraw
      const filterWithdraw = vault.filters.WithdrawInfo(userAddress);
      const withdrawLogs = await vault.queryFilter(filterWithdraw, 0, "latest");

      const onchainRecords: LedgerRecord[] = [];

      // Disable linting here because args are dynamically resolved
      /* eslint-disable @typescript-eslint/no-explicit-any */
      await Promise.all(depositLogs.map(async (log: any) => {
        const block = await provider.getBlock(log.blockNumber);
        onchainRecords.push({
          id: `${log.transactionHash}-${log.logIndex}`,
          type: "Deposit",
          amount: Number.parseFloat(ethers.formatUnits(log.args[1], 18)),
          txHash: log.transactionHash,
          timestamp: block ? Number(block.timestamp) * 1000 : Date.now(),
          status: "COMPLETED"
        });
      }));

      await Promise.all(withdrawLogs.map(async (log: any) => {
        const block = await provider.getBlock(log.blockNumber);
        onchainRecords.push({
          id: `${log.transactionHash}-${log.logIndex}`,
          type: "Withdraw",
          amount: Number.parseFloat(ethers.formatUnits(log.args[1], 18)),
          txHash: log.transactionHash,
          timestamp: block ? Number(block.timestamp) * 1000 : Date.now(),
          status: "COMPLETED"
        });
      }));
      /* eslint-enable @typescript-eslint/no-explicit-any */

      // fetch off-chain refunds
      const refunds = await fetchRefunds(userAddress);
      const mappedRefunds: LedgerRecord[] = refunds.map((r: RefundRecord) => ({
        id: r.id || `refund-${Math.random()}`,
        type: r.type === "refund" ? "Refund" : "Claim",
        amount: r.amount,
        txHash: r.txHash,
        timestamp: r.timestamp * 1000, // convert python ts to JS ts
        status: r.status
      }));

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

      const allRecords = [...onchainRecords, ...mappedRefunds, ...mappedFailures];
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
