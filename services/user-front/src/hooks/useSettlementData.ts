"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";
import SynapseCoreABI from "@/SynapseCoreABI.json";
import type { DeductionStatus } from "@/components/dashboard/shared/deductionStatus";
import { listUsageLogs } from "@/utils/usageApi";

export type SettlementEvent = {
  serviceId: string;
  status: DeductionStatus;
  gross: number;
  platform_fee: number;
  provider_net: number;
  txHash: string;
  blockNumber: number;
};

export function useSettlementData() {
  const { address: userAddress } = useAccount();
  const [loading, setLoading] = useState(false);
  const [walletUsdc, setWalletUsdc] = useState(0);
  const [providerRows, setProviderRows] = useState<SettlementEvent[]>([]);

  useEffect(() => {
    if (!userAddress) {
      setWalletUsdc(0);
      setProviderRows([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
        const usdc = new ethers.Contract(contractConfig.MockUSDC, MockUSDCABI, provider);
        const router = new ethers.Contract(contractConfig.SynapseCore, SynapseCoreABI, provider);

        const providerAddresses = new Set<string>([
          userAddress.toLowerCase(),
        ]);


        const walletBal = await usdc.balanceOf(userAddress);
        const usdcNum = Number.parseFloat(ethers.formatUnits(walletBal, 18));

        try {
          const usageRows = await listUsageLogs(userAddress, 300);
          const usageEvents = (usageRows
            .map((item, index) => {
              const provider = (item.providerAddress || "").toLowerCase();
              if (!providerAddresses.has(provider)) return null;

              const gross = item.unit_price ?? 0;
              const platformFee = item.platform_fee ?? 0;
              const providerNet = item.provider_net ?? Math.max(0, gross - platformFee);

              return {
                serviceId: item.service_id || "unknown",
                status: item.status,
                gross,
                platform_fee: platformFee,
                provider_net: providerNet,
                txHash: item.tx_hash || item.request_id,
                blockNumber: item.block_number ?? item.created_at ?? index,
              } satisfies SettlementEvent;
            })
            .filter(Boolean) as SettlementEvent[])
            .sort((a, b) => b.blockNumber - a.blockNumber);

          if (!cancelled) {
            setWalletUsdc(usdcNum);
            setProviderRows(usageEvents);
          }
          return;
        } catch {
        }

        const logs = await router.queryFilter(router.filters.ServicePaid(null, null, null), 0, "latest");
        const events = (logs
          .map((log) => {
            if (!("args" in log) || !log.args || log.args.length < 6) return null;
            const provider = String(log.args[1]).toLowerCase();
            if (!providerAddresses.has(provider)) return null;

            const gross = Number.parseFloat(ethers.formatUnits(ethers.toBigInt(log.args[3]), 18));
            const platformFee = Number.parseFloat(ethers.formatUnits(ethers.toBigInt(log.args[4]), 18));
            return {
              serviceId: String(log.args[5]),
              status: "succeeded",
              gross,
              platform_fee: platformFee,
              provider_net: Math.max(0, gross - platformFee),
              txHash: log.transactionHash,
              blockNumber: log.blockNumber,
            } satisfies SettlementEvent;
          })
          .filter(Boolean) as SettlementEvent[])
          .sort((a, b) => b.blockNumber - a.blockNumber);

        if (!cancelled) {
          setWalletUsdc(usdcNum);
          setProviderRows(events);
        }
      } catch {
        if (!cancelled) {
          setWalletUsdc(0);
          setProviderRows([]);
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
    const provider_receivable = providerRows.reduce((sum, row) => sum + row.provider_net, 0);
    const provider_gross = providerRows.reduce((sum, row) => sum + row.gross, 0);
    const platform_fee = providerRows.reduce((sum, row) => sum + row.platform_fee, 0);
    return { provider_receivable, provider_gross, platform_fee };
  }, [providerRows]);

  return { userAddress, loading, walletUsdc, providerRows, totals };
}
