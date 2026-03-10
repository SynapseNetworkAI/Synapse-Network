"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import contractConfig from "@/contract-config.json";
import { discoverServices, type ServiceRegistryRecord } from "@/utils/serviceApi";
import { createDepositIntent, getV2Balance } from "@/utils/balanceApi";
import { issueAgentCredential, listAgentCredentials, type AgentCredentialIssueResponse } from "@/utils/agentCredentialApi";
import { setCredentialForService } from "@/utils/agentCredentialStore";
import { getRouterConfig, saveRouterConfig } from "@/utils/routerConfigApi";

const erc20ApproveABI = [
  {
    constant: false,
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const erc20AllowanceABI = [
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const routerPayABI = [
  {
    inputs: [
      { internalType: "address", name: "token", type: "address" },
      { internalType: "address", name: "seller", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "string", name: "serviceId", type: "string" },
    ],
    name: "payForService",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const ROUTER_ADDRESS = contractConfig.A2APaySyncRouter as `0x${string}`;

type TxType = "approve" | "pay" | null;

type DailyLimitSectionProps = {
  isConnected: boolean;
  dailyLimit: string;
  isSavingDailyLimit: boolean;
  dailyLimitUpdatedAt: number | null;
  onDailyLimitChange: (next: string) => void;
  onSave: () => void;
};

function DailyLimitSection(props: Readonly<DailyLimitSectionProps>) {
  const {
    isConnected,
    dailyLimit,
    isSavingDailyLimit,
    dailyLimitUpdatedAt,
    onDailyLimitChange,
    onSave,
  } = props;
  return (
    <div className={`mt-8 bg-gray-900 border ${isConnected ? "border-blue-800" : "border-gray-800 opacity-50"} rounded-lg p-6`}>
      <h2 className="mb-4 text-xl font-semibold text-white">5. Configure Daily Limit (Platform Policy)</h2>
      <div className="space-y-4">
        <div>
          <label htmlFor="router-daily-limit" className="block mb-1 text-sm font-medium text-gray-400">Max Daily Spending (USDC)</label>
          <input
            id="router-daily-limit"
            type="number"
            value={dailyLimit}
            onChange={(e) => onDailyLimitChange(e.target.value)}
            disabled={!isConnected}
            className="w-full max-w-md p-2 text-white bg-black border border-gray-700 rounded"
          />
        </div>

        <button
          onClick={onSave}
          disabled={!isConnected || isSavingDailyLimit}
          className="px-6 py-2 font-bold text-white transition-colors bg-blue-600 rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSavingDailyLimit ? "Saving..." : "Save Daily Limit"}
        </button>

        {dailyLimitUpdatedAt ? <p className="text-xs text-gray-500">Last updated: {new Date(dailyLimitUpdatedAt * 1000).toLocaleString()}</p> : null}
      </div>
    </div>
  );
}

export default function RouterPage() { // NOSONAR
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("500");
  const [dailyLimit, setDailyLimit] = useState("50");
  const [isSavingDailyLimit, setIsSavingDailyLimit] = useState(false);
  const [dailyLimitUpdatedAt, setDailyLimitUpdatedAt] = useState<number | null>(null);

  const [services, setServices] = useState<ServiceRegistryRecord[]>([]);
  const [depositAmountUsdc, setDepositAmountUsdc] = useState("1");

  const [txType, setTxType] = useState<TxType>(null);
  const [handledHash, setHandledHash] = useState("");
  const [isProcessingPostPayment, setIsProcessingPostPayment] = useState(false);
  const [isIssuingCredentialOnly, setIsIssuingCredentialOnly] = useState(false);

  const [latestDepositStatus, setLatestDepositStatus] = useState("");
  const [latestBuyerBalance, setLatestBuyerBalance] = useState<number | null>(null);
  const [latestCredential, setLatestCredential] = useState<AgentCredentialIssueResponse | null>(null);
  const [hasActiveSharedCredential, setHasActiveSharedCredential] = useState(false);
  const [sharedCredentialExpiresAt, setSharedCredentialExpiresAt] = useState<number | null>(null);

  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { data: allowanceRaw } = useReadContract({
    address: contractConfig.MockUSDC as `0x${string}`,
    abi: erc20AllowanceABI,
    functionName: "allowance",
    args: address ? [address, ROUTER_ADDRESS] : undefined,
    query: {
      enabled: !!address,
    },
  });
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  const payTargetService = useMemo(() => services[0] || null, [services]);

  const payButtonLabel = useMemo(() => {
    if (isPending && txType === "pay") return "Waiting for Wallet...";
    if (isProcessingPostPayment) return "Processing deposit + credential...";
    return "Pay & Issue Credential";
  }, [isPending, isProcessingPostPayment, txType]);

  const allowanceUsdc = useMemo(() => {
    try {
      const raw = allowanceRaw ?? 0;
      return Number(formatUnits(BigInt(String(raw)), 18));
    } catch {
      return 0;
    }
  }, [allowanceRaw]);

  const requiredAllowanceUsdc = useMemo(() => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  }, [amount]);

  const hasEnoughAllowance = allowanceUsdc >= requiredAllowanceUsdc && requiredAllowanceUsdc > 0;
  const hasPositiveBuyerBalance = (latestBuyerBalance ?? 0) > 0;
  const setupReady = hasEnoughAllowance && hasPositiveBuyerBalance && hasActiveSharedCredential;
  const needsAllowanceFix = !hasEnoughAllowance;
  const needsBalanceFix = !hasPositiveBuyerBalance;
  const needsCredentialFix = !hasActiveSharedCredential;

  const payFixButtonLabel = useMemo(() => {
    if (isPending && txType === "pay") return "Paying...";
    if (isProcessingPostPayment) return "Processing...";
    return "Fix: Pay";
  }, [isPending, isProcessingPostPayment, txType]);

  const runPostPaymentFlow = useCallback(async (txHash: string) => {
    if (!address) return;

    const amountUsdc = Number(depositAmountUsdc);
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      toast.error("Invalid deposit amount");
      return;
    }

    setIsProcessingPostPayment(true);
    setLatestDepositStatus("submitting");

    try {
      const deposit = await createDepositIntent(address, {
        txHash,
        amountUsdc,
      });
      setLatestDepositStatus(deposit.status || "pending");

      const balance = await getV2Balance(address);
      setLatestBuyerBalance(balance.buyerBalance);

      const credential = await issueAgentCredential(address, {
        expiresInSec: 3600,
        maxCalls: 1000,
        rpm: 600,
      });

      setLatestCredential(credential);
      setHasActiveSharedCredential(true);
      setSharedCredentialExpiresAt(credential.expiresAt);
      services.forEach((item) => {
        setCredentialForService(item.serviceId, credential.token);
      });
      toast.success("Deposit intent submitted and shared credential issued for all services");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Post-payment process failed");
    } finally {
      setIsProcessingPostPayment(false);
    }
  }, [address, depositAmountUsdc, services]);

  useEffect(() => {
    discoverServices()
      .then((rows) => {
        setServices(rows);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Failed to load discover services");
      });
  }, []);

  useEffect(() => {
    if (!payTargetService) return;
    if (payTargetService.pricing && Number(payTargetService.pricing) > 0) {
      setDepositAmountUsdc(String(payTargetService.pricing));
    }
  }, [payTargetService]);

  useEffect(() => {
    if (!isConnected || !address) return;

    let cancelled = false;
    const loadConfig = async () => {
      try {
        const config = await getRouterConfig(address);
        if (!cancelled) {
          setDailyLimit(String(config.dailyLimitUsdc || 0));
          setDailyLimitUpdatedAt(typeof config.updatedAt === "number" ? config.updatedAt : null);
        }
      } catch {
      }
    };

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);

  useEffect(() => {
    if (!isConnected || !address) return;

    let cancelled = false;
    const loadSharedCredentialStatus = async () => {
      try {
        const rows = await listAgentCredentials(address);
        const nowSec = Math.floor(Date.now() / 1000);
        const activeShared = rows
          .filter((item) => item.status === "active" && !item.agentId && !item.serviceId && Number(item.expiresAt || 0) > nowSec)
          .sort((a, b) => Number(b.expiresAt || 0) - Number(a.expiresAt || 0))[0];

        if (!cancelled) {
          setHasActiveSharedCredential(!!activeShared);
          setSharedCredentialExpiresAt(activeShared ? Number(activeShared.expiresAt || 0) : null);
        }
      } catch {
        if (!cancelled) {
          setHasActiveSharedCredential(false);
          setSharedCredentialExpiresAt(null);
        }
      }
    };

    void loadSharedCredentialStatus();
    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);

  useEffect(() => {
    if (!isConnected || !address) return;

    let cancelled = false;
    const loadBalance = async () => {
      try {
        const balance = await getV2Balance(address);
        if (!cancelled) {
          setLatestBuyerBalance(balance.buyerBalance);
        }
      } catch {
      }
    };

    void loadBalance();
    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);

  useEffect(() => {
    if (!isConfirmed || !hash || handledHash === hash) return;

    setHandledHash(hash);
    localStorage.setItem("routerSetupComplete", "true");

    if (txType === "approve") {
      toast.success("Allowance confirmed on-chain");
      return;
    }

    if (txType !== "pay") return;
    void runPostPaymentFlow(hash);
  }, [handledHash, hash, isConfirmed, runPostPaymentFlow, txType]);

  const handleApprove = () => {
    setTxType("approve");
    writeContract({
      address: contractConfig.MockUSDC as `0x${string}`,
      abi: erc20ApproveABI,
      functionName: "approve",
      args: [ROUTER_ADDRESS, parseUnits(amount, 18)],
    });
  };

  const handlePayAndIssue = () => {
    const amountUsdc = Number(depositAmountUsdc);
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      toast.error("Deposit amount must be > 0");
      return;
    }

    const fallbackSeller: `0x${string}` = address ?? "0x0000000000000000000000000000000000000000";
    const targetSeller: `0x${string}` = fallbackSeller;
    const targetServiceId = payTargetService?.serviceId || "GLOBAL_SHARED_CREDIT";

    setTxType("pay");
    setLatestCredential(null);
    setLatestDepositStatus("");

    writeContract({
      address: ROUTER_ADDRESS,
      abi: routerPayABI,
      functionName: "payForService",
      args: [
        contractConfig.MockUSDC as `0x${string}`,
        targetSeller,
        parseUnits(String(amountUsdc), 18),
        targetServiceId,
      ],
    });
  };

  const handleSaveDailyLimit = async () => {
    if (!isConnected || !address) return;

    const nextDailyLimit = Number(dailyLimit);
    if (!Number.isFinite(nextDailyLimit) || nextDailyLimit < 0) {
      toast.error("Daily limit must be a number >= 0");
      return;
    }

    setIsSavingDailyLimit(true);
    try {
      const config = await saveRouterConfig(address, nextDailyLimit);
      setDailyLimit(String(config.dailyLimitUsdc));
      setDailyLimitUpdatedAt(typeof config.updatedAt === "number" ? config.updatedAt : null);
      localStorage.setItem("routerSetupComplete", "true");
      toast.success("Daily limit saved to platform policy");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save daily limit");
    } finally {
      setIsSavingDailyLimit(false);
    }
  };

  const handleIssueSharedCredentialOnly = async () => {
    if (!isConnected || !address) {
      toast.error("Please connect wallet first");
      return;
    }

    setIsIssuingCredentialOnly(true);
    try {
      const credential = await issueAgentCredential(address, {
        expiresInSec: 3600,
        maxCalls: 1000,
        rpm: 600,
      });
      setLatestCredential(credential);
      setHasActiveSharedCredential(true);
      setSharedCredentialExpiresAt(credential.expiresAt);
      services.forEach((item) => {
        setCredentialForService(item.serviceId, credential.token);
      });
      toast.success("Shared credential issued");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to issue shared credential");
    } finally {
      setIsIssuingCredentialOnly(false);
    }
  };

  return (
    <div className="max-w-4xl p-8 mx-auto">
      <h1 className="mb-6 text-3xl font-bold text-green-400">Router Payment & Credential Issuance</h1>
      <p className="py-2 pl-4 mb-4 text-gray-400 border-l-4 border-green-500">
        Discover 页面只做服务展示；本页承接支付入口并签发一张共享凭据给所有 Agent 调用所有接口。
      </p>

      <div className="p-6 mb-8 bg-gray-900 border border-gray-800 rounded-lg">
        <h2 className="mb-4 text-xl font-semibold text-white">1. Connect Master Wallet</h2>
        <ConnectButton />
        {!isConnected && <p className="mt-2 text-sm text-yellow-500">Please connect a wallet to proceed.</p>}
      </div>

      <div className="p-6 mb-8 bg-gray-900 border border-gray-800 rounded-lg">
        <h2 className="mb-4 text-xl font-semibold text-white">Setup Status (persists after refresh)</h2>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <p className={hasEnoughAllowance ? "text-green-400" : "text-yellow-400"}>
              {hasEnoughAllowance ? "✅" : "⏳"} Allowance: {allowanceUsdc.toFixed(4)} / required {requiredAllowanceUsdc.toFixed(4)} USDC
            </p>
            {needsAllowanceFix ? (
              <button
                onClick={handleApprove}
                disabled={!isConnected || isPending}
                className="px-3 py-1 text-xs font-bold text-white bg-green-600 rounded hover:bg-green-500 disabled:opacity-50"
              >
                {isPending && txType === "approve" ? "Approving..." : "Fix: Approve"}
              </button>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className={hasPositiveBuyerBalance ? "text-green-400" : "text-yellow-400"}>
              {hasPositiveBuyerBalance ? "✅" : "⏳"} V2 Buyer Balance: {(latestBuyerBalance ?? 0).toFixed(6)} USDC
            </p>
            {needsBalanceFix ? (
              <button
                onClick={handlePayAndIssue}
                disabled={!isConnected || isPending || isProcessingPostPayment}
                className="px-3 py-1 text-xs font-bold text-white bg-purple-600 rounded hover:bg-purple-500 disabled:opacity-50"
              >
                {payFixButtonLabel}
              </button>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className={hasActiveSharedCredential ? "text-green-400" : "text-yellow-400"}>
              {hasActiveSharedCredential ? "✅" : "⏳"} Shared Credential: {hasActiveSharedCredential ? "active" : "not issued"}
              {hasActiveSharedCredential && sharedCredentialExpiresAt ? ` (expires ${new Date(sharedCredentialExpiresAt * 1000).toLocaleString()})` : ""}
            </p>
            {needsCredentialFix ? (
              <button
                onClick={handleIssueSharedCredentialOnly}
                disabled={!isConnected || isIssuingCredentialOnly}
                className="px-3 py-1 text-xs font-bold text-white bg-cyan-600 rounded hover:bg-cyan-500 disabled:opacity-50"
              >
                {isIssuingCredentialOnly ? "Issuing..." : "Fix: Issue Credential"}
              </button>
            ) : null}
          </div>
        </div>
        <p className={`mt-3 text-sm font-semibold ${setupReady ? "text-green-300" : "text-gray-400"}`}>
          {setupReady ? "Ready: agent can invoke APIs now." : "Not ready yet: complete remaining ⏳ steps above."}
        </p>
      </div>

      <div className={`bg-gray-900 border ${isConnected ? "border-green-800" : "border-gray-800 opacity-50"} rounded-lg p-6`}>
        <h2 className="mb-4 text-xl font-semibold text-white">2. Set Allowance Threshold</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="router-allowance" className="block mb-1 text-sm font-medium text-gray-400">Max Allowance (USDC)</label>
            <input
              id="router-allowance"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!isConnected}
              className="w-full max-w-md p-2 text-white bg-black border border-gray-700 rounded"
            />
          </div>

          <button
            onClick={handleApprove}
            disabled={!isConnected || isPending}
            className="px-6 py-2 font-bold text-white transition-colors bg-green-600 rounded hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending && txType === "approve" ? "Waiting for Wallet..." : "Approve Router"}
          </button>

          {isConfirming && txType === "approve" && <p className="text-sm text-yellow-400">Waiting for confirmation...</p>}
          {isConfirmed && txType === "approve" && <p className="text-sm font-bold text-green-400">✅ On-chain allowance confirmed.</p>}
          {error && <p className="text-sm text-red-500">Error: {(error as { shortMessage?: string }).shortMessage || error.message}</p>}
        </div>
      </div>

      <div className={`mt-8 bg-gray-900 border ${isConnected ? "border-purple-800" : "border-gray-800 opacity-50"} rounded-lg p-6`}>
        <h2 className="mb-4 text-xl font-semibold text-white">3. Pay and Issue Credential</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="router-deposit-amount" className="block mb-1 text-sm font-medium text-gray-400">Deposit Amount (USDC)</label>
            <input
              id="router-deposit-amount"
              type="number"
              value={depositAmountUsdc}
              onChange={(e) => setDepositAmountUsdc(e.target.value)}
              disabled={!isConnected}
              className="w-full max-w-md p-2 text-white bg-black border border-gray-700 rounded"
            />
          </div>

          <button
            onClick={handlePayAndIssue}
            disabled={!isConnected || isPending || isProcessingPostPayment}
            className="px-6 py-2 font-bold text-white transition-colors bg-purple-600 rounded hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {payButtonLabel}
          </button>

          {hash && txType === "pay" ? (
            <p className="font-mono text-xs text-purple-300 break-all">txHash: {hash}</p>
          ) : null}
          {isConfirming && txType === "pay" ? <p className="text-sm text-yellow-400">Waiting payment tx confirmation...</p> : null}

          {latestDepositStatus ? <p className="text-sm text-cyan-300">Deposit Intent Status: {latestDepositStatus}</p> : null}
          {latestBuyerBalance === null ? null : <p className="text-sm text-yellow-300">Buyer Balance: {latestBuyerBalance.toFixed(6)} USDC</p>}

          {latestCredential ? (
            <div className="p-4 border rounded bg-green-900/10 border-green-700/40">
              <p className="text-xs tracking-wide text-green-300 uppercase">Credential issued (shown once)</p>
              <p className="mt-1 text-xs text-gray-400">Scope: shared across all services and buyer agents under this owner</p>
              <p className="mt-2 font-mono text-xs text-green-200 break-all">{latestCredential.token}</p>
            </div>
          ) : null}
        </div>
      </div>

      <DailyLimitSection
        isConnected={isConnected}
        dailyLimit={dailyLimit}
        isSavingDailyLimit={isSavingDailyLimit}
        dailyLimitUpdatedAt={dailyLimitUpdatedAt}
        onDailyLimitChange={setDailyLimit}
        onSave={handleSaveDailyLimit}
      />
    </div>
  );
}
