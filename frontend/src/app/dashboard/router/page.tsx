"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
  useSignTypedData,
  useChainId,
} from "wagmi";
import { parseUnits, parseSignature, parseAbi } from "viem";
import contractConfig from "@/contract-config.json";
import {
  discoverServices,
  type ServiceRegistryRecord,
} from "@/utils/serviceApi";
import { createDepositIntent, getV2Balance } from "@/utils/balanceApi";
import {
  issueAgentCredential,
  listAgentCredentials,
  type AgentCredentialIssueResponse,
} from "@/utils/agentCredentialApi";
import { setCredentialForService } from "@/utils/agentCredentialStore";
import { getRouterConfig, saveRouterConfig } from "@/utils/routerConfigApi";


const ROUTER_ADDRESS = contractConfig.A2APaySyncRouter as `0x${string}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const VAULT_ADDRESS = (contractConfig as any).A2APayVault ? ((contractConfig as any).A2APayVault as `0x${string}`) : ROUTER_ADDRESS;

const vaultABI = parseAbi([
  "function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external"
]);

type TxType = "approve" | "pay" | null;

type LimitSectionProps = {
  isConnected: boolean;

  dailyLimit: string;
  isDailyLimitEnabled: boolean;
  onDailyLimitChange: (val: string) => void;
  onDailyToggle: (val: boolean) => void;

  monthlyLimit: string;
  isMonthlyLimitEnabled: boolean;
  onMonthlyLimitChange: (val: string) => void;
  onMonthlyToggle: (val: boolean) => void;

  isSavingLimit: boolean;
  limitUpdatedAt: number | null;
  onSave: () => void;
};

function LimitPoliciesSection(props: Readonly<LimitSectionProps>) {
  const {
    isConnected,
    dailyLimit,
    isDailyLimitEnabled,
    onDailyLimitChange,
    onDailyToggle,
    monthlyLimit,
    isMonthlyLimitEnabled,
    onMonthlyLimitChange,
    onMonthlyToggle,
    isSavingLimit,
    limitUpdatedAt,
    onSave,
  } = props;

  return (
    <div
      className={`mt-8 bg-gray-900 border ${
        isConnected ? "border-blue-800" : "border-gray-800 opacity-50"
      } rounded-lg p-6`}
    >
      <h2 className="mb-4 text-xl font-semibold text-white">
        3. Set Off-chain Limits (Platform Policy)
      </h2>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Monthly Limit */}
        <div className="p-4 border border-gray-700 rounded-lg bg-gray-800/30">
          <div className="flex items-center justify-between mb-4">
            <label className="text-base font-semibold text-gray-200">
              Monthly Limit
            </label>
            <label className="flex items-center cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={isMonthlyLimitEnabled}
                  onChange={(e) => onMonthlyToggle(e.target.checked)}
                  disabled={!isConnected}
                />
                <div
                  className={`block w-12 h-7 rounded-full ${
                    isMonthlyLimitEnabled ? "bg-green-600" : "bg-gray-600"
                  }`}
                ></div>
                <div
                  className={`dot absolute left-1 top-1 bg-white w-5 h-5 rounded-full transition-transform ${
                    isMonthlyLimitEnabled ? "translate-x-5" : ""
                  }`}
                ></div>
              </div>
            </label>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-gray-400">
              Max Monthly Spending (USDC)
            </label>
            <input
              type="number"
              value={monthlyLimit}
              onChange={(e) => onMonthlyLimitChange(e.target.value)}
              disabled={!isConnected || !isMonthlyLimitEnabled}
              className="w-full p-2 text-white bg-black border border-gray-700 rounded disabled:opacity-50"
              placeholder="e.g. 500"
            />
          </div>
        </div>

        {/* Daily Limit */}
        <div className="p-4 border border-gray-700 rounded-lg bg-gray-800/30">
          <div className="flex items-center justify-between mb-4">
            <label className="text-base font-semibold text-gray-200">
              Daily Limit
            </label>
            <label className="flex items-center cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={isDailyLimitEnabled}
                  onChange={(e) => onDailyToggle(e.target.checked)}
                  disabled={!isConnected}
                />
                <div
                  className={`block w-12 h-7 rounded-full ${
                    isDailyLimitEnabled ? "bg-green-600" : "bg-gray-600"
                  }`}
                ></div>
                <div
                  className={`dot absolute left-1 top-1 bg-white w-5 h-5 rounded-full transition-transform ${
                    isDailyLimitEnabled ? "translate-x-5" : ""
                  }`}
                ></div>
              </div>
            </label>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-gray-400">
              Max Daily Spending (USDC)
            </label>
            <input
              type="number"
              value={dailyLimit}
              onChange={(e) => onDailyLimitChange(e.target.value)}
              disabled={!isConnected || !isDailyLimitEnabled}
              className="w-full p-2 text-white bg-black border border-gray-700 rounded disabled:opacity-50"
              placeholder="e.g. 50"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 mt-6 sm:flex-row">
        <button
          onClick={onSave}
          disabled={!isConnected || isSavingLimit}
          className="px-6 py-2 font-bold text-white transition-colors bg-blue-600 rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSavingLimit ? "Saving..." : "Save Policies"}
        </button>

        {limitUpdatedAt ? (
          <p className="text-xs text-gray-500">
            Last updated: {new Date(limitUpdatedAt * 1000).toLocaleString()}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function RouterPage() {
  // NOSONAR
  const { address, isConnected } = useAccount();

  const [dailyLimit, setDailyLimit] = useState("50");
  const [isDailyLimitEnabled, setIsDailyLimitEnabled] = useState(true);
  const [monthlyLimit, setMonthlyLimit] = useState("500");
  const [isMonthlyLimitEnabled, setIsMonthlyLimitEnabled] = useState(true);
  const [isSavingLimit, setIsSavingLimit] = useState(false);
  const [limitUpdatedAt, setLimitUpdatedAt] = useState<number | null>(null);

  const [services, setServices] = useState<ServiceRegistryRecord[]>([]);
  const [depositAmountUsdc, setDepositAmountUsdc] = useState("1");

  const [txType, setTxType] = useState<TxType>(null);
  const [handledHash, setHandledHash] = useState("");
  const [isProcessingPostPayment, setIsProcessingPostPayment] = useState(false);
  const [isIssuingCredentialOnly, setIsIssuingCredentialOnly] = useState(false);

  const [latestDepositStatus, setLatestDepositStatus] = useState("");
  const [latestBuyerBalance, setLatestBuyerBalance] = useState<number | null>(
    null
  );
  const [latestCredential, setLatestCredential] =
    useState<AgentCredentialIssueResponse | null>(null);
  const [hasActiveSharedCredential, setHasActiveSharedCredential] =
    useState(false);
  const [sharedCredentialExpiresAt, setSharedCredentialExpiresAt] = useState<
    number | null
  >(null);

  const { data: hash, writeContractAsync, isPending } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const chainId = useChainId();

  const { data: usdcNonce } = useReadContract({
    address: contractConfig.MockUSDC as `0x${string}`,
    abi: parseAbi(["function nonces(address) view returns (uint256)"]),
    functionName: "nonces",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    }
  });

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash });

  const payTargetService = useMemo(() => services[0] || null, [services]);

  const payButtonLabel = useMemo(() => {
    if (isPending && txType === "pay") return "Waiting for Wallet...";
    if (isConfirming && txType === "pay") return "Waiting for Block...";
    if (isProcessingPostPayment) return "Processing deposit + credential...";
    return "Pay & Issue Credential";
  }, [isPending, isConfirming, isProcessingPostPayment, txType]);

  
  const hasPositiveBuyerBalance = (latestBuyerBalance ?? 0) > 0;
  const setupReady = hasPositiveBuyerBalance && hasActiveSharedCredential;
  const needsBalanceFix = !hasPositiveBuyerBalance;
  const needsCredentialFix = !hasActiveSharedCredential;

  const payFixButtonLabel = useMemo(() => {
    if (isPending && txType === "pay") return "Paying...";
    if (isConfirming && txType === "pay") return "Confirming...";
    if (isProcessingPostPayment) return "Processing...";
    return "Fix: Pay";
  }, [isPending, isConfirming, isProcessingPostPayment, txType]);

  const runPostPaymentFlow = useCallback(
    async (txHash: string) => {
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
        toast.success(
          "Deposit intent submitted and shared credential issued for all services"
        );
      } catch (err: unknown) {
        toast.error(
          err instanceof Error ? err.message : "Post-payment process failed"
        );
      } finally {
        setIsProcessingPostPayment(false);
      }
    },
    [address, depositAmountUsdc, services]
  );

  useEffect(() => {
    discoverServices()
      .then((rows) => {
        setServices(rows);
      })
      .catch((err: unknown) => {
        toast.error(
          err instanceof Error
            ? err.message
            : "Failed to load discover services"
        );
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
          setDailyLimit(String(config.dailyLimitUsdc || 50));
          setLimitUpdatedAt(
            typeof config.updatedAt === "number" ? config.updatedAt : null
          );
        }
      } catch {}
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
          .filter(
            (item) =>
              item.status === "active" &&
              !item.agentId &&
              !item.serviceId &&
              Number(item.expiresAt || 0) > nowSec
          )
          .sort(
            (a, b) => Number(b.expiresAt || 0) - Number(a.expiresAt || 0)
          )[0];

        if (!cancelled) {
          setHasActiveSharedCredential(!!activeShared);
          setSharedCredentialExpiresAt(
            activeShared ? Number(activeShared.expiresAt || 0) : null
          );
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
      } catch {}
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

    if (txType !== "pay") return;
    void runPostPaymentFlow(hash);
  }, [handledHash, hash, isConfirmed, runPostPaymentFlow, txType]);

  
  const handlePayAndIssue = async () => {
    if (!address) {
      toast.error("Please connect wallet first");
      return;
    }
    const amountUsdc = Number(depositAmountUsdc);
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      toast.error("Deposit amount must be > 0");
      return;
    }

    try {
      const amountBigInt = parseUnits(String(amountUsdc), 18);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour
      const nonce = usdcNonce ?? BigInt(0);

      setTxType("pay");
      setLatestCredential(null);
      setLatestDepositStatus("");

      // 1. Sign ERC-2612 Permit
      const signature = await signTypedDataAsync({
        domain: {
          name: "Mock USDC", // Must match the MockUSDC token name exactly
          version: "1",
          chainId: chainId,
          verifyingContract: contractConfig.MockUSDC as `0x${string}`,
        },
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Permit",
        message: {
          owner: address,
          spender: VAULT_ADDRESS,
          value: amountBigInt,
          nonce,
          deadline,
        },
      });

      // 2. Parse signature v, r, s
      const { v, r, s } = parseSignature(signature);

      // 3. Send transaction to Vault
      await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultABI,
        functionName: "depositWithPermit",
        args: [amountBigInt, deadline, Number(v), r, s],
      });
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to sign or send transaction");
    }
  };

  const handleSavePolicies = async () => {
    if (!isConnected || !address) return;

    setIsSavingLimit(true);
    try {
      const nextDaily = isDailyLimitEnabled ? Number(dailyLimit) : -1;
      // const nextMonthly = isMonthlyLimitEnabled ? Number(monthlyLimit) : -1;
      const config = await saveRouterConfig(
        address,
        nextDaily > 0 ? nextDaily : 0
      );
      setDailyLimit(String(config.dailyLimitUsdc));
      setLimitUpdatedAt(
        typeof config.updatedAt === "number" ? config.updatedAt : null
      );
      localStorage.setItem("routerSetupComplete", "true");
      toast.success("Limits saved to platform policy");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save limits");
    } finally {
      setIsSavingLimit(false);
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
      toast.error(
        err instanceof Error ? err.message : "Failed to issue shared credential"
      );
    } finally {
      setIsIssuingCredentialOnly(false);
    }
  };

  return (
    <div className="max-w-4xl p-8 mx-auto">
      <h1 className="mb-6 text-3xl font-bold text-green-400">
        Router Payment & Credential Issuance
      </h1>
      <p className="py-2 pl-4 mb-4 text-gray-400 border-l-4 border-green-500">
        Discover 页面只做服务展示；本页承接支付入口并签发一张共享凭据给所有
        Agent 调用所有接口。
      </p>

      <div className="p-6 mb-8 bg-gray-900 border border-gray-800 rounded-lg">
        <h2 className="mb-4 text-xl font-semibold text-white">
          1. Connect Master Wallet
        </h2>
        <ConnectButton />
        {!isConnected && (
          <p className="mt-2 text-sm text-yellow-500">
            Please connect a wallet to proceed.
          </p>
        )}
      </div>

      <div className="p-6 mb-8 bg-gray-900 border border-gray-800 rounded-lg">
        <h2 className="mb-4 text-xl font-semibold text-white">
          Setup Status (persists after refresh)
        </h2>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <p
              className={
                hasPositiveBuyerBalance ? "text-green-400" : "text-yellow-400"
              }
            >
              {hasPositiveBuyerBalance ? "✅" : "⏳"} V2 Buyer Balance:{" "}
              {(latestBuyerBalance ?? 0).toFixed(6)} USDC
            </p>
            {needsBalanceFix ? (
              <button
                onClick={handlePayAndIssue}
                disabled={!isConnected || isPending || isConfirming || isProcessingPostPayment}
                className="px-3 py-1 text-xs font-bold text-white bg-purple-600 rounded hover:bg-purple-500 disabled:opacity-50"
              >
                {payFixButtonLabel}
              </button>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p
              className={
                hasActiveSharedCredential ? "text-green-400" : "text-yellow-400"
              }
            >
              {hasActiveSharedCredential ? "✅" : "⏳"} Shared Credential:{" "}
              {hasActiveSharedCredential ? "active" : "not issued"}
              {hasActiveSharedCredential && sharedCredentialExpiresAt
                ? ` (expires ${new Date(
                    sharedCredentialExpiresAt * 1000
                  ).toLocaleString()})`
                : ""}
            </p>
            {needsCredentialFix ? (
              <button
                onClick={handleIssueSharedCredentialOnly}
                disabled={!isConnected || isIssuingCredentialOnly}
                className="px-3 py-1 text-xs font-bold text-white bg-cyan-600 rounded hover:bg-cyan-500 disabled:opacity-50"
              >
                {isIssuingCredentialOnly
                  ? "Issuing..."
                  : "Fix: Issue Credential"}
              </button>
            ) : null}
          </div>
        </div>
        <p
          className={`mt-3 text-sm font-semibold ${
            setupReady ? "text-green-300" : "text-gray-400"
          }`}
        >
          {setupReady
            ? "Ready: agent can invoke APIs now."
            : "Not ready yet: complete remaining ⏳ steps above."}
        </p>
      </div>

      <div
        className={`bg-gray-900 border ${
          isConnected ? "border-purple-800" : "border-gray-800 opacity-50"
        } rounded-lg p-6`}
      >
        <h2 className="mb-4 text-xl font-semibold text-white">
          2. Pay with ERC-2612 Permit
        </h2>
        <div className="space-y-4">
          <div>
            <label
              htmlFor="router-deposit-amount"
              className="block mb-1 text-sm font-medium text-gray-400"
            >
              Deposit Amount (USDC)
            </label>
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
            disabled={!isConnected || isPending || isConfirming || isProcessingPostPayment}
            className="px-6 py-2 font-bold text-white transition-colors bg-purple-600 rounded hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {payButtonLabel}
          </button>

          {hash && txType === "pay" ? (
            <p className="font-mono text-xs text-purple-300 break-all">
              txHash: {hash}
            </p>
          ) : null}
          {isConfirming && txType === "pay" ? (
            <p className="text-sm text-yellow-400">
              Waiting payment tx confirmation...
            </p>
          ) : null}

          {latestDepositStatus ? (
            <p className="text-sm text-cyan-300">
              Deposit Intent Status: {latestDepositStatus}
            </p>
          ) : null}
          {latestBuyerBalance === null ? null : (
            <p className="text-sm text-yellow-300">
              Buyer Balance: {latestBuyerBalance.toFixed(6)} USDC
            </p>
          )}

          {latestCredential ? (
            <div className="p-4 border rounded bg-green-900/10 border-green-700/40">
              <p className="text-xs tracking-wide text-green-300 uppercase">
                Credential issued (shown once)
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Scope: shared across all services and buyer agents under this
                owner
              </p>
              <p className="mt-2 font-mono text-xs text-green-200 break-all">
                {latestCredential.token}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <LimitPoliciesSection
        isConnected={isConnected}
        dailyLimit={dailyLimit}
        isDailyLimitEnabled={isDailyLimitEnabled}
        onDailyLimitChange={setDailyLimit}
        onDailyToggle={setIsDailyLimitEnabled}
        monthlyLimit={monthlyLimit}
        isMonthlyLimitEnabled={isMonthlyLimitEnabled}
        onMonthlyLimitChange={setMonthlyLimit}
        onMonthlyToggle={setIsMonthlyLimitEnabled}
        isSavingLimit={isSavingLimit}
        limitUpdatedAt={limitUpdatedAt}
        onSave={handleSavePolicies}
      />
    </div>
  );
}
