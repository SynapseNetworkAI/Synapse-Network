"use client";

import React, { useState, useCallback } from "react";
import { useAccount, useChainId, useReadContract, useSignTypedData, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { parseAbi, parseUnits, type Hex } from "viem";
import { ChevronRight, Zap, Lock, Rocket, CheckCircle2, RefreshCw, AlertCircle, X } from "lucide-react";
import contractConfig from "@/contract-config.json";
import { createDepositIntent } from "@/utils/balanceApi";
import { normalizeMoneyString } from "@/utils/money";
import { resolvePermitDomainChainId } from "@/utils/permitChain";
import toast from "react-hot-toast";

const VAULT_ADDRESS = contractConfig.SynapseCore as `0x${string}`;

const vaultABI = parseAbi([
  "function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external"
]);

interface QuickStartGuideProps {
  onDepositComplete?: () => void;
  onAgentCreated?: () => void;
}

type QuickStartStep = "deposit" | "agent" | "service" | "complete";

const STEPS: Array<{ step: QuickStartStep; label: string; icon: typeof Zap }> = [
  { step: "deposit", label: "Deposit", icon: Zap },
  { step: "agent", label: "Create Agent", icon: Lock },
  { step: "service", label: "Discover Services", icon: Rocket },
  { step: "complete", label: "Start Using", icon: CheckCircle2 }
];

export default function QuickStartGuide({ onDepositComplete, onAgentCreated }: Readonly<QuickStartGuideProps>) {
  const { address: userAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const [currentStep, setCurrentStep] = useState<QuickStartStep>("deposit");
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("10");
  const [depositError, setDepositError] = useState<string>("");
  const [depositStep, setDepositStep] = useState<"input" | "signing" | "executing">("input");
  const handledConfirmedHashesRef = React.useRef<Set<string>>(new Set());

  // Deposit flow state
  const { data: usdcNonce } = useReadContract({
    address: contractConfig.MockUSDC as `0x${string}`,
    abi: parseAbi(["function nonces(address) view returns (uint256)"]),
    functionName: "nonces",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress }
  });

  const { data: walletUsdcBalanceRaw, refetch: refetchWalletBalance } = useReadContract({
    address: contractConfig.MockUSDC as `0x${string}`,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress }
  });

  const walletUsdcBalance = isConnected && userAddress && walletUsdcBalanceRaw !== undefined
    ? Number(walletUsdcBalanceRaw) / 1e18
    : 0;

  const { signTypedDataAsync } = useSignTypedData();
  const { data: hash, writeContractAsync, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  const handleDeposit = useCallback(async () => {
    if (!userAddress || !signTypedDataAsync) return;

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
      const permitChainId = resolvePermitDomainChainId(chainId);

      if (!permitChainId) {
        setDepositError("Unable to determine wallet network. Please switch to the target testnet and retry.");
        setDepositStep("input");
        return;
      }

      const domain = {
        name: "MockUSDC",
        version: "1",
        chainId: permitChainId,
        verifyingContract: contractConfig.MockUSDC as `0x${string}`,
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const value = {
        owner: userAddress,
        spender: VAULT_ADDRESS,
        value: amount.toString(),
        nonce: nonce.toString(),
        deadline,
      };

      const signature = await signTypedDataAsync({
        account: userAddress,
        domain,
        types,
        primaryType: "Permit",
        message: value,
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

      toast.success("Deposit initiated! Waiting for confirmation...");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Deposit failed";
      setDepositError(message);
      setDepositStep("input");
      toast.error(message);
    }
  }, [chainId, userAddress, signTypedDataAsync, depositAmount, walletUsdcBalance, usdcNonce, writeContractAsync]);

  React.useEffect(() => {
    if (isConfirmed && hash) {
      const normalizedHash = String(hash).trim().toLowerCase();
      if (handledConfirmedHashesRef.current.has(normalizedHash)) {
        return;
      }
      handledConfirmedHashesRef.current.add(normalizedHash);

      setDepositStep("input");
      setIsDepositModalOpen(false);
      setCurrentStep("agent");
      onDepositComplete?.();
      toast.success("Deposit successful! Now create your first agent.");
      refetchWalletBalance();

      // Register deposit intent
      if (userAddress) {
        createDepositIntent(userAddress, {
          txHash: hash,
          amountUsdc: normalizeMoneyString(depositAmount),
        }).catch(console.error);
      }
    }
  }, [isConfirmed, hash, userAddress, depositAmount, onDepositComplete, refetchWalletBalance]);

  return (
    <section className="space-y-6" aria-label="Agent quick start">
      {/* PROGRESS STEPPER */}
      <ol className="grid grid-cols-4 gap-4">
        {STEPS.map((item, idx) => {
          const Icon = item.icon;
          const isActive = currentStep === item.step;
          const isCompleted = ["deposit", "agent"].includes(item.step) && currentStep !== item.step;
          let buttonClassName = "border-white/10 bg-white/[0.02]";
          let iconClassName = "bg-white/5";
          let iconColorClassName = "text-gray-500";
          let labelClassName = "text-gray-500";

          if (isActive) {
            buttonClassName = "border-blue-500 bg-blue-500/10";
            iconClassName = "bg-blue-500/20";
            iconColorClassName = "text-blue-400";
            labelClassName = "text-blue-400";
          } else if (isCompleted) {
            buttonClassName = "border-emerald-500 bg-emerald-500/10";
            iconClassName = "bg-emerald-500/20";
            iconColorClassName = "text-emerald-400";
            labelClassName = "text-emerald-400";
          }

          return (
            <li key={item.step} className="relative list-none">
              <button
                onClick={() => setCurrentStep(item.step)}
                aria-current={isActive ? "step" : undefined}
                className={`w-full p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-2 ${buttonClassName}`}
              >
                <span className={`p-2 rounded-lg ${iconClassName}`} aria-hidden="true">
                  <Icon className={`w-5 h-5 ${iconColorClassName}`} />
                </span>
                <span className={`text-xs font-bold ${labelClassName}`}>
                  {item.label}
                </span>
              </button>

              {idx < 3 && (
                <span className="absolute top-1/2 -right-2 w-4 h-0.5 bg-white/10 -translate-y-1/2" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>

      {/* STEP CONTENT */}
      <section className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 space-y-4" aria-live="polite">
        {currentStep === "deposit" && (
          <>
            <header className="flex items-start gap-3">
              <Zap className="w-5 h-5 text-blue-400 mt-0.5" />
              <section>
                <h3 className="font-bold text-white">Step 1: Deposit USDC</h3>
                <p className="text-sm text-gray-400 mt-1">
                  Transfer USDC from your wallet to the Synapse Vault. This is your credit balance for agent operations.
                </p>
              </section>
            </header>

            <dl className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 space-y-2">
              <dt className="text-xs font-bold text-gray-400 uppercase">Current Wallet Balance</dt>
              <dd className="text-lg font-bold text-white">{walletUsdcBalance.toFixed(2)} USDC</dd>
            </dl>

            <button
              onClick={() => setIsDepositModalOpen(true)}
              className="w-full py-3 bg-blue-500 text-white rounded-xl font-bold hover:bg-blue-400 transition-colors flex items-center justify-center gap-2"
            >
              <Zap className="w-4 h-4" />
              Deposit USDC Now
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}

        {currentStep === "agent" && (
          <>
            <header className="flex items-start gap-3">
              <Lock className="w-5 h-5 text-emerald-400 mt-0.5" />
              <section>
                <h3 className="font-bold text-white">Step 2: Create Your First Agent</h3>
                <p className="text-sm text-gray-400 mt-1">
                  An agent is a runtime identity that can discover and invoke services autonomously within your budget constraints.
                </p>
              </section>
            </header>

            <dl className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10 space-y-3">
              <div className="flex items-center justify-between">
                <dt className="text-xs font-bold text-gray-400 uppercase">Agent Name</dt>
                <dd className="text-sm text-gray-300">ResearchBot-01</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-xs font-bold text-gray-400 uppercase">Daily Budget</dt>
                <dd className="text-sm text-emerald-400 font-bold">$10.00 USDC</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-xs font-bold text-gray-400 uppercase">Max Calls/Day</dt>
                <dd className="text-sm text-gray-300">1000</dd>
              </div>
            </dl>

            <button
              onClick={() => {
                setCurrentStep("service");
                onAgentCreated?.();
              }}
              className="w-full py-3 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-400 transition-colors flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" />
              Create Agent
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}

        {currentStep === "service" && (
          <>
            <header className="flex items-start gap-3">
              <Rocket className="w-5 h-5 text-amber-400 mt-0.5" />
              <section>
                <h3 className="font-bold text-white">Step 3: Discover & Access Services</h3>
                <p className="text-sm text-gray-400 mt-1">
                  Browse the service marketplace, get quotes, and invoke APIs. Your agent will handle payments automatically.
                </p>
              </section>
            </header>

            <section className="space-y-3" aria-label="Example services">
              <article className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
                <header>
                  <p className="font-bold text-white text-sm">Data Aggregation API</p>
                  <p className="text-xs text-gray-500">$0.01 per call</p>
                </header>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </article>
              <article className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
                <header>
                  <p className="font-bold text-white text-sm">ML Model Inference</p>
                  <p className="text-xs text-gray-500">$0.05 per call</p>
                </header>
                <ChevronRight className="w-4 h-4 text-gray-500" />
              </article>
            </section>

            <button
              onClick={() => setCurrentStep("complete")}
              className="w-full py-3 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-400 transition-colors flex items-center justify-center gap-2"
            >
              <Rocket className="w-4 h-4" />
              Browse Services
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}

        {currentStep === "complete" && (
          <>
            <section className="text-center space-y-4">
              <span className="mx-auto w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center" aria-hidden="true">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </span>
              <header>
                <h3 className="font-bold text-white text-lg">You&apos;re All Set!</h3>
                <p className="text-sm text-gray-400 mt-2">
                  Your agent is ready to discover services and make autonomous API calls. Start exploring the marketplace.
                </p>
              </header>
            </section>

            <menu className="grid grid-cols-2 gap-3">
              <button className="py-3 bg-white/5 border border-white/10 text-white rounded-xl font-bold hover:bg-white/10 transition-colors">
                View Agents
              </button>
              <button className="py-3 bg-blue-500 text-white rounded-xl font-bold hover:bg-blue-400 transition-colors">
                Go to Marketplace
              </button>
            </menu>
          </>
        )}
      </section>

      {/* DEPOSIT MODAL */}
      {isDepositModalOpen && (
        <dialog open className="x-dialog-shell x-modal-overlay" aria-labelledby="deposit-modal-title">
          <section className="x-modal-flat x-modal-surface max-w-md shadow-2xl">
            <header className="x-modal-header">
              <h2 id="deposit-modal-title" className="text-lg font-bold text-white">Deposit USDC</h2>
              <button
                onClick={() => setIsDepositModalOpen(false)}
                className="x-modal-close"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <section className="x-modal-body space-y-6">
              <p className="space-y-2 block">
                <label htmlFor="deposit-amount" className="text-xs font-bold text-gray-500 uppercase">Amount (USDC)</label>
                <input
                  id="deposit-amount"
                  type="number"
                  step="0.01"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-blue-500/50"
                  placeholder="10.00"
                  disabled={depositStep !== "input"}
                />
                <p className="text-xs text-gray-500">
                  Available: {walletUsdcBalance.toFixed(2)} USDC
                </p>
              </p>

              {depositError && (
                <aside className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-400 text-sm" role="alert">
                  <AlertCircle className="w-5 h-5" />
                  {depositError}
                </aside>
              )}

              {/* Progress Steps */}
              {depositStep !== "input" && (
                <section className="space-y-3" aria-label="Deposit progress">
                  <article className={`p-3 border rounded-xl flex items-center gap-3 ${depositStep === "signing" ? "border-blue-500/50 bg-blue-500/10 text-blue-400" : "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"}`}>
                    {depositStep === "signing" ? <RefreshCw className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                    <section className="text-sm">
                      <p className="font-bold">Step 1: Sign Permit</p>
                      <p className="text-xs opacity-80">{depositStep === "signing" ? "Waiting for wallet signature..." : "✅ Signed"}</p>
                    </section>
                  </article>

                  <article className={`p-3 border rounded-xl flex items-center gap-3 ${depositStep === "executing" ? "border-blue-500/50 bg-blue-500/10 text-blue-400" : "border-gray-800 bg-gray-800/30 text-gray-500"}`}>
                    {depositStep === "executing" ? <RefreshCw className="w-5 h-5 animate-spin" /> : <AlertCircle className="w-5 h-5" />}
                    <section className="text-sm">
                      <p className="font-bold">Step 2: Execute Deposit</p>
                      <p className="text-xs opacity-80">{depositStep === "executing" ? "Confirming on-chain..." : "Waiting for step 1"}</p>
                    </section>
                  </article>
                </section>
              )}

              <menu className="flex gap-3">
                <button
                  onClick={() => setIsDepositModalOpen(false)}
                  disabled={depositStep !== "input"}
                  className="flex-1 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-bold hover:bg-white/10 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeposit}
                  disabled={depositStep !== "input" || isPending || isConfirming}
                  className="flex-1 py-3 bg-blue-500 text-white rounded-xl font-bold hover:bg-blue-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {(isPending || isConfirming) && <RefreshCw className="w-4 h-4 animate-spin" />}
                  {depositStep !== "input" || isConfirming ? "Processing..." : "Deposit"}
                </button>
              </menu>
            </section>
          </section>
        </dialog>
      )}
    </section>
  );
}
