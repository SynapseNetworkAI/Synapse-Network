"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  BaseError,
  ContractFunctionRevertedError,
  formatUnits,
  parseAbi,
  parseSignature,
  parseUnits,
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
import {
  createDepositIntent,
  getDepositSyncStatus,
  recordDepositAttempt,
  type DepositAttemptStage,
} from "@/utils/balanceApi";
import { normalizeMoneyString } from "@/utils/money";
import { isWalletUserRejectedError } from "@/utils/walletActionErrors";
import { showWalletStatusToast } from "@/utils/walletToast";
import { getSupportedEvmInjectedProvider } from "@/utils/evmProvider";
import {
  normalizeTokenDecimals,
  shortAddress,
} from "@/utils/vaultDepositDisplay";
import { analytics } from "@/lib/analytics";
import { getRuntimeEnvironmentConfig } from "@/utils/runtimeEnv";

const VAULT_ADDRESS = contractConfig.SynapseCore as `0x${string}`;
const USDC_ADDRESS = contractConfig.MockUSDC as `0x${string}`;
const CONSUMER_DEPOSIT_MIN_USDC = 5;
const PERMIT_TIMEOUT_MS = 60_000;

const vaultABI = parseAbi([
  "function deposit(uint256 amount) external",
  "function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",
]);
const usdcABI = parseAbi([
  "function nonces(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
]);
const MIN_NATIVE_GAS_BALANCE = 0.001;

type DepositStep =
  | "input"
  | "checking"
  | "review"
  | "switching_network"
  | "approving"
  | "signing_permit"
  | "permit_timed_out"
  | "executing_tx";

export type DepositFlowMode = "preapproved" | "permit" | "approveFallback";
export type DepositPrimaryAction =
  | "checking"
  | "switchNetwork"
  | "insufficientUsdc"
  | "insufficientGas"
  | "review"
  | "walletAction";

type UseVaultDepositOptions = {
  initialAmount?: string;
  onDepositSynced?: () => void | Promise<void>;
  copy?: Partial<VaultDepositCopy>;
};

type VaultDepositCopy = {
  transactionFailed: string;
  cancelled: string;
  gasInsufficient: string;
  usdcInsufficient: string;
  vaultRejectedWithError: string;
  vaultRejectedWithReason: string;
  vaultRejectedCustomError: string;
  vaultRejected: string;
  nonceOutOfDate: string;
  walletReconnect: string;
  walletSingleAccount: string;
  walletUnstable: string;
  invalidAmount: string;
  minDepositAmountNotMet: string;
  insufficientWalletUsdc: string;
  nativeGasRequired: string;
  gatewayBalanceSynced: string;
  gatewayStillSyncing: string;
  depositConfirmedSyncing: string;
  connectWalletFirst: string;
  cancelledToast: string;
  insufficientFundsRetry: string;
  topUpFailedPrefix: string;
  unknownError: string;
  reviewUnavailable: string;
  walletBalanceChanged: string;
  networkSwitchPending: string;
  networkSwitchFailed: string;
  unsupportedWallet: string;
  permitTimedOut: string;
  permitFallbackAvailable: string;
  approveTransactionFailed: string;
};

