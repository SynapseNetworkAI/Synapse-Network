"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  BaseError,
  ContractFunctionRevertedError,
  parseAbi,
  parseSignature,
  parseUnits,
  type Hex,
} from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  usePublicClient,
  useReadContract,
  useSignTypedData,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import contractConfig from "@/contract-config.json";
import { useAuth } from "@/components/WalletAuthGuard";
import { createDepositIntent, recordDepositAttempt, type DepositAttemptStage } from "@/utils/balanceApi";

const VAULT_ADDRESS = contractConfig.SynapseCore as `0x${string}`;

const vaultABI = parseAbi([
  "function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",
]);

const DEPOSIT_INTENT_RETRY_QUEUE_KEY = "synapse_deposit_intent_retry_queue";
const PENDING_DEPOSIT_TX_QUEUE_KEY = "synapse_pending_deposit_tx_queue";

type PendingDepositIntentRetry = {
  id: string;
  attemptId?: string;
  address: string;
  txHash: string;
  amountUsdc: number;
  attempts: number;
  nextRetryAt: number;
  lastError?: string;
  createdAt: number;
};

type PendingDepositTx = {
  id: string;
  attemptId?: string;
  address: string;
  txHash: string;
  amountUsdc: number;
  createdAt: number;
};

type UseVaultDepositOptions = {
  initialAmount?: string;
  onDepositSynced?: () => void | Promise<void>;
};

function loadDepositIntentRetryQueue(): PendingDepositIntentRetry[] {
  if (globalThis.window === undefined) return [];
  try {
    const raw = localStorage.getItem(DEPOSIT_INTENT_RETRY_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is PendingDepositIntentRetry => {
      return !!row && typeof row === "object" && typeof row.txHash === "string" && typeof row.address === "string";
    });
  } catch {
    return [];
  }
}

function saveDepositIntentRetryQueue(rows: PendingDepositIntentRetry[]): void {
  if (globalThis.window === undefined) return;
  localStorage.setItem(DEPOSIT_INTENT_RETRY_QUEUE_KEY, JSON.stringify(rows));
}

function loadPendingDepositTxQueue(): PendingDepositTx[] {
  if (globalThis.window === undefined) return [];
  try {
    const raw = localStorage.getItem(PENDING_DEPOSIT_TX_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is PendingDepositTx => {
      return !!row && typeof row === "object" && typeof row.txHash === "string" && typeof row.address === "string";
    });
  } catch {
    return [];
  }
}

function savePendingDepositTxQueue(rows: PendingDepositTx[]): void {
  if (globalThis.window === undefined) return;
  localStorage.setItem(PENDING_DEPOSIT_TX_QUEUE_KEY, JSON.stringify(rows));
}

function createDepositAttemptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `dep_attempt_${crypto.randomUUID().replaceAll("-", "")}`;
  }
  return `dep_attempt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function toSafeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function buildDepositFailureMessage(error: unknown): string {
  const baseError = error instanceof BaseError ? error : undefined;
  const revertError = baseError?.walk((walked) => walked instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | undefined;
  const rawMessage = toSafeErrorMessage(error, "Deposit transaction failed");
  const messageParts = [
    revertError?.reason,
    revertError?.data?.errorName,
    baseError?.shortMessage,
    baseError?.details,
    rawMessage,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  const normalizedMessage = messageParts.join(" | ").toLowerCase();

  if (normalizedMessage.includes("user rejected") || normalizedMessage.includes("rejected")) {
    return "Deposit was cancelled in wallet. No funds were charged.";
  }
  if (
    normalizedMessage.includes("insufficient funds")
    || normalizedMessage.includes("intrinsic gas too low")
    || normalizedMessage.includes("gas required exceeds allowance")
    || normalizedMessage.includes("exceeds the balance of the account")
    || normalizedMessage.includes("out of gas")
  ) {
    return "Deposit failed because the wallet does not have enough native token to pay gas.";
  }
  if (normalizedMessage.includes("insufficient balance") || normalizedMessage.includes("erc20") || normalizedMessage.includes("transfer amount exceeds")) {
    return "Deposit failed because the wallet does not have enough USDC for this transfer.";
  }
  if (revertError?.data?.errorName) {
    return `Deposit was rejected by the vault contract (${revertError.data.errorName}). No funds were credited to the platform.`;
  }
  if (revertError?.reason) {
    return `Deposit was rejected by the vault contract: ${revertError.reason}. No funds were credited to the platform.`;
  }
  if (normalizedMessage.includes("custom error")) {
    return "Deposit was rejected by the vault contract with a custom on-chain error. No funds were credited to the platform.";
  }
  if (normalizedMessage.includes("reverted") || normalizedMessage.includes("execution reverted")) {
    return "Deposit failed on-chain because the vault contract rejected this transaction. No funds were credited to the platform.";
  }
  if (normalizedMessage.includes("nonce too low") || normalizedMessage.includes("replacement transaction underpriced")) {
    return "Deposit failed because the wallet transaction nonce is out of date. Please retry from the wallet.";
  }
  return rawMessage;
}

function shortAddress(address?: string): string {
  if (!address) return "-";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function useVaultDeposit(options?: UseVaultDepositOptions) {
  const { initialAmount = "10", onDepositSynced } = options ?? {};
  const { address, isConnected } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const depositRetryInFlightRef = useRef(false);
  const pendingDepositSyncInFlightRef = useRef(false);
  const currentDepositAttemptIdRef = useRef<string | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState(initialAmount);
  const [depositError, setDepositError] = useState("");
  const [depositStep, setDepositStep] = useState<"input" | "signing_permit" | "executing_tx">("input");

  const { data: usdcNonce } = useReadContract({
    address: contractConfig.MockUSDC as `0x${string}`,
    abi: parseAbi(["function nonces(address) view returns (uint256)"]),
    functionName: "nonces",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: walletUsdcBalanceRaw, refetch: refetchWalletBalance } = useReadContract({
    address: contractConfig.MockUSDC as `0x${string}`,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: ethBalanceData } = useBalance({ address });
  const walletUsdcBalance = isConnected && address && walletUsdcBalanceRaw !== undefined ? Number(walletUsdcBalanceRaw) / 1e18 : 0;
  const ethBalance = ethBalanceData ? Number(ethBalanceData.value) / 1e18 : 0;

  const { signTypedDataAsync } = useSignTypedData();
  const { data: hash, writeContractAsync, isPending } = useWriteContract();
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError: isDepositFailed,
    error: depositReceiptError,
  } = useWaitForTransactionReceipt({ hash });

  const resetUi = useCallback(() => {
    setDepositError("");
    setDepositStep("input");
  }, []);

  const openModal = useCallback(() => {
    resetUi();
    setIsOpen(true);
  }, [resetUi]);

  const closeModal = useCallback(() => {
    if (isPending || isConfirming) {
      return;
    }
    setIsOpen(false);
  }, [isConfirming, isPending]);

  const recordAttemptStage = useCallback(async (
    stage: DepositAttemptStage,
    amountUsdc: number,
    request?: { attemptId?: string; txHash?: string; failureReason?: string },
  ) => {
    if (!address || !isSessionAuthenticated) return;
    const attemptId = request?.attemptId || currentDepositAttemptIdRef.current;
    if (!attemptId) return;

    try {
      await recordDepositAttempt(address, {
        attemptId,
        amountUsdc,
        stage,
        txHash: request?.txHash,
        failureReason: request?.failureReason,
      });
    } catch (error) {
      console.error("Failed to record deposit attempt stage", stage, error);
    }
  }, [address, isSessionAuthenticated]);

  const upsertDepositIntentRetry = useCallback((txHash: string, amountUsdc: number, error: unknown, attemptId?: string) => {
    if (!address || globalThis.window === undefined) return;
    const normalizedHash = String(txHash || "").trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(normalizedHash)) return;

    const queue = loadDepositIntentRetryQueue();
    const now = Date.now();
    const existing = queue.find((row) => row.address.toLowerCase() === address.toLowerCase() && row.txHash.toLowerCase() === normalizedHash);
    const message = toSafeErrorMessage(error, "intent submit failed");

    if (existing) {
      existing.lastError = message;
      existing.nextRetryAt = Math.min(existing.nextRetryAt, now + 3000);
    } else {
      queue.push({
        id: `intent-retry-${normalizedHash.slice(2, 10)}-${now}`,
        attemptId,
        address,
        txHash: normalizedHash,
        amountUsdc,
        attempts: 0,
        nextRetryAt: now + 3000,
        lastError: message,
        createdAt: now,
      });
    }

    saveDepositIntentRetryQueue(queue);
    toast.error("On-chain deposit succeeded but sync to gateway failed. Auto-retry queue enabled.");
  }, [address]);

  const upsertPendingDepositTx = useCallback((txHash: string, amountUsdc: number, attemptId?: string) => {
    if (!address || globalThis.window === undefined) return;
    const normalizedHash = String(txHash || "").trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(normalizedHash)) return;

    const queue = loadPendingDepositTxQueue();
    const existing = queue.find((row) => row.address.toLowerCase() === address.toLowerCase() && row.txHash.toLowerCase() === normalizedHash);
    if (!existing) {
      queue.push({
        id: `pending-deposit-${normalizedHash.slice(2, 10)}-${Date.now()}`,
        attemptId,
        address,
        txHash: normalizedHash,
        amountUsdc,
        createdAt: Date.now(),
      });
      savePendingDepositTxQueue(queue);
    }
  }, [address]);

  const findPendingDepositTx = useCallback((txHash: string): PendingDepositTx | undefined => {
    if (!address || globalThis.window === undefined) return undefined;
    const normalizedHash = String(txHash || "").trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(normalizedHash)) return undefined;
    return loadPendingDepositTxQueue().find((row) => row.address.toLowerCase() === address.toLowerCase() && row.txHash.toLowerCase() === normalizedHash);
  }, [address]);

  const removePendingDepositTx = useCallback((txHash: string) => {
    if (!address || globalThis.window === undefined) return;
    const normalizedHash = String(txHash || "").trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(normalizedHash)) return;

    const next = loadPendingDepositTxQueue().filter((row) => !(row.address.toLowerCase() === address.toLowerCase() && row.txHash.toLowerCase() === normalizedHash));
    savePendingDepositTxQueue(next);
  }, [address]);

  const notifyDepositSynced = useCallback(async () => {
    await refetchWalletBalance();
    await onDepositSynced?.();
  }, [onDepositSynced, refetchWalletBalance]);

  const flushPendingDepositTxQueue = useCallback(async () => {
    if (!address || !isSessionAuthenticated || !publicClient || globalThis.window === undefined) return;
    if (pendingDepositSyncInFlightRef.current) return;

    const queue = loadPendingDepositTxQueue();
    if (!queue.length) return;

    const owner = address.toLowerCase();
    let changed = false;
    pendingDepositSyncInFlightRef.current = true;
    try {
      for (const item of queue) {
        if (item.address.toLowerCase() !== owner) continue;

        try {
          const receipt = await publicClient.getTransactionReceipt({ hash: item.txHash as Hex });
          if (receipt.status === "reverted") {
            await recordAttemptStage("RECEIPT_FAILED", Number(item.amountUsdc), {
              attemptId: item.attemptId,
              txHash: item.txHash,
              failureReason: "Deposit transaction reverted during recovery.",
            });
            removePendingDepositTx(item.txHash);
            changed = true;
            toast.error(`Deposit transaction reverted: ${item.txHash.slice(0, 10)}...`);
            continue;
          }

          await recordAttemptStage("RECEIPT_CONFIRMED", Number(item.amountUsdc), {
            attemptId: item.attemptId,
            txHash: item.txHash,
          });

          await createDepositIntent(address, {
            txHash: item.txHash,
            amountUsdc: Number(item.amountUsdc),
          });

          await recordAttemptStage("INTENT_REGISTERED", Number(item.amountUsdc), {
            attemptId: item.attemptId,
            txHash: item.txHash,
          });

          removePendingDepositTx(item.txHash);
          changed = true;
          toast.success(`Recovered deposit sync: ${item.txHash.slice(0, 10)}...`);
          await notifyDepositSynced();
        } catch (error) {
          const message = toSafeErrorMessage(error, "pending deposit still waiting").toLowerCase();
          if (message.includes("transactionreceiptnotfound") || message.includes("not found")) {
            continue;
          }

          removePendingDepositTx(item.txHash);
          upsertDepositIntentRetry(item.txHash, Number(item.amountUsdc), error, item.attemptId);
          changed = true;
        }
      }
    } finally {
      pendingDepositSyncInFlightRef.current = false;
    }

    if (changed) {
      savePendingDepositTxQueue(loadPendingDepositTxQueue());
    }
  }, [address, isSessionAuthenticated, notifyDepositSynced, publicClient, recordAttemptStage, removePendingDepositTx, upsertDepositIntentRetry]);

  const flushDepositIntentRetryQueue = useCallback(async () => {
    if (!address || globalThis.window === undefined) return;
    if (depositRetryInFlightRef.current) return;

    const queue = loadDepositIntentRetryQueue();
    if (!queue.length) return;

    const now = Date.now();
    const owner = address.toLowerCase();
    let changed = false;

    depositRetryInFlightRef.current = true;
    try {
      for (const item of queue) {
        if (item.address.toLowerCase() !== owner) continue;
        if (item.nextRetryAt > now) continue;

        try {
          await createDepositIntent(address, {
            txHash: item.txHash,
            amountUsdc: Number(item.amountUsdc),
          });

          await recordAttemptStage("INTENT_REGISTERED", Number(item.amountUsdc), {
            attemptId: item.attemptId,
            txHash: item.txHash,
          });

          item.nextRetryAt = -1;
          item.lastError = "";
          changed = true;
          toast.success(`Deposit sync recovered: ${item.txHash.slice(0, 10)}...`);
          await notifyDepositSynced();
        } catch (error) {
          item.attempts += 1;
          const backoffMs = Math.min(60000, Math.max(3000, 3000 * 2 ** Math.min(item.attempts, 5)));
          item.nextRetryAt = Date.now() + backoffMs;
          item.lastError = toSafeErrorMessage(error, "retry failed");
          changed = true;
        }
      }
    } finally {
      depositRetryInFlightRef.current = false;
    }

    if (changed) {
      saveDepositIntentRetryQueue(queue.filter((row) => row.nextRetryAt !== -1));
    }
  }, [address, notifyDepositSynced, recordAttemptStage]);

  useEffect(() => {
    if (!address || !isSessionAuthenticated) return;
    void flushPendingDepositTxQueue();
    void flushDepositIntentRetryQueue();
    const id = setInterval(() => {
      void flushPendingDepositTxQueue();
      void flushDepositIntentRetryQueue();
    }, 5000);
    return () => clearInterval(id);
  }, [address, flushDepositIntentRetryQueue, flushPendingDepositTxQueue, isSessionAuthenticated]);

  useEffect(() => {
    if (!(isConfirmed && hash && address)) {
      return;
    }

    const pendingAttempt = findPendingDepositTx(hash);
    removePendingDepositTx(hash);
    setDepositError("");
    void recordAttemptStage("RECEIPT_CONFIRMED", Number(depositAmount), {
      attemptId: pendingAttempt?.attemptId,
      txHash: hash,
    });

    toast.success("Deposit successful.");
    setIsOpen(false);
    setDepositStep("input");

    createDepositIntent(address, {
      txHash: hash,
      amountUsdc: Number(depositAmount),
    }).then(async () => {
      await recordAttemptStage("INTENT_REGISTERED", Number(depositAmount), {
        attemptId: pendingAttempt?.attemptId,
        txHash: hash,
      });
      await notifyDepositSynced();
    }).catch((error) => {
      console.error("Intent failed", error);
      upsertDepositIntentRetry(hash, Number(depositAmount), error, pendingAttempt?.attemptId);
    });

    currentDepositAttemptIdRef.current = null;
  }, [address, depositAmount, findPendingDepositTx, hash, isConfirmed, notifyDepositSynced, recordAttemptStage, removePendingDepositTx, upsertDepositIntentRetry]);

  useEffect(() => {
    if (!(isDepositFailed && hash)) {
      return;
    }

    removePendingDepositTx(hash);
    setDepositStep("input");

    const failureMessage = buildDepositFailureMessage(depositReceiptError);
    setDepositError(failureMessage);
    const pendingAttempt = findPendingDepositTx(hash);
    void recordAttemptStage("RECEIPT_FAILED", Number(depositAmount), {
      attemptId: pendingAttempt?.attemptId,
      txHash: hash,
      failureReason: failureMessage,
    });
    toast.error(failureMessage, { duration: 5000 });
    currentDepositAttemptIdRef.current = null;
  }, [depositAmount, depositReceiptError, findPendingDepositTx, hash, isDepositFailed, recordAttemptStage, removePendingDepositTx]);

  const handleDeposit = useCallback(async () => {
    if (!address) {
      toast.error("Please connect your wallet first.");
      return;
    }

    const amountUsdc = Number(depositAmount);
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      toast.error("Invalid amount");
      return;
    }

    const attemptId = createDepositAttemptId();
    currentDepositAttemptIdRef.current = attemptId;
    setDepositError("");
    await recordAttemptStage("SIGN_REQUESTED", amountUsdc, { attemptId });

    if (walletUsdcBalance < amountUsdc) {
      const failureMessage = `Insufficient wallet USDC. Need ${amountUsdc.toFixed(2)} USDC, wallet has ${walletUsdcBalance.toFixed(2)} USDC.`;
      setDepositError(failureMessage);
      toast.error(failureMessage);
      return;
    }

    if (ethBalance < 0.001) {
      const failureMessage = "Insufficient ETH for transaction gas (needs ~0.001 ETH). Please fund your wallet.";
      setDepositError(failureMessage);
      toast.error(failureMessage);
    }

    setDepositStep("signing_permit");
    try {
      const amountBigInt = parseUnits(String(amountUsdc), 18);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const nonce = usdcNonce ?? BigInt(0);

      const signature = await signTypedDataAsync({
        domain: {
          name: "Mock USDC",
          version: "1",
          chainId,
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
        message: { owner: address, spender: VAULT_ADDRESS, value: amountBigInt, nonce, deadline },
      });

      const { v, r, s } = parseSignature(signature);
      setDepositStep("executing_tx");
      const submittedHash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultABI,
        functionName: "depositWithPermit",
        args: [amountBigInt, deadline, Number(v), r, s],
      });
      upsertPendingDepositTx(submittedHash, amountUsdc, attemptId);
      await recordAttemptStage("TX_BROADCASTED", amountUsdc, {
        attemptId,
        txHash: submittedHash,
      });
    } catch (error: unknown) {
      setDepositStep("input");
      const message = error instanceof Error ? error.message : String(error);

      let failureReason = "Unknown Error";
      if (message.includes("User rejected") || message.toLowerCase().includes("rejected")) {
        failureReason = "User rejected";
        setDepositError("Deposit was cancelled in wallet. No funds were charged.");
        toast("Sign/Transaction cancelled by user", { icon: "ℹ️" });
      } else if (message.includes("Insufficient Balance") || message.includes("insufficient funds") || message.includes("gas required exceeds allowance")) {
        failureReason = "Insufficient Gas/Funds";
        setDepositError("USDC or ETH 余额不足，请检查钱包");
        toast.error("USDC or ETH 余额不足，请检查钱包", { duration: 5000 });
      } else {
        failureReason = message.substring(0, 100);
        const failureMessage = buildDepositFailureMessage(error);
        setDepositError(failureMessage);
        toast.error(`Failed to top up: ${failureMessage}`);
      }

      await recordAttemptStage("SIGN_REQUESTED", amountUsdc, {
        attemptId,
        failureReason,
      });
      currentDepositAttemptIdRef.current = null;
    }
  }, [address, chainId, depositAmount, ethBalance, recordAttemptStage, signTypedDataAsync, usdcNonce, walletUsdcBalance, writeContractAsync, upsertPendingDepositTx]);

  return {
    isOpen,
    openModal,
    closeModal,
    depositAmount,
    setDepositAmount,
    depositError,
    depositStep,
    handleDeposit,
    isPending,
    isConfirming,
    walletUsdcBalance,
    vaultAddress: VAULT_ADDRESS,
    walletAddress: address,
    shortAddress,
  };
}