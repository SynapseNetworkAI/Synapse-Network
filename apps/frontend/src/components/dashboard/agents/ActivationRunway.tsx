"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useReadContract, useSignTypedData, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { parseAbi, parseUnits, type Hex } from "viem";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Copy,
  KeyRound,
  Lock,
  RefreshCw,
  Rocket,
  Wallet,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import contractConfig from "@/contract-config.json";
import { createDepositIntent } from "@/utils/balanceApi";

const VAULT_ADDRESS = contractConfig.SynapseCore as `0x${string}`;

const vaultABI = parseAbi([
  "function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",
]);

type RunwayStep = "deposit" | "agent" | "credential" | "invoke";
type RunwayState = "LOCKED" | "READY" | "DONE" | "BLOCKED";

type ActivationRunwayProps = {
  isConnected: boolean;
  hasSession: boolean;
  ownerBalance: string;
  hasActiveAgent: boolean;
  latestCredentialPrefix?: string;
  latestIssuedToken?: string;
  hasSuccessfulInvocation: boolean;
  onAgentCreated: () => void;
  onRunExample: () => void;
  onDepositComplete?: () => void;
  onCopyLatestCredential?: () => void;
};

type RunwayCard = {
  step: RunwayStep;
  title: string;
  description: string;
  state: RunwayState;
  summary: string;
  hint: string;
  actionLabel: string;
  disabled?: boolean;
  icon: typeof Wallet;
};

type RunwayAvailability = {
  isConnected: boolean;
  hasSession: boolean;
  hasBalance: boolean;
  hasActiveAgent: boolean;
  hasCredential: boolean;
  hasSuccessfulInvocation: boolean;
  ownerBalance: string;
  walletUsdcBalance: number;
  latestCredentialPrefix?: string;
  latestIssuedToken?: string;
};

function getStateTone(state: RunwayState): string {
  if (state === "DONE") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  }
  if (state === "READY") {
    return "border-blue-500/25 bg-blue-500/10 text-blue-300";
  }
  if (state === "BLOCKED") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  }
  return "border-white/10 bg-white/[0.02] text-gray-400";
}

function getDepositState(availability: RunwayAvailability): RunwayState {
  if (!(availability.isConnected && availability.hasSession)) {
    return "BLOCKED";
  }
  return availability.hasBalance ? "DONE" : "READY";
}

function getDepositHint(availability: RunwayAvailability): string {
  if (!availability.isConnected) {
    return "Connect wallet first.";
  }
  if (!availability.hasSession) {
    return "Sign in to authorize deposits.";
  }
  return `Wallet balance: ${availability.walletUsdcBalance.toFixed(2)} USDC`;
}

function getAgentState(availability: RunwayAvailability): RunwayState {
  if (!(availability.isConnected && availability.hasSession)) {
    return "LOCKED";
  }
  if (!availability.hasBalance) {
    return "BLOCKED";
  }
  return availability.hasActiveAgent ? "DONE" : "READY";
}

function getCredentialState(availability: RunwayAvailability): RunwayState {
  if (!(availability.isConnected && availability.hasSession)) {
    return "LOCKED";
  }
  if (!availability.hasActiveAgent) {
    return "LOCKED";
  }
  return availability.hasCredential ? "DONE" : "READY";
}

function getCredentialActionLabel(availability: RunwayAvailability): string {
  if (availability.latestIssuedToken) {
    return "Copy Latest Token";
  }
  if (availability.hasCredential) {
    return "Credential Active";
  }
  return "Issue Credential";
}

function getInvokeState(availability: RunwayAvailability): RunwayState {
  if (!(availability.isConnected && availability.hasSession)) {
    return "LOCKED";
  }
  if (!availability.hasActiveAgent) {
    return "LOCKED";
  }
  if (!availability.hasBalance) {
    return "BLOCKED";
  }
  return availability.hasSuccessfulInvocation ? "DONE" : "READY";
}