const DEFAULT_VAULT_DEPOSIT_COPY: VaultDepositCopy = {
  transactionFailed: "Deposit transaction failed",
  cancelled: "Deposit was cancelled in wallet. No funds were charged.",
  gasInsufficient:
    "Deposit failed because the wallet does not have enough native token to pay gas.",
  usdcInsufficient:
    "Deposit failed because the wallet does not have enough USDC for this transfer.",
  vaultRejectedWithError:
    "Deposit was rejected by the vault contract ({{errorName}}). No funds were credited to the platform.",
  vaultRejectedWithReason:
    "Deposit was rejected by the vault contract: {{reason}}. No funds were credited to the platform.",
  vaultRejectedCustomError:
    "Deposit was rejected by the vault contract with a custom on-chain error. No funds were credited to the platform.",
  vaultRejected:
    "Deposit failed on-chain because the vault contract rejected this transaction. No funds were credited to the platform.",
  nonceOutOfDate:
    "Deposit failed because the wallet transaction nonce is out of date. Please retry from the wallet.",
  walletReconnect:
    "Wallet not fully connected yet. Please reconnect and retry.",
  walletSingleAccount: "Please select only one wallet account, then reconnect.",
  walletUnstable:
    "Wallet connection unstable. Please reconnect wallet and retry.",
  invalidAmount: "Enter a valid USDC amount.",
  minDepositAmountNotMet: "Minimum deposit amount is {{amount}} USDC.",
  insufficientWalletUsdc:
    "Insufficient wallet USDC. Need {{amount}} USDC, wallet has {{balance}} USDC.",
  nativeGasRequired:
    "Deposit requires native gas for the vault transaction. Keep at least {{minimum}} {{symbol}} in this wallet.",
  gatewayBalanceSynced: "Gateway balance synced.",
  gatewayStillSyncing:
    "Deposit confirmed on-chain. Gateway is still syncing the balance.",
  depositConfirmedSyncing:
    "Deposit confirmed on-chain. Syncing gateway balance...",
  connectWalletFirst: "Please connect your wallet first.",
  cancelledToast: "Request cancelled",
  insufficientFundsRetry:
    "Wallet USDC or native gas is insufficient. Please check the balances and retry.",
  topUpFailedPrefix: "Failed to top up: {{message}}",
  unknownError: "Unknown Error",
  reviewUnavailable: "Wallet data is still loading. Please try again.",
  walletBalanceChanged:
    "Wallet balance changed. Please review the amount again.",
  networkSwitchPending:
    "Open your wallet extension to finish the network switch.",
  networkSwitchFailed:
    "Unable to switch network from the app. Please switch in your wallet and retry.",
  unsupportedWallet:
    "Phantom does not support the Synapse EVM settlement network. Please reconnect with MetaMask, Rabby, or Coinbase Wallet.",
  permitTimedOut:
    "Wallet did not respond. If you use a hardware wallet, try Approve transaction instead.",
  permitFallbackAvailable:
    "Permit was not completed. You can use an Approve transaction instead.",
  approveTransactionFailed:
    "Approve transaction failed. Please review your wallet and try again.",
};

function interpolateCopy(
  template: string,
  vars?: Record<string, string | number>
): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token: string) =>
    vars[token] === undefined ? "" : String(vars[token])
  );
}

