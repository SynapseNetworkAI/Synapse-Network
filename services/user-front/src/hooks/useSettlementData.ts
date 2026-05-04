"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";
import SynapseCoreABI from "@/SynapseCoreABI.json";
import type { DeductionStatus } from "@/components/dashboard/shared/deductionStatus";
import { listUsageLogs } from "@/utils/usageApi";
import { moneyStringToNumber, normalizeMoneyString } from "@/utils/money";
import { getRpcUrl } from "@/utils/runtimeEnv";

export type SettlementEvent = {
  serviceId: string;
  status: DeductionStatus;
  gross: number;
  platform_fee: number;
  provider_net: number;
  txHash: string;
  blockNumber: number;
};

type UsageLogRow = Awaited<ReturnType<typeof listUsageLogs>>[number];

type SettlementSnapshot = {
  walletUsdc: number;
  providerRows: SettlementEvent[];
};

function sortSettlementEvents(rows: SettlementEvent[]) {
  return rows.sort((a, b) => b.blockNumber - a.blockNumber);
}

function createReadContracts() {
  const provider = new ethers.JsonRpcProvider(getRpcUrl());
  return {
    router: new ethers.Contract(
      contractConfig.SynapseCore,
      SynapseCoreABI,
      provider
    ),
    usdc: new ethers.Contract(contractConfig.MockUSDC, MockUSDCABI, provider),
  };
}

async function readWalletUsdc(
  usdc: ethers.Contract,
  userAddress: string
): Promise<number> {
  const walletBal = await usdc.balanceOf(userAddress);
  return moneyStringToNumber(
    normalizeMoneyString(ethers.formatUnits(walletBal, 18))
  );
}

function usageLogToSettlementEvent(
  item: UsageLogRow,
  index: number,
  providerAddresses: Set<string>
): SettlementEvent | null {
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
  };
}

async function fetchUsageSettlementEvents(
  userAddress: string,
  providerAddresses: Set<string>
) {
  const usageRows = await listUsageLogs(userAddress, 300);
  const usageEvents = usageRows
    .map((item, index) =>
      usageLogToSettlementEvent(item, index, providerAddresses)
    )
    .filter((row): row is SettlementEvent => row !== null);

  return sortSettlementEvents(usageEvents);
}

function chainLogToSettlementEvent(
  log: ethers.EventLog | ethers.Log,
  providerAddresses: Set<string>
): SettlementEvent | null {
  if (!("args" in log) || !log.args || log.args.length < 6) return null;
  const provider = String(log.args[1]).toLowerCase();
  if (!providerAddresses.has(provider)) return null;

  const gross = moneyStringToNumber(
    normalizeMoneyString(ethers.formatUnits(ethers.toBigInt(log.args[3]), 18))
  );
  const platformFee = moneyStringToNumber(
    normalizeMoneyString(ethers.formatUnits(ethers.toBigInt(log.args[4]), 18))
  );

  return {
    serviceId: String(log.args[5]),
    status: "succeeded",
    gross,
    platform_fee: platformFee,
    provider_net: Math.max(0, gross - platformFee),
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
  };
}

async function fetchChainSettlementEvents(
  router: ethers.Contract,
  providerAddresses: Set<string>
) {
  const logs = await router.queryFilter(
    router.filters.ServicePaid(null, null, null),
    0,
    "latest"
  );
  const events = logs
    .map((log) => chainLogToSettlementEvent(log, providerAddresses))
    .filter((row): row is SettlementEvent => row !== null);

  return sortSettlementEvents(events);
}

async function loadSettlementSnapshot(
  userAddress: string
): Promise<SettlementSnapshot> {
  const { router, usdc } = createReadContracts();
  const providerAddresses = new Set<string>([userAddress.toLowerCase()]);
  const walletUsdc = await readWalletUsdc(usdc, userAddress);

  try {
    const providerRows = await fetchUsageSettlementEvents(
      userAddress,
      providerAddresses
    );
    return { walletUsdc, providerRows };
  } catch {}

  const providerRows = await fetchChainSettlementEvents(
    router,
    providerAddresses
  );
  return { walletUsdc, providerRows };
}

function useSettlementLoader(
  userAddress: string | undefined,
  setLoading: (value: boolean) => void,
  setProviderRows: (rows: SettlementEvent[]) => void,
  setWalletUsdc: (value: number) => void
) {
  useEffect(() => {
    if (!userAddress) {
      setWalletUsdc(0);
      setProviderRows([]);
      return;
    }

    let cancelled = false;
    const commitEmptyState = () => {
      if (cancelled) return;
      setWalletUsdc(0);
      setProviderRows([]);
    };
    const commitSnapshot = (snapshot: SettlementSnapshot) => {
      if (cancelled) return;
      setWalletUsdc(snapshot.walletUsdc);
      setProviderRows(snapshot.providerRows);
    };

    const load = async () => {
      setLoading(true);
      try {
        commitSnapshot(await loadSettlementSnapshot(userAddress));
      } catch {
        commitEmptyState();
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
  }, [setLoading, setProviderRows, setWalletUsdc, userAddress]);
}

export function useSettlementData() {
  const { address: userAddress } = useAccount();
  const [loading, setLoading] = useState(false);
  const [walletUsdc, setWalletUsdc] = useState(0);
  const [providerRows, setProviderRows] = useState<SettlementEvent[]>([]);

  useSettlementLoader(userAddress, setLoading, setProviderRows, setWalletUsdc);

  const totals = useMemo(() => {
    const provider_receivable = providerRows.reduce(
      (sum, row) => sum + row.provider_net,
      0
    );
    const provider_gross = providerRows.reduce(
      (sum, row) => sum + row.gross,
      0
    );
    const platform_fee = providerRows.reduce(
      (sum, row) => sum + row.platform_fee,
      0
    );
    return { provider_receivable, provider_gross, platform_fee };
  }, [providerRows]);

  return { userAddress, loading, walletUsdc, providerRows, totals };
}
