"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";
import { fetchRefunds, type RefundRecord } from "@/utils/refundApi";
import {
  listConsumerWithdrawals,
  listDepositIntents,
  type DepositIntentRecord,
  type RefundIntentRecord,
} from "@/utils/balanceApi";
import type { WithdrawalStatus } from "@/domain/status";
import {
  formatMoneyString,
  moneyStringToNumber,
  normalizeMoneyString,
} from "@/utils/money";
import { getRpcUrl } from "@/utils/runtimeEnv";

export const PAYMENTS_FETCH_LIMIT = 100;
export const PAYMENTS_RENDER_LIMIT = 50;

export type LedgerRecord = {
  id: string;
  type: "Deposit" | "Withdraw" | "Refund" | "Claim";
  amount: number;
  txHash: string | null;
  timestamp: number;
  status: "PENDING" | "COMPLETED" | "FAILED";
  withdrawalStatus?: WithdrawalStatus;
  claimable?: boolean;
  failureReason?: string;
};

function timestampFromValue(raw?: string | number): number | null {
  if (typeof raw === "number") {
    return raw > 10_000_000_000 ? raw : raw * 1000;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function timestampFromDepositIntent(intent?: DepositIntentRecord): number {
  if (!intent) return Date.now();
  if (intent.confirmedAt) {
    return timestampFromValue(intent.confirmedAt) ?? Date.now();
  }
  return (
    timestampFromValue(intent.updatedAt) ??
    timestampFromValue(intent.createdAt) ??
    Date.now()
  );
}

function moneyFromDepositIntent(intent: DepositIntentRecord): number {
  const legacyIntent = intent as unknown as {
    amount_usdc?: unknown;
    amount?: unknown;
    credited_amount_usdc?: unknown;
  };
  const candidates = [
    intent.amountUsdc,
    legacyIntent.amount_usdc,
    legacyIntent.amount,
    intent.creditedAmountUsdc,
    legacyIntent.credited_amount_usdc,
  ];
  const raw =
    candidates.find(
      (value) => moneyStringToNumber(normalizeMoneyString(value, "")) > 0
    ) ?? "0";
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

function mapDepositIntentRecords(
  depositIntents: DepositIntentRecord[]
): LedgerRecord[] {
  return depositIntents.map((intent) => ({
    id: intent.id || intent.txHash,
    type: "Deposit",
    amount: moneyFromDepositIntent(intent),
    txHash: intent.txHash || null,
    timestamp: timestampFromDepositIntent(intent),
    status: mapDepositStatusFromGatewayIntent(intent),
    failureReason: intent.failureReason,
  }));
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
    APPROVED_AUTO: "PENDING",
    PENDING: "PENDING",
    PENDING_MANUAL_REVIEW: "PENDING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    REJECTED: "FAILED",
    CANCELLED: "FAILED",
    FAILED_EXPIRED: "FAILED",
  };
  return withdrawals.map((withdrawal) => ({
    id: withdrawal.id,
    type: "Withdraw",
    amount: moneyStringToNumber(withdrawal.amountUsdc ?? "0"),
    txHash: withdrawal.txHash ?? null,
    timestamp:
      timestampFromValue(withdrawal.updatedAt) ??
      timestampFromValue(withdrawal.createdAt) ??
      Date.now(),
    status: statusMap[withdrawal.status?.toUpperCase()] ?? "PENDING",
    withdrawalStatus: withdrawal.status,
    claimable: withdrawal.claimable === true,
  }));
}

export function useFundsData() {
  const { address: userAddress } = useAccount();
  const [records, setRecords] = useState<LedgerRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [vaultBalance, setVaultBalance] = useState("0.00");
  const [walletBalance, setWalletBalance] = useState("0.00");
  const [paymentHistoryMayBeTruncated, setPaymentHistoryMayBeTruncated] =
    useState(false);

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
      setPaymentHistoryMayBeTruncated(false);
      return;
    }
    setLoading(true);
    try {
      const [depositIntents, withdrawals, refunds] = await Promise.all([
        listDepositIntents(userAddress, PAYMENTS_FETCH_LIMIT).catch(() => []),
        listConsumerWithdrawals(userAddress, PAYMENTS_FETCH_LIMIT).catch(
          () => []
        ),
        fetchRefunds(userAddress, PAYMENTS_FETCH_LIMIT).catch(() => []),
      ]);
      const allRecords = [
        ...mapDepositIntentRecords(depositIntents),
        ...mapConsumerWithdrawalRecords(withdrawals),
        ...mapRefundRecords(refunds),
      ];
      allRecords.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(allRecords);
      setPaymentHistoryMayBeTruncated(
        depositIntents.length >= PAYMENTS_FETCH_LIMIT ||
          withdrawals.length >= PAYMENTS_FETCH_LIMIT ||
          refunds.length >= PAYMENTS_FETCH_LIMIT
      );
    } catch (error) {
      console.error("Failed to load ledger:", error);
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    fetchBalances();
    loadLedger();
  }, [fetchBalances, loadLedger]);

  return {
    loading,
    records,
    paymentHistoryMayBeTruncated,
    vaultBalance,
    walletBalance,
    refetch: () => {
      fetchBalances();
      loadLedger();
    },
  };
}
