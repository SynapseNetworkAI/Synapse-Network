"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import contractConfig from "@/contract-config.json";
import A2APaySyncRouterABI from "@/A2APaySyncRouterABI.json";
import type { DeductionStatus } from "@/components/dashboard/shared/deductionStatus";
import { agentStore } from "@/utils/agentStore";
import { listUsageLogs } from "@/utils/usageApi";

export type BillingRow = {
  request_id: string;
  status: DeductionStatus;
  buyer: string;
  seller: string;
  serviceId: string;
  unit_price: number;
  platform_fee: number;
  seller_net: number;
  txHash: string;
  blockNumber: number;
  timestamp: number;
  direction: "spend" | "income";
};

export function useBillingData() {
  const { address: userAddress } = useAccount();
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userAddress) {
      setRows([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
        const router = new ethers.Contract(contractConfig.A2APaySyncRouter, A2APaySyncRouterABI, provider);

        const ownerAgents = agentStore.getAgentsByOwner(userAddress);
        const trackedAddresses = new Set<string>([
          userAddress.toLowerCase(),
          ...ownerAgents.map((agent) => agent.address.toLowerCase()),
        ]);

        try {
          const usageRows = await listUsageLogs(userAddress, 300);
          const mappedUsage = usageRows
            .map((item, index) => {
              const buyer = item.buyer || "";
              const seller = item.seller || "";
              const buyerMatch = buyer ? trackedAddresses.has(buyer.toLowerCase()) : false;
              const sellerMatch = seller ? trackedAddresses.has(seller.toLowerCase()) : false;
              if (!buyerMatch && !sellerMatch) return null;

              const unitPrice = item.unit_price ?? 0;
              const platformFee = item.platform_fee ?? 0;
              const sellerNet = item.seller_net ?? Math.max(0, unitPrice - platformFee);
              const timestamp = item.created_at ?? 0;
              const blockNumber = (item.block_number ?? timestamp) || index;

              return {
                request_id: item.request_id,
                status: item.status,
                buyer,
                seller,
                serviceId: item.service_id || "unknown",
                unit_price: unitPrice,
                platform_fee: platformFee,
                seller_net: sellerNet,
                txHash: item.tx_hash || item.request_id,
                blockNumber,
                timestamp,
                direction: buyerMatch ? "spend" : "income",
              } satisfies BillingRow;
            })
            .filter((item): item is BillingRow => item !== null)
            .sort((a, b) => (b.timestamp || b.blockNumber) - (a.timestamp || a.blockNumber));

          if (!cancelled) {
            setRows(mappedUsage);
          }
          return;
        } catch {
        }

        const logs = await router.queryFilter(router.filters.ServicePaid(null, null, null), 0, "latest");
        const mapped = await Promise.all(
          logs.map(async (log) => {
            if (!("args" in log) || !log.args || log.args.length < 6) return null;

            const buyer = String(log.args[0]);
            const seller = String(log.args[1]);
            const buyerMatch = trackedAddresses.has(buyer.toLowerCase());
            const sellerMatch = trackedAddresses.has(seller.toLowerCase());
            if (!buyerMatch && !sellerMatch) return null;

            const block = await provider.getBlock(log.blockNumber);
            const timestamp = block?.timestamp ? Number(block.timestamp) : 0;

            const unitPrice = Number.parseFloat(ethers.formatUnits(ethers.toBigInt(log.args[3]), 18));
            const platformFee = Number.parseFloat(ethers.formatUnits(ethers.toBigInt(log.args[4]), 18));

            return {
              request_id: log.transactionHash,
              status: "succeeded",
              buyer,
              seller,
              serviceId: String(log.args[5]),
              unit_price: unitPrice,
              platform_fee: platformFee,
              seller_net: Math.max(0, unitPrice - platformFee),
              txHash: log.transactionHash,
              blockNumber: log.blockNumber,
              timestamp,
              direction: buyerMatch ? "spend" : "income",
            } satisfies BillingRow;
          })
        );

        if (!cancelled) {
          const normalized = (mapped.filter(Boolean) as BillingRow[]).sort((a, b) => b.blockNumber - a.blockNumber);
          setRows(normalized);
        }
      } catch {
        if (!cancelled) {
          setRows([]);
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

  const summary = useMemo(() => {
    let totalSpend = 0;
    let totalIncome = 0;
    let totalPlatformFee = 0;
    for (const row of rows) {
      if (row.direction === "spend") totalSpend += row.unit_price;
      if (row.direction === "income") totalIncome += row.seller_net;
      totalPlatformFee += row.platform_fee;
    }
    return { totalSpend, totalIncome, totalPlatformFee };
  }, [rows]);

  return { userAddress, rows, loading, summary };
}