function buildRunwayCards(availability: RunwayAvailability): RunwayCard[] {
  return [
    {
      step: "deposit",
      title: "Fund Owner Vault",
      description: "Move wallet USDC into Synapse credit so the runtime can settle paid calls.",
      state: getDepositState(availability),
      summary: `${availability.ownerBalance} USDC spendable`,
      hint: getDepositHint(availability),
      actionLabel: availability.hasBalance ? "Add More Funds" : "Deposit USDC",
      icon: Wallet,
    },
    {
      step: "agent",
      title: "Create Agent Runtime",
      description: "Issue a runtime identity with budget and call guards bound to the current owner.",
      state: getAgentState(availability),
      summary: availability.hasActiveAgent ? "At least one active agent exists" : "No active agent yet",
      hint: availability.hasBalance ? "Creation opens the credential issuance modal." : "Funding is required before issuing runtime credentials.",
      actionLabel: availability.hasActiveAgent ? "Create Another Agent" : "Create Agent",
      disabled: !(availability.isConnected && availability.hasSession && availability.hasBalance),
      icon: Bot,
    },
    {
      step: "credential",
      title: "Capture Credential",
      description: "Store the one-time secret somewhere your runtime can access it when calling Synapse.",
      state: getCredentialState(availability),
      summary: availability.latestCredentialPrefix ? `Token prefix: ${availability.latestCredentialPrefix}` : "No credential visible yet",
      hint: availability.latestIssuedToken ? "Copy the full credential now. It will not be shown again." : "Existing cards only show the token prefix for safety.",
      actionLabel: getCredentialActionLabel(availability),
      disabled: !availability.latestIssuedToken && availability.hasCredential,
      icon: KeyRound,
    },
    {
      step: "invoke",
      title: "Run First Paid Invocation",
      description: "Use the credential to discover a service, settle payment, and verify a real gateway response.",
      state: getInvokeState(availability),
      summary: availability.hasSuccessfulInvocation ? "At least one paid invocation succeeded" : "No successful invocation recorded",
      hint: availability.hasSuccessfulInvocation ? "Use the panel below to repeat against another service." : "Paste the saved credential into the sandbox and run the example.",
      actionLabel: availability.hasSuccessfulInvocation ? "Run Again" : "Run Example",
      disabled: !(availability.isConnected && availability.hasSession && availability.hasActiveAgent && availability.hasBalance),
      icon: Rocket,
    },
  ];
}

