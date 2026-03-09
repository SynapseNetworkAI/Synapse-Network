"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";
import A2APaySyncRouterABI from "@/A2APaySyncRouterABI.json";
import type { DeductionStatus } from "@/components/dashboard/shared/deductionStatus";
import { agentStore } from "@/utils/agentStore";

export type SettlementEvent = {
  serviceId: string;
  status: DeductionStatus;
  gross: number;
  platform_fee: number;
  seller_net: number;
  txHash: string;
  blockNumber: number;
};

export function useSettlementData() {
  const { address: userAddress } = useAccount();
  const [loading, setLoading] = useState(false);
  const [walletUsdc, setWalletUsdc] = useState(0);
  const [sellerRows, setSellerRows] = useState<SettlementEvent[]>([]);

  useEffect(() => {
    if (!userAddress) {
      setWalletUsdc(0);
      setSellerRows([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
        const usdc = new ethers.Contract(contractConfig.MockUSDC, MockUSDCABI, provider);
        const router = new ethers.Contract(contractConfig.A2APaySyncRouter, A2APaySyncRouterABI, provider);

        const ownerAgents = agentStore.getAgentsByOwner(userAddress);
        const sellerAddresses = new Set<string>([
          userAddress.toLowerCase(),
          ...ownerAgents.map((agent) => agent.address.toLowerCase()),
        ]);

        const walletBal = await usdc.balanceOf(userAddress);
        const usdcNum = Number.parseFloat(ethers.formatUnits(walletBal, 18));

        const logs = await router.queryFilter(router.filters.ServicePaid(null, null, null), 0, "latest");
        const events = logs
          .map((log) => {
            if (!("args" in log) || !log.args || log.args.length < 6) return null;
            const seller = String(log.args[1]).toLowerCase();
            if (!sellerAddresses.has(seller)) return null;

            const gross = Number.parseFloat(ethers.formatUnits(ethers.toBigInt(log.args[3]), 18));
            const platformFee = Number.parseFloat(ethers.formatUnits(ethers.toBigInt(log.args[4]), 18));
            return {
              serviceId: String(log.args[5]),
              status: "succeeded",
              gross,
              platform_fee: platformFee,
              seller_net: Math.max(0, gross - platformFee),
              txHash: log.transactionHash,
              blockNumber: log.blockNumber,
            } satisfies SettlementEvent;
          })
          .filter((item): item is SettlementEvent => item !== null)
          .sort((a, b) => b.blockNumber - a.blockNumber);

        if (!cancelled) {
          setWalletUsdc(usdcNum);
          setSellerRows(events);
        }
      } catch {
        if (!cancelled) {
          setWalletUsdc(0);
          setSellerRows([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [userAddress]);

  const totals = useMemo(() => {
    const seller_receivable = sellerRows.reduce((sum, row) => sum + row.seller_net, 0);
    const seller_gross = sellerRows.reduce((sum, row) => sum + row.gross, 0);
    const platform_fee = sellerRows.reduce((sum, row) => sum + row.platform_fee, 0);
    return { seller_receivable, seller_gross, platform_fee };
  }, [sellerRows]);

  return { userAddress, loading, walletUsdc, sellerRows, totals };
}