function createDepositAttemptId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `dep_attempt_${crypto.randomUUID().replaceAll("-", "")}`;
  }
  return `dep_attempt_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function toSafeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function buildDepositFailureMessage(
  error: unknown,
  copy: VaultDepositCopy
): string {
  const baseError = error instanceof BaseError ? error : undefined;
  const revertError = baseError?.walk(
    (walked) => walked instanceof ContractFunctionRevertedError
  ) as ContractFunctionRevertedError | undefined;
  const rawMessage = toSafeErrorMessage(error, copy.transactionFailed);
  const messageParts = [
    revertError?.reason,
    revertError?.data?.errorName,
    baseError?.shortMessage,
    baseError?.details,
    rawMessage,
  ].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0
  );
  const normalizedMessage = messageParts.join(" | ").toLowerCase();

  if (isWalletUserRejectedError(error)) {
    return copy.cancelled;
  }
  if (
    normalizedMessage.includes("insufficient funds") ||
    normalizedMessage.includes("intrinsic gas too low") ||
    normalizedMessage.includes("gas required exceeds allowance") ||
    normalizedMessage.includes("exceeds the balance of the account") ||
    normalizedMessage.includes("out of gas")
  ) {
    return copy.gasInsufficient;
  }
  if (
    normalizedMessage.includes("insufficient balance") ||
    normalizedMessage.includes("erc20") ||
    normalizedMessage.includes("transfer amount exceeds")
  ) {
    return copy.usdcInsufficient;
  }
  if (revertError?.data?.errorName) {
    return interpolateCopy(copy.vaultRejectedWithError, {
      errorName: revertError.data.errorName,
    });
  }
  if (revertError?.reason) {
    return interpolateCopy(copy.vaultRejectedWithReason, {
      reason: revertError.reason,
    });
  }
  if (normalizedMessage.includes("custom error")) {
    return copy.vaultRejectedCustomError;
  }
  if (
    normalizedMessage.includes("reverted") ||
    normalizedMessage.includes("execution reverted")
  ) {
    return copy.vaultRejected;
  }
  if (
    normalizedMessage.includes("nonce too low") ||
    normalizedMessage.includes("replacement transaction underpriced")
  ) {
    return copy.nonceOutOfDate;
  }
  return rawMessage;
}

function getWalletConnectionFailureMessage(
  error: unknown,
  copy: VaultDepositCopy
): string | null {
  const normalizedMessage = toSafeErrorMessage(error, "").trim().toLowerCase();

  if (!normalizedMessage) {
    return null;
  }

  if (
    normalizedMessage.includes(
      "requested method and/or account has not been authorized"
    ) ||
    normalizedMessage.includes(
      "requested account and/or method has not been authorized"
    ) ||
    normalizedMessage.includes("not been authorized by the user") ||
    normalizedMessage.includes("connector not connected") ||
    normalizedMessage.includes("wallet provider unavailable") ||
    normalizedMessage.includes("unavailable while reconnecting")
  ) {
    return copy.walletReconnect;
  }

  if (normalizedMessage.includes("multiple wallet accounts selected")) {
    return copy.walletSingleAccount;
  }

  if (
    normalizedMessage.includes("cannot read properties of undefined") ||
    normalizedMessage.includes("reading 'length'") ||
    normalizedMessage.includes("reading 'raw'")
  ) {
    return copy.walletUnstable;
  }

  return null;
}

function isWalletPendingRequestError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? Number((error as { code?: unknown }).code)
      : undefined;
  const message = toSafeErrorMessage(error, "").toLowerCase();
  return (
    code === 4002 ||
    code === -32002 ||
    message.includes("request already pending") ||
    message.includes("already processing") ||
    message.includes("resource unavailable")
  );
}

function isUnknownChainError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? Number((error as { code?: unknown }).code)
      : undefined;
  return code === 4902;
}

function isPermitFallbackError(error: unknown): boolean {
  const message = toSafeErrorMessage(error, "").toLowerCase();
  return (
    message.includes("signtypeddata") ||
    message.includes("typed data") ||
    message.includes("not supported") ||
    message.includes("ledger") ||
    message.includes("hardware") ||
    message.includes("transport") ||
    message.includes("blind signing")
  );
}

function readRefetchedData<T>(
  result: PromiseSettledResult<{ data?: T } | T | undefined>,
  fallback: T | undefined
): T | undefined {
  if (result.status !== "fulfilled") return fallback;
  const value = result.value;
  if (
    value &&
    typeof value === "object" &&
    "data" in value &&
    (value as { data?: T }).data !== undefined
  ) {
    return (value as { data?: T }).data;
  }
  return (value as T | undefined) ?? fallback;
}

async function withWalletTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new Error("WALLET_ACTION_TIMEOUT"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

function buildDepositPreflightError(
  amountUsdc: string,
  walletUsdcBalance: number,
  nativeGasBalance: number,
  nativeGasSymbol: string,
  copy: VaultDepositCopy = DEFAULT_VAULT_DEPOSIT_COPY
): string {
  const amount = Number(amountUsdc);
  if (!amountUsdc || !Number.isFinite(amount) || amount <= 0) {
    return copy.invalidAmount;
  }
  if (amount < CONSUMER_DEPOSIT_MIN_USDC) {
    return interpolateCopy(copy.minDepositAmountNotMet, {
      amount: CONSUMER_DEPOSIT_MIN_USDC.toFixed(2),
    });
  }
  if (walletUsdcBalance < amount) {
    return interpolateCopy(copy.insufficientWalletUsdc, {
      amount: amountUsdc,
      balance: walletUsdcBalance.toFixed(2),
    });
  }
  if (nativeGasBalance < MIN_NATIVE_GAS_BALANCE) {
    return interpolateCopy(copy.nativeGasRequired, {
      minimum: MIN_NATIVE_GAS_BALANCE.toFixed(3),
      symbol: nativeGasSymbol,
    });
  }
  return "";
}

export function useVaultDeposit(options?: UseVaultDepositOptions) {
  const {
    initialAmount = "10",
    onDepositSynced,
    copy: copyOverrides,
  } = options ?? {};
  const copy = useMemo(
    () => ({ ...DEFAULT_VAULT_DEPOSIT_COPY, ...copyOverrides }),
    [copyOverrides]
  );
  const { address, isConnected } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const runtimeEnv = useMemo(() => getRuntimeEnvironmentConfig(), []);
  const requiredChainId = runtimeEnv.chainId;
  const requiredChainName =
    runtimeEnv.appEnv === "local" ? "GoChain Testnet" : runtimeEnv.chainName;
  const currentDepositAttemptIdRef = useRef<string | null>(null);
  const activeSyncHashRef = useRef<string | null>(null);
  const pendingDepositTxHashesRef = useRef<Set<string>>(new Set());
  const syncedIntentHashesRef = useRef<Set<string>>(new Set());
  const handledConfirmedHashesRef = useRef<Set<string>>(new Set());

  const [isOpen, setIsOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState(initialAmount);
  const [depositError, setDepositError] = useState("");
  const [depositStep, setDepositStep] = useState<DepositStep>("input");
  const [isReviewingDeposit, setIsReviewingDeposit] = useState(false);
  const [useApproveFallback, setUseApproveFallback] = useState(false);

  const { data: usdcNonce } = useReadContract({
    address: USDC_ADDRESS,
    abi: usdcABI,
    functionName: "nonces",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: usdcDecimalsRaw } = useReadContract({
    address: USDC_ADDRESS,
    abi: usdcABI,
    functionName: "decimals",
    query: { enabled: !!address },
  });

  const { data: usdcNameRaw } = useReadContract({
    address: USDC_ADDRESS,
    abi: usdcABI,
    functionName: "name",
    query: { enabled: !!address },
  });

  const { data: usdcSymbolRaw } = useReadContract({
    address: USDC_ADDRESS,
    abi: usdcABI,
    functionName: "symbol",
    query: { enabled: !!address },
  });

  const { data: walletUsdcBalanceRaw, refetch: refetchWalletBalance } =
    useReadContract({
      address: USDC_ADDRESS,
      abi: usdcABI,
      functionName: "balanceOf",
      args: address ? [address] : undefined,
      query: { enabled: !!address },
    });

  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: usdcABI,
    functionName: "allowance",
    args: address ? [address, VAULT_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  const { data: ethBalanceData, refetch: refetchNativeBalance } = useBalance({
    address,
  });
  const usdcDecimals = normalizeTokenDecimals(usdcDecimalsRaw);
  const walletUsdcBalance =
    isConnected && address && walletUsdcBalanceRaw !== undefined
      ? Number(formatUnits(walletUsdcBalanceRaw, usdcDecimals))
      : 0;
  const nativeGasBalance = ethBalanceData
    ? Number(formatUnits(ethBalanceData.value, ethBalanceData.decimals ?? 18))
    : 0;
  const nativeGasSymbol = ethBalanceData?.symbol || "ETH";
  const usdcTokenName =
    typeof usdcNameRaw === "string" && usdcNameRaw.trim()
      ? usdcNameRaw.trim()
      : "USDC";
  const usdcTokenSymbol =
    typeof usdcSymbolRaw === "string" && usdcSymbolRaw.trim()
      ? usdcSymbolRaw.trim()
      : "USDC";
  const amountBigInt = useMemo(() => {
    const amountUsdc = normalizeMoneyString(depositAmount, "");
    if (!amountUsdc) return 0n;
    try {
      return parseUnits(amountUsdc, usdcDecimals);
    } catch {
      return 0n;
    }
  }, [depositAmount, usdcDecimals]);
  const isWrongNetwork = Boolean(
    requiredChainId && chainId !== requiredChainId
  );
  const allowanceAmountRaw =
    typeof allowanceRaw === "bigint" ? allowanceRaw : 0n;
  const isWalletDataLoading = Boolean(
    address &&
      (walletUsdcBalanceRaw === undefined ||
        ethBalanceData === undefined ||
        allowanceRaw === undefined ||
        usdcDecimalsRaw === undefined)
  );
  const hasSufficientAllowance =
    amountBigInt > 0n && allowanceAmountRaw >= amountBigInt;
  const depositFlowMode: DepositFlowMode = hasSufficientAllowance
    ? "preapproved"
    : useApproveFallback
    ? "approveFallback"
    : "permit";
  const depositPreflightError = buildDepositPreflightError(
    normalizeMoneyString(depositAmount, ""),
    walletUsdcBalance,
    nativeGasBalance,
    nativeGasSymbol,
    copy
  );

  const { signTypedDataAsync } = useSignTypedData();
  const { data: hash, writeContractAsync, isPending } = useWriteContract();
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError: isDepositFailed,
    error: depositReceiptError,
  } = useWaitForTransactionReceipt({ hash });
  const primaryAction: DepositPrimaryAction = useMemo(() => {
    if (
      isWalletDataLoading ||
      depositStep === "checking" ||
      depositStep === "switching_network"
    ) {
      return "checking";
    }
    if (isWrongNetwork) return "switchNetwork";
    const amount = Number(normalizeMoneyString(depositAmount, ""));
    if (Number.isFinite(amount) && amount > walletUsdcBalance) {
      return "insufficientUsdc";
    }
    if (nativeGasBalance < MIN_NATIVE_GAS_BALANCE) {
      return "insufficientGas";
    }
    if (!isReviewingDeposit) return "review";
    return "walletAction";
  }, [
    depositAmount,
    depositStep,
    isReviewingDeposit,
    isWalletDataLoading,
    isWrongNetwork,
    nativeGasBalance,
    walletUsdcBalance,
  ]);
  const canSubmitDeposit =
    !isPending &&
    !isConfirming &&
    !isWalletDataLoading &&
    ![
      "checking",
      "switching_network",
      "approving",
      "signing_permit",
      "executing_tx",
    ].includes(depositStep) &&
    (primaryAction === "switchNetwork" ||
      (depositPreflightError === "" &&
        primaryAction !== "insufficientUsdc" &&
        primaryAction !== "insufficientGas"));

  const resetUi = useCallback(() => {
    setDepositError("");
    setDepositStep("input");
    setIsReviewingDeposit(false);
    setUseApproveFallback(false);
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

  const recordAttemptStage = useCallback(
    async (
      stage: DepositAttemptStage,
      amountUsdc: string,
      request?: { attemptId?: string; txHash?: string; failureReason?: string }
    ) => {
      if (!address || !isSessionAuthenticated) return;
      const attemptId =
        request?.attemptId || currentDepositAttemptIdRef.current;
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
    },
    [address, isSessionAuthenticated]
  );

  const notifyDepositSynced = useCallback(async () => {
    await refetchWalletBalance();
    await onDepositSynced?.();
  }, [onDepositSynced, refetchWalletBalance]);

  useEffect(() => {
    activeSyncHashRef.current = null;
    pendingDepositTxHashesRef.current.clear();
    syncedIntentHashesRef.current.clear();
    handledConfirmedHashesRef.current.clear();
  }, [address]);

  const wait = useCallback(async (ms: number) => {
    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, ms);
    });
  }, []);

  const waitForDepositSync = useCallback(
    async (txHash: string, amountUsdc: string, attemptId?: string) => {
      if (!address || !isSessionAuthenticated) return;
      const normalizedHash = String(txHash || "")
        .trim()
        .toLowerCase();
      if (!/^0x[0-9a-f]{64}$/.test(normalizedHash)) return;

      activeSyncHashRef.current = normalizedHash;

      for (let attempt = 0; attempt < 45; attempt += 1) {
        try {
          const sync = await getDepositSyncStatus(address, normalizedHash);

          if (
            sync.synced &&
            !syncedIntentHashesRef.current.has(normalizedHash)
          ) {
            syncedIntentHashesRef.current.add(normalizedHash);
            await recordAttemptStage("INTENT_REGISTERED", amountUsdc, {
              attemptId,
              txHash: normalizedHash,
            });
          }

          if (sync.canRefreshBalance) {
            await notifyDepositSynced();
            toast.success(copy.gatewayBalanceSynced);
            activeSyncHashRef.current = null;
            return;
          }
        } catch (error) {
          console.error("Failed to poll deposit sync status", error);
        }

        await wait(2000);
      }

      activeSyncHashRef.current = null;
      toast(copy.gatewayStillSyncing, {
        icon: "ℹ️",
        duration: 5000,
      });
    },
    [
      address,
      isSessionAuthenticated,
      notifyDepositSynced,
      copy.gatewayBalanceSynced,
      copy.gatewayStillSyncing,
      recordAttemptStage,
      wait,
    ]
  );

  useEffect(() => {
    if (!(isConfirmed && hash && address)) {
      return;
    }

    const normalizedHash = String(hash).trim().toLowerCase();
    if (!pendingDepositTxHashesRef.current.has(normalizedHash)) {
      return;
    }
    if (handledConfirmedHashesRef.current.has(normalizedHash)) {
      return;
    }
    handledConfirmedHashesRef.current.add(normalizedHash);

    if (activeSyncHashRef.current === normalizedHash) {
      return;
    }

    const amountUsdc = normalizeMoneyString(depositAmount, "0");
    const attemptId = currentDepositAttemptIdRef.current ?? undefined;
    setDepositError("");
    void recordAttemptStage("RECEIPT_CONFIRMED", amountUsdc, {
      attemptId,
      txHash: normalizedHash,
    });
    pendingDepositTxHashesRef.current.delete(normalizedHash);

    toast.success(copy.depositConfirmedSyncing);
    setIsOpen(false);
    setDepositStep("input");
    setIsReviewingDeposit(false);
    currentDepositAttemptIdRef.current = null;

    void (async () => {
      try {
        await createDepositIntent(address, {
          txHash: normalizedHash,
          amountUsdc,
        });
      } catch (error) {
        console.error(
          "Deposit intent registration failed; falling back to backend sync polling",
          error
        );
      }

      await waitForDepositSync(normalizedHash, amountUsdc, attemptId);
    })();
  }, [
    address,
    depositAmount,
    hash,
    isConfirmed,
    copy.depositConfirmedSyncing,
    recordAttemptStage,
    waitForDepositSync,
  ]);

  useEffect(() => {
    if (!(isDepositFailed && hash)) {
      return;
    }
    const normalizedHash = String(hash).trim().toLowerCase();
    if (!pendingDepositTxHashesRef.current.has(normalizedHash)) {
      return;
    }

    activeSyncHashRef.current = null;
    setDepositStep("input");
    pendingDepositTxHashesRef.current.delete(normalizedHash);

    const failureMessage = buildDepositFailureMessage(
      depositReceiptError,
      copy
    );
    setDepositError(failureMessage);
    void recordAttemptStage(
      "RECEIPT_FAILED",
      normalizeMoneyString(depositAmount, "0"),
      {
        attemptId: currentDepositAttemptIdRef.current ?? undefined,
        txHash: hash,
        failureReason: failureMessage,
      }
    );
    toast.error(failureMessage, { duration: 5000 });
    currentDepositAttemptIdRef.current = null;
  }, [
    copy,
    depositAmount,
    depositReceiptError,
    hash,
    isDepositFailed,
    recordAttemptStage,
  ]);

  const refreshDepositPreflight = useCallback(async () => {
    const amountUsdc = normalizeMoneyString(depositAmount, "");
    setDepositStep("checking");
    const [walletResult, gasResult, allowanceResult] = await Promise.allSettled(
      [
        refetchWalletBalance(),
        refetchNativeBalance?.() ?? Promise.resolve({ data: ethBalanceData }),
        refetchAllowance?.() ?? Promise.resolve({ data: allowanceRaw }),
      ]
    );
    const nextWalletRaw = readRefetchedData(walletResult, walletUsdcBalanceRaw);
    const nextGasData = readRefetchedData(gasResult, ethBalanceData);
    readRefetchedData(allowanceResult, allowanceRaw);

    const nextWalletBalance =
      nextWalletRaw !== undefined
        ? Number(formatUnits(nextWalletRaw, usdcDecimals))
        : walletUsdcBalance;
    const nextGasBalance = nextGasData
      ? Number(formatUnits(nextGasData.value, nextGasData.decimals ?? 18))
      : nativeGasBalance;
    const preflightError = buildDepositPreflightError(
      amountUsdc,
      nextWalletBalance,
      nextGasBalance,
      nextGasData?.symbol || nativeGasSymbol,
      copy
    );

    if (preflightError) {
      setDepositStep("input");
      setDepositError(
        preflightError === depositPreflightError
          ? preflightError
          : copy.walletBalanceChanged
      );
      toast.error(
        preflightError === depositPreflightError
          ? preflightError
          : copy.walletBalanceChanged
      );
      return false;
    }
    setDepositError("");
    return true;
  }, [
    allowanceRaw,
    copy,
    depositAmount,
    depositPreflightError,
    ethBalanceData,
    nativeGasBalance,
    nativeGasSymbol,
    refetchAllowance,
    refetchNativeBalance,
    refetchWalletBalance,
    usdcDecimals,
    walletUsdcBalance,
    walletUsdcBalanceRaw,
  ]);

  const switchToRequiredNetwork = useCallback(async () => {
    const ethereum = getSupportedEvmInjectedProvider();
    if (!ethereum) {
      setDepositError(copy.unsupportedWallet);
      showWalletStatusToast(copy.unsupportedWallet, { icon: "🔌" });
      return;
    }

    setDepositStep("switching_network");
    setDepositError("");
    const chainIdHex = `0x${requiredChainId.toString(16)}`;
    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
      setDepositStep("input");
    } catch (error) {
      if (isUnknownChainError(error)) {
        try {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: chainIdHex,
                chainName: requiredChainName,
                nativeCurrency: {
                  name: runtimeEnv.appEnv === "local" ? "GO" : "Ether",
                  symbol: runtimeEnv.appEnv === "local" ? "GO" : "ETH",
                  decimals: 18,
                },
                rpcUrls: [runtimeEnv.rpcUrl],
                blockExplorerUrls: [runtimeEnv.txExplorerBaseUrl],
              },
            ],
          });
        } catch (addError) {
          const message = isWalletPendingRequestError(addError)
            ? copy.networkSwitchPending
            : copy.networkSwitchFailed;
          setDepositError(message);
          toast(message, { icon: "ℹ️" });
        }
      } else {
        const message = isWalletPendingRequestError(error)
          ? copy.networkSwitchPending
          : isWalletUserRejectedError(error)
          ? copy.cancelled
          : copy.networkSwitchFailed;
        setDepositError(message);
        toast(message, { icon: "ℹ️" });
      }
      setDepositStep("input");
    }
  }, [
    copy,
    requiredChainId,
    requiredChainName,
    runtimeEnv.appEnv,
    runtimeEnv.rpcUrl,
    runtimeEnv.txExplorerBaseUrl,
  ]);

  const handleReviewDeposit = useCallback(async () => {
    if (!address) {
      toast.error(copy.connectWalletFirst);
      return;
    }
    if (isWrongNetwork) {
      await switchToRequiredNetwork();
      return;
    }
    const isFresh = await refreshDepositPreflight();
    if (!isFresh) return;
    setIsReviewingDeposit(true);
    setDepositStep("review");
  }, [
    address,
    copy.connectWalletFirst,
    isWrongNetwork,
    refreshDepositPreflight,
    switchToRequiredNetwork,
  ]);

  const handleUseApproveFallback = useCallback(() => {
    setUseApproveFallback(true);
    setDepositError("");
    if (depositStep === "permit_timed_out") {
      setDepositStep("review");
    }
  }, [depositStep]);

  const setDepositAmountAndReset = useCallback((nextAmount: string) => {
    setDepositAmount(nextAmount);
    setIsReviewingDeposit(false);
    setDepositStep("input");
    setDepositError("");
    setUseApproveFallback(false);
  }, []);

  const handleDeposit = useCallback(async () => {
    if (!address) {
      toast.error(copy.connectWalletFirst);
      return;
    }

    if (!isReviewingDeposit) {
      await handleReviewDeposit();
      return;
    }

    const amountUsdc = normalizeMoneyString(depositAmount, "");
    const isFresh = await refreshDepositPreflight();
    if (!isFresh) return;

    const attemptId = createDepositAttemptId();
    currentDepositAttemptIdRef.current = attemptId;
    setDepositError("");
    await recordAttemptStage("SIGN_REQUESTED", amountUsdc, { attemptId });

    analytics.capture("deposit_started", {
      amount_usdc: amountUsdc,
      token_symbol: "USDC",
      chain_id: chainId,
      deposit_flow_mode: depositFlowMode,
    });
    try {
      const amountRaw = parseUnits(amountUsdc, usdcDecimals);

      if (hasSufficientAllowance) {
        setDepositStep("executing_tx");
        const submittedHash = await writeContractAsync({
          address: VAULT_ADDRESS,
          abi: vaultABI,
          functionName: "deposit",
          args: [amountRaw],
        });
        pendingDepositTxHashesRef.current.add(
          String(submittedHash).trim().toLowerCase()
        );
        await recordAttemptStage("TX_BROADCASTED", amountUsdc, {
          attemptId,
          txHash: submittedHash,
        });
        return;
      }

      if (useApproveFallback) {
        setDepositStep("approving");
        const approveHash = await writeContractAsync({
          address: USDC_ADDRESS,
          abi: usdcABI,
          functionName: "approve",
          args: [VAULT_ADDRESS, amountRaw],
        });
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        await refetchAllowance();
        analytics.capture("deposit_approve_completed", {
          amount_usdc: amountUsdc,
          token_symbol: "USDC",
        });
      } else {
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const nonce = usdcNonce ?? BigInt(0);
        setDepositStep("signing_permit");
        const signature = await withWalletTimeout(
          signTypedDataAsync({
            domain: {
              name: usdcTokenName,
              version: "1",
              chainId,
              verifyingContract: USDC_ADDRESS,
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
              value: amountRaw,
              nonce,
              deadline,
            },
          }),
          PERMIT_TIMEOUT_MS
        );

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
          args: [amountRaw, deadline, Number(v), r, s],
        });
        pendingDepositTxHashesRef.current.add(
          String(submittedHash).trim().toLowerCase()
        );
        await recordAttemptStage("TX_BROADCASTED", amountUsdc, {
          attemptId,
          txHash: submittedHash,
        });
        return;
      }

      setDepositStep("executing_tx");
      const submittedHash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultABI,
        functionName: "deposit",
        args: [amountRaw],
      });
      pendingDepositTxHashesRef.current.add(
        String(submittedHash).trim().toLowerCase()
      );
      await recordAttemptStage("TX_BROADCASTED", amountUsdc, {
        attemptId,
        txHash: submittedHash,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "WALLET_ACTION_TIMEOUT") {
        setUseApproveFallback(true);
        setDepositStep("permit_timed_out");
        setDepositError(copy.permitTimedOut);
        toast(copy.permitTimedOut, { icon: "ℹ️", duration: 7000 });
        await recordAttemptStage("SIGN_REQUESTED", amountUsdc, {
          attemptId,
          failureReason: "Permit timed out",
        });
        currentDepositAttemptIdRef.current = null;
        return;
      }

      setDepositStep("review");
      const walletConnectionMessage = getWalletConnectionFailureMessage(
        error,
        copy
      );

      let failureReason = copy.unknownError;
      if (isWalletUserRejectedError(error)) {
        failureReason = "User rejected";
        setDepositError(copy.cancelled);
        toast(copy.cancelledToast, { icon: "ℹ️" });
      } else if (!useApproveFallback && isPermitFallbackError(error)) {
        failureReason = "Permit fallback available";
        setUseApproveFallback(true);
        setDepositError(copy.permitFallbackAvailable);
        toast(copy.permitFallbackAvailable, { icon: "ℹ️", duration: 7000 });
      } else if (walletConnectionMessage) {
        failureReason = walletConnectionMessage;
        setDepositError(walletConnectionMessage);
        showWalletStatusToast(walletConnectionMessage, { icon: "🔌" });
      } else if (
        message.includes("Insufficient Balance") ||
        message.includes("insufficient funds") ||
        message.includes("gas required exceeds allowance")
      ) {
        failureReason = "Insufficient Gas/Funds";
        setDepositError(copy.insufficientFundsRetry);
        toast.error(copy.insufficientFundsRetry, { duration: 5000 });
      } else {
        failureReason = message.substring(0, 100);
        const failureMessage = buildDepositFailureMessage(error, copy);
        setDepositError(failureMessage);
        toast.error(
          interpolateCopy(copy.topUpFailedPrefix, { message: failureMessage })
        );
      }

      await recordAttemptStage("SIGN_REQUESTED", amountUsdc, {
        attemptId,
        failureReason,
      });
      currentDepositAttemptIdRef.current = null;
    }
  }, [
    address,
    chainId,
    copy,
    depositAmount,
    depositFlowMode,
    handleReviewDeposit,
    hasSufficientAllowance,
    isReviewingDeposit,
    publicClient,
    refetchAllowance,
    refreshDepositPreflight,
    recordAttemptStage,
    signTypedDataAsync,
    usdcDecimals,
    usdcTokenName,
    usdcNonce,
    useApproveFallback,
    writeContractAsync,
  ]);

  return {
    isOpen,
    openModal,
    closeModal,
    depositAmount,
    setDepositAmount: setDepositAmountAndReset,
    depositError,
    depositStep,
    depositFlowMode,
    primaryAction,
    isReviewingDeposit,
    hasSufficientAllowance,
    handleDeposit,
    handleReviewDeposit,
    handleUseApproveFallback,
    switchToRequiredNetwork,
    isPending,
    isConfirming,
    walletUsdcBalance,
    nativeGasBalance,
    nativeGasSymbol,
    depositPreflightError,
    canSubmitDeposit,
    usdcDecimals,
    tokenName: usdcTokenName,
    tokenSymbol: usdcTokenSymbol,
    networkLabel: isWrongNetwork
      ? `${requiredChainName} required`
      : requiredChainName || `Chain ${chainId}`,
    requiredChainName,
    vaultAddress: VAULT_ADDRESS,
    walletAddress: address,
    shortAddress,
  };
}