export default function ActivationRunway({
  isConnected,
  hasSession,
  ownerBalance,
  hasActiveAgent,
  latestCredentialPrefix,
  latestIssuedToken,
  hasSuccessfulInvocation,
  onAgentCreated,
  onRunExample,
  onDepositComplete,
  onCopyLatestCredential,
}: Readonly<ActivationRunwayProps>) {
  const { address: userAddress } = useAccount();
  const hasBalance = Number(ownerBalance) > 0;
  const hasCredential = Boolean(latestCredentialPrefix);
  const [activeStep, setActiveStep] = useState<RunwayStep>("deposit");
  const [copiedCredential, setCopiedCredential] = useState(false);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("10");
  const [depositError, setDepositError] = useState("");
  const [depositStep, setDepositStep] = useState<"input" | "signing" | "executing">("input");

  const { data: usdcNonce } = useReadContract({
    address: contractConfig.MockUSDC as `0x${string}`,
    abi: parseAbi(["function nonces(address) view returns (uint256)"]),
    functionName: "nonces",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress },
  });

  const { data: walletUsdcBalanceRaw, refetch: refetchWalletBalance } = useReadContract({
    address: contractConfig.MockUSDC as `0x${string}`,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress },
  });

  const walletUsdcBalance = userAddress && walletUsdcBalanceRaw !== undefined
    ? Number(walletUsdcBalanceRaw) / 1e18
    : 0;

  const { signTypedDataAsync } = useSignTypedData();
  const { data: hash, writeContractAsync, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (!isConnected || !hasSession) {
      setActiveStep("deposit");
      return;
    }
    if (Number(ownerBalance) <= 0) {
      setActiveStep("deposit");
      return;
    }
    if (!hasActiveAgent) {
      setActiveStep("agent");
      return;
    }
    if (!latestCredentialPrefix) {
      setActiveStep("credential");
      return;
    }
    setActiveStep("invoke");
  }, [hasActiveAgent, hasSession, isConnected, latestCredentialPrefix, ownerBalance]);

  const handleDeposit = useCallback(async () => {
    if (!userAddress || !signTypedDataAsync) {
      return;
    }

    try {
      setDepositError("");
      setDepositStep("signing");

      const amountUsdc = Number(depositAmount);
      if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
        setDepositError("Please enter a valid deposit amount");
        setDepositStep("input");
        return;
      }

      if (amountUsdc > walletUsdcBalance) {
        setDepositError("Insufficient USDC balance in wallet");
        setDepositStep("input");
        return;
      }

      const amount = parseUnits(depositAmount, 18);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const nonce = usdcNonce ?? BigInt(0);

      const signature = await signTypedDataAsync({
        account: userAddress,
        domain: {
          name: "MockUSDC",
          version: "1",
          chainId: 1,
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
          owner: userAddress,
          spender: VAULT_ADDRESS,
          value: amount.toString(),
          nonce: nonce.toString(),
          deadline,
        },
      });

      setDepositStep("executing");

      const v = Number.parseInt(signature.slice(130, 132), 16);
      const r: Hex = `0x${signature.slice(2, 66)}`;
      const s: Hex = `0x${signature.slice(66, 130)}`;

      await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultABI,
        functionName: "depositWithPermit",
        args: [amount, BigInt(deadline), v, r, s],
      });

      toast.success("Deposit initiated. Waiting for confirmation...");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deposit failed";
      setDepositError(message);
      setDepositStep("input");
      toast.error(message);
    }
  }, [depositAmount, signTypedDataAsync, usdcNonce, userAddress, walletUsdcBalance, writeContractAsync]);

  useEffect(() => {
    if (!isConfirmed || !hash) {
      return;
    }

    setDepositStep("input");
    setIsDepositModalOpen(false);
    setActiveStep("agent");
    onDepositComplete?.();
    toast.success("Deposit confirmed. You can create the first runtime now.");
    refetchWalletBalance();

    if (userAddress) {
      createDepositIntent(userAddress, {
        txHash: hash,
        amountUsdc: Number(depositAmount),
      }).catch(console.error);
    }
  }, [depositAmount, hash, isConfirmed, onDepositComplete, refetchWalletBalance, userAddress]);

  const handleCopyCredential = useCallback(() => {
    if (!latestIssuedToken) {
      return;
    }
    navigator.clipboard.writeText(latestIssuedToken);
    setCopiedCredential(true);
    onCopyLatestCredential?.();
    toast.success("Credential copied to clipboard.");
    setTimeout(() => setCopiedCredential(false), 2000);
  }, [latestIssuedToken, onCopyLatestCredential]);

  const cards = buildRunwayCards({
    isConnected,
    hasSession,
    hasBalance,
    hasActiveAgent,
    hasCredential,
    hasSuccessfulInvocation,
    ownerBalance,
    walletUsdcBalance,
    latestCredentialPrefix,
    latestIssuedToken,
  });

  const handleCardAction = useCallback((card: RunwayCard) => {
    if (card.step === "deposit") {
      setIsDepositModalOpen(true);
      return;
    }
    if (card.step === "agent") {
      onAgentCreated();
      return;
    }
    if (card.step === "credential") {
      if (latestIssuedToken) {
        handleCopyCredential();
      } else {
        onAgentCreated();
      }
      return;
    }
    onRunExample();
  }, [handleCopyCredential, latestIssuedToken, onAgentCreated, onRunExample]);

  return (
    <section id="activation-runway" className="space-y-6" aria-label="Activation runway">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300/80">Activation Runway</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">From funded owner to first paid agent call</h2>
          <p className="mt-2 max-w-3xl text-sm text-gray-400">
            The runtime is only truly ready after a credential-backed invocation succeeds. These four stages make the blocker explicit and keep the next action local.
          </p>
        </div>
        {hasSuccessfulInvocation && (
          <p className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            First paid invocation completed
          </p>
        )}
      </header>

      <div className="grid gap-4 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          const isActive = activeStep === card.step;
          return (
            <article
              key={card.step}
              className={`rounded-[24px] border p-5 transition ${getStateTone(card.state)} ${isActive ? "ring-1 ring-blue-400/40" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <span className="rounded-2xl border border-current/15 bg-black/10 p-3" aria-hidden="true">
                  <Icon className="h-5 w-5" />
                </span>
                <button
                  type="button"
                  onClick={() => setActiveStep(card.step)}
                  className="text-[10px] font-bold uppercase tracking-[0.24em] text-current/80"
                >
                  {card.state}
                </button>
              </div>

              <div className="mt-5 space-y-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">{card.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-300">{card.description}</p>
                </div>

                <dl className="rounded-2xl border border-white/8 bg-black/10 p-4">
                  <dt className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Current Summary</dt>
                  <dd className="mt-2 text-sm font-medium text-white">{card.summary}</dd>
                  <dd className="mt-3 text-xs leading-5 text-gray-400">{card.hint}</dd>
                </dl>

                <button
                  type="button"
                  onClick={() => handleCardAction(card)}
                  disabled={card.disabled}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white px-4 py-3 text-xs font-bold uppercase tracking-[0.22em] text-slate-950 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-gray-500"
                >
                  {card.step === "credential" && latestIssuedToken && copiedCredential ? <Copy className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {card.step === "credential" && latestIssuedToken && copiedCredential ? "Copied" : card.actionLabel}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {isDepositModalOpen && (
        <dialog open className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" aria-labelledby="deposit-modal-title">
          <section className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0c] shadow-2xl">
            <header className="flex items-center justify-between border-b border-white/5 p-6">
              <h3 id="deposit-modal-title" className="text-lg font-bold text-white">Deposit USDC</h3>
              <button type="button" onClick={() => setIsDepositModalOpen(false)} className="text-gray-500 transition hover:text-white">
                <Lock className="h-5 w-5" />
              </button>
            </header>

            <section className="space-y-6 p-6">
              <label htmlFor="runway-deposit-amount" className="block space-y-2">
                <span className="text-xs font-bold uppercase tracking-[0.22em] text-gray-500">Amount (USDC)</span>
                <input
                  id="runway-deposit-amount"
                  type="number"
                  step="0.01"
                  value={depositAmount}
                  onChange={(event) => setDepositAmount(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-blue-500/50"
                  placeholder="10.00"
                  disabled={depositStep !== "input"}
                />
                <span className="text-xs text-gray-500">Wallet balance: {walletUsdcBalance.toFixed(2)} USDC</span>
              </label>

              {depositError && (
                <aside className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300" role="alert">
                  <AlertCircle className="h-5 w-5" />
                  {depositError}
                </aside>
              )}

              {depositStep !== "input" && (
                <section className="space-y-3" aria-label="Deposit progress">
                  <article className={`flex items-center gap-3 rounded-2xl border p-3 ${depositStep === "signing" ? "border-blue-500/40 bg-blue-500/10 text-blue-300" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"}`}>
                    {depositStep === "signing" ? <RefreshCw className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                    <div className="text-sm">
                      <p className="font-semibold">Step 1: Sign Permit</p>
                      <p className="text-xs opacity-80">{depositStep === "signing" ? "Waiting for wallet signature..." : "Signed"}</p>
                    </div>
                  </article>

                  <article className={`flex items-center gap-3 rounded-2xl border p-3 ${depositStep === "executing" ? "border-blue-500/40 bg-blue-500/10 text-blue-300" : "border-white/10 bg-white/5 text-gray-500"}`}>
                    {depositStep === "executing" ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
                    <div className="text-sm">
                      <p className="font-semibold">Step 2: Execute Deposit</p>
                      <p className="text-xs opacity-80">{depositStep === "executing" ? "Confirming on-chain..." : "Waiting for permit signature"}</p>
                    </div>
                  </article>
                </section>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsDepositModalOpen(false)}
                  disabled={depositStep !== "input"}
                  className="flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeposit()}
                  disabled={depositStep !== "input" || isPending || isConfirming}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full bg-blue-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {(isPending || isConfirming) && <RefreshCw className="h-4 w-4 animate-spin" />}
                  Deposit Now
                </button>
              </div>
            </section>
          </section>
        </dialog>
      )}
    </section>
  );
}