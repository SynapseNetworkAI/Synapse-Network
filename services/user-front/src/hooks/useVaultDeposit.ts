"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  BaseError,
  ContractFunctionRevertedError,
  parseAbi,
  parseSignature,
  parseUnits,
} from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  useReadContract,
  useSignTypedData,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import contractConfig from "@/contract-config.json";
import { useAuth } from "@/components/WalletAuthGuard";
import {
  createDepositIntent,
  getDepositSyncStatus,
  recordDepositAttempt,
  type DepositAttemptStage,
} from "@/utils/balanceApi";
import { showWalletStatusToast } from "@/utils/walletToast";
import { analytics } from "@/lib/analytics";

const VAULT_ADDRESS = contractConfig.SynapseCore as `0x${string}`;

const vaultABI = parseAbi([
  "function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",
]);

type UseVaultDepositOptions = {
  initialAmount?: string;
  onDepositSynced?: () => void | Promise<void>;
};

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

function getWalletConnectionFailureMessage(error: unknown): string | null {
  const normalizedMessage = toSafeErrorMessage(error, "")
    .trim()
    .toLowerCase();

  if (!normalizedMessage) {
    return null;
  }

  if (
    normalizedMessage.includes("requested method and/or account has not been authorized")
    || normalizedMessage.includes("requested account and/or method has not been authorized")
    || normalizedMessage.includes("not been authorized by the user")
    || normalizedMessage.includes("connector not connected")
    || normalizedMessage.includes("wallet provider unavailable")
    || normalizedMessage.includes("unavailable while reconnecting")
  ) {
    return "Wallet not fully connected yet. Please reconnect and retry.";
  }

  if (normalizedMessage.includes("multiple wallet accounts selected")) {
    return "Please select only one wallet account, then reconnect.";
  }

  if (
    normalizedMessage.includes("cannot read properties of undefined")
    || normalizedMessage.includes("reading 'length'")
    || normalizedMessage.includes("reading 'raw'")
  ) {
    return "Wallet connection unstable. Please reconnect wallet and retry.";
  }

  return null;
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
  const currentDepositAttemptIdRef = useRef<string | null>(null);
  const activeSyncHashRef = useRef<string | null>(null);
  const syncedIntentHashesRef = useRef<Set<string>>(new Set());
  const handledConfirmedHashesRef = useRef<Set<string>>(new Set());

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

  const notifyDepositSynced = useCallback(async () => {
    await refetchWalletBalance();
    await onDepositSynced?.();
  }, [onDepositSynced, refetchWalletBalance]);

  useEffect(() => {
    activeSyncHashRef.current = null;
    syncedIntentHashesRef.current.clear();
    handledConfirmedHashesRef.current.clear();
  }, [address]);

  const wait = useCallback(async (ms: number) => {
    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, ms);
    });
  }, []);

  const waitForDepositSync = useCallback(async (
    txHash: string,
    amountUsdc: number,
    attemptId?: string,
  ) => {
    if (!address || !isSessionAuthenticated) return;
    const normalizedHash = String(txHash || "").trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(normalizedHash)) return;

    activeSyncHashRef.current = normalizedHash;

    for (let attempt = 0; attempt < 45; attempt += 1) {
      try {
        const sync = await getDepositSyncStatus(address, normalizedHash);

        if (sync.synced && !syncedIntentHashesRef.current.has(normalizedHash)) {
          syncedIntentHashesRef.current.add(normalizedHash);
          await recordAttemptStage("INTENT_REGISTERED", amountUsdc, {
            attemptId,
            txHash: normalizedHash,
          });
        }

        if (sync.canRefreshBalance) {
          await notifyDepositSynced();
          toast.success("Gateway balance synced.");
          activeSyncHashRef.current = null;
          return;
        }
      } catch (error) {
        console.error("Failed to poll deposit sync status", error);
      }

      await wait(2000);
    }

    activeSyncHashRef.current = null;
    toast("Deposit confirmed on-chain. Gateway is still syncing the balance.", {
      icon: "ℹ️",
      duration: 5000,
    });
  }, [address, isSessionAuthenticated, notifyDepositSynced, recordAttemptStage, wait]);

  useEffect(() => {
    if (!(isConfirmed && hash && address)) {
      return;
    }

    const normalizedHash = String(hash).trim().toLowerCase();
    if (handledConfirmedHashesRef.current.has(normalizedHash)) {
      return;
    }
    handledConfirmedHashesRef.current.add(normalizedHash);

    if (activeSyncHashRef.current === normalizedHash) {
      return;
    }

    const amountUsdc = Number(depositAmount);
    const attemptId = currentDepositAttemptIdRef.current ?? undefined;
    setDepositError("");
    void recordAttemptStage("RECEIPT_CONFIRMED", amountUsdc, {
      attemptId,
      txHash: normalizedHash,
    });

    toast.success("Deposit confirmed on-chain. Syncing gateway balance...");
    setIsOpen(false);
    setDepositStep("input");
    currentDepositAttemptIdRef.current = null;

    void (async () => {
      try {
        await createDepositIntent(address, {
          txHash: normalizedHash,
          amountUsdc,
        });
      } catch (error) {
        console.error("Deposit intent registration failed; falling back to backend sync polling", error);
      }

      await waitForDepositSync(normalizedHash, amountUsdc, attemptId);
    })();
  }, [address, depositAmount, hash, isConfirmed, recordAttemptStage, waitForDepositSync]);

  useEffect(() => {
    if (!(isDepositFailed && hash)) {
      return;
    }

    activeSyncHashRef.current = null;
    setDepositStep("input");

    const failureMessage = buildDepositFailureMessage(depositReceiptError);
    setDepositError(failureMessage);
    void recordAttemptStage("RECEIPT_FAILED", Number(depositAmount), {
      attemptId: currentDepositAttemptIdRef.current ?? undefined,
      txHash: hash,
      failureReason: failureMessage,
    });
    toast.error(failureMessage, { duration: 5000 });
    currentDepositAttemptIdRef.current = null;
  }, [depositAmount, depositReceiptError, hash, isDepositFailed, recordAttemptStage]);

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
    analytics.capture("deposit_started", {
      amount_usdc: amountUsdc,
      token_symbol: "USDC",
      chain_id: chainId,
    });
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
      analytics.capture("deposit_permit_signed", {
        amount_usdc: amountUsdc,
        token_symbol: "USDC",
      });
      setDepositStep("executing_tx");
      const submittedHash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultABI,
        functionName: "depositWithPermit",
        args: [amountBigInt, deadline, Number(v), r, s],
      });
      await recordAttemptStage("TX_BROADCASTED", amountUsdc, {
        attemptId,
        txHash: submittedHash,
      });
    } catch (error: unknown) {
      setDepositStep("input");
      const message = error instanceof Error ? error.message : String(error);
      const walletConnectionMessage = getWalletConnectionFailureMessage(error);

      let failureReason = "Unknown Error";
      if (message.includes("User rejected") || message.toLowerCase().includes("rejected")) {
        failureReason = "User rejected";
        setDepositError("Deposit was cancelled in wallet. No funds were charged.");
        toast("Sign/Transaction cancelled by user", { icon: "ℹ️" });
      } else if (walletConnectionMessage) {
        failureReason = walletConnectionMessage;
        setDepositError(walletConnectionMessage);
        showWalletStatusToast(walletConnectionMessage, { icon: "🔌" });
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
  }, [address, chainId, depositAmount, ethBalance, recordAttemptStage, signTypedDataAsync, usdcNonce, walletUsdcBalance, writeContractAsync]);

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
