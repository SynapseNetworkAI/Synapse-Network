"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { parseAbi, parseUnits } from "viem";
import contractConfig from "@/contract-config.json";
import { getV2Balance } from "@/utils/balanceApi";
import {
  issueAgentCredential,
  listAgentCredentials,
  revokeAgentCredential,
  type AgentCredentialRecord,
  type AgentCredentialIssueResponse,
} from "@/utils/agentCredentialApi";
import toast from "react-hot-toast";
import { Copy, Plus, Key, TerminalSquare, AlertCircle, RefreshCw, Wallet, Trash2, CheckCircle2 } from "lucide-react";

import { useAuth } from "@/components/WalletAuthGuard";
import { useVaultDeposit } from "@/hooks/useVaultDeposit";
import { useConnectModal } from "@rainbow-me/rainbowkit";

function toSortableTimestamp(value: string | number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

type ApiKeyListContentProps = {
  isSessionAuthenticated: boolean;
  keys: AgentCredentialRecord[];
  selectedTokenPrefix: string;
  onSelectTokenPrefix: (tokenPrefix: string) => void;
  onRevoke: (id: string) => void;
};

function ApiKeyListContent({
  isSessionAuthenticated,
  keys,
  selectedTokenPrefix,
  onSelectTokenPrefix,
  onRevoke,
}: Readonly<ApiKeyListContentProps>) {
  if (!isSessionAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center p-6 border border-gray-800 border-dashed rounded-lg bg-black/20">
        <Wallet className="w-8 h-8 mb-3 text-gray-600" />
        <p className="text-sm text-center text-gray-500">Connect your wallet to generate and view API keys.</p>
      </div>
    );
  }

  if (keys.length === 0) {
    return <p className="text-sm text-center text-gray-500 py-4">No active API keys found.</p>;
  }

  return keys.map((key) => {
    const isSelected = selectedTokenPrefix === key.tokenPrefix;
    const keyTone = isSelected ? "border-green-500/50 bg-green-500/5" : "border-gray-800 bg-gray-900/30";

    return (
      <div
        key={key.id}
        className={`flex items-center justify-between gap-3 p-3 border rounded-lg transition-colors ${keyTone}`}
      >
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onSelectTokenPrefix(key.tokenPrefix || "")}
        >
          <p className="font-mono text-sm text-gray-300">{key.tokenPrefix || "agt_"}••••••••</p>
          {key.name && <p className="mt-1 text-xs text-gray-400">{key.name}</p>}
          <p className="mt-1 text-[10px] text-gray-500 uppercase tracking-widest">
            {key.callsUsed} / {key.maxCalls} Calls Used
          </p>
          {typeof key.creditLimit === "number" && (
            <p className="mt-1 text-[10px] text-amber-400 uppercase tracking-widest">
              Limit: ${key.creditLimit} / {key.resetInterval || "daily"}
            </p>
          )}
        </button>
        <button
          type="button"
          onClick={() => onRevoke(key.id)}
          className="p-2 text-gray-500 transition-colors hover:text-red-400"
          title="Revoke Key"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    );
  });
}

export default function DeveloperConsole() {
  const { address, isConnected } = useAccount();
  const { isSessionAuthenticated, authorize } = useAuth();
  const { openConnectModal } = useConnectModal();
  
  // --- 1. Top-up Balance State ---
  const [balanceUsdc, setBalanceUsdc] = useState<number | null>(null);
  const loadBalance = useCallback(async () => {
    if (!address) return;
    try {
      const bal = await getV2Balance(address);
      setBalanceUsdc(bal.ownerBalance);
    } catch {
      // Ignore
    }
  }, [address]);

  const {
    isOpen: isTopUpOpen,
    openModal: openTopUpModal,
    closeModal: closeTopUpModal,
    depositAmount: topUpAmount,
    setDepositAmount: setTopUpAmount,
    depositError: topUpError,
    depositStep: topUpStep,
    handleDeposit: handleTopUp,
    isPending,
    isConfirming,
    walletUsdcBalance,
    vaultAddress,
    walletAddress,
    shortAddress,
  } = useVaultDeposit({
    onDepositSynced: loadBalance,
  });

  const { data: mintHash, writeContractAsync: writeMintAsync, isPending: isMinting } = useWriteContract();
  const { isSuccess: isMintConfirmed } = useWaitForTransactionReceipt({ hash: mintHash });

  // --- 2. API Keys State ---
  const [keys, setKeys] = useState<AgentCredentialRecord[]>([]);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("My App Key");
  const [newKeyCreditLimit, setNewKeyCreditLimit] = useState("100");
  const [newKeyResetFrequency, setNewKeyResetFrequency] = useState<"hourly" | "daily" | "weekly" | "monthly" | "never">("daily");
  const [newKeyExpirationDays, setNewKeyExpirationDays] = useState("30");
  const [latestIssued, setLatestIssued] = useState<AgentCredentialIssueResponse | null>(null);
  const [selectedTokenPrefix, setSelectedTokenPrefix] = useState<string>("");

  const handleAddFundsClick = useCallback(async () => {
    if (!isConnected && openConnectModal) {
      openConnectModal();
      return;
    }
    if (isConnected && !isSessionAuthenticated) {
      const success = await authorize();
      if (!success) return; // Stop if authorization was cancelled or failed
    }
    openTopUpModal();
  }, [authorize, isConnected, isSessionAuthenticated, openConnectModal, openTopUpModal]);

  const loadKeys = useCallback(async () => {
    if (!address) return;
    try {
      const rows = await listAgentCredentials(address);
      console.log("LOADED KEYS API RESP:", rows);
      const activeRows = rows
        .filter((k) => k.status === "active")
        .sort((a, b) => toSortableTimestamp(b.createdAt) - toSortableTimestamp(a.createdAt));
      setKeys(activeRows);
      if (activeRows.length > 0 && !selectedTokenPrefix) {
        setSelectedTokenPrefix(activeRows[0].tokenPrefix || "");
      }
    } catch (e) {
      console.error(e);
    }
  }, [address, selectedTokenPrefix]);

  useEffect(() => {
    if (isSessionAuthenticated) {
      loadBalance();
      loadKeys();
    }
  }, [isSessionAuthenticated, loadBalance, loadKeys]);

  useEffect(() => {
    if (isConnected && address && isSessionAuthenticated) return;
    setBalanceUsdc(null);
    setKeys([]);
    setLatestIssued(null);
    setSelectedTokenPrefix("");
  }, [isConnected, address, isSessionAuthenticated]);

  useEffect(() => {
    if (isMintConfirmed) {
      toast.success("100 USDC Minted to your Wallet! Now click 'Add Funds' to deposit.");
      void loadBalance();
    }
  }, [isMintConfirmed, loadBalance]);

  // --- Handlers ---
  
  const handleMint = async () => {
    if (!isConnected && openConnectModal) {
      openConnectModal();
      return;
    }
    if (isConnected && !isSessionAuthenticated) {
      const success = await authorize();
      if (!success) return;
    }
    if (!address) {
      toast.error("Please connect your wallet first.");
      return;
    }
    try {
      await writeMintAsync({
        address: contractConfig.MockUSDC as `0x${string}`,
        abi: parseAbi(["function mint(address,uint256)"]),
        functionName: "mint",
        args: [address, parseUnits("100", 18)],
      });
      toast.success("Transaction sent. Requesting 100 Mock USDC...");
    } catch (err: unknown) {
      if ((err as Error)?.message?.includes("User rejected") || (err as Error)?.message?.toLowerCase().includes("rejected")) {
        toast("Transaction cancelled by user", { icon: "ℹ️" });
      } else {
        toast.error("Failed to mint USDC: " + String(err));
      }
    }
  };

  const handleOpenKeyModal = async () => {
    if (!isConnected && openConnectModal) {
      openConnectModal();
      return;
    }
    if (isConnected && !isSessionAuthenticated) {
      const success = await authorize();
      if (!success) return;
    }
    setIsKeyModalOpen(true);
  };

  const handleCreateKeyAttempt = async () => {
    await executeCreateKey();
  };

  const executeCreateKey = async () => {
    if (!address) return;
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const expirationDays = Number(newKeyExpirationDays);
      const expiration = Number.isFinite(expirationDays) && expirationDays > 0
        ? nowSec + Math.floor(expirationDays * 24 * 3600)
        : undefined;

      const creditLimit = Number(newKeyCreditLimit);
      const created = await issueAgentCredential(address, {
        name: newKeyName.trim() || "My App Key",
        expiresInSec: 3600 * 24 * 365 * 10, // 10 years / basically never
        maxCalls: 1000000, 
        rpm: 600,
        creditLimit: Number.isFinite(creditLimit) && creditLimit > 0 ? creditLimit : undefined,
        resetInterval: newKeyResetFrequency,
        expiration,
      });
      setLatestIssued(created);
      toast.success("New API Key created!");
      setIsKeyModalOpen(false);
      setSelectedTokenPrefix(created.id); // temporary visual fallback until refresh
      await loadKeys();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err) || "Failed to create key");
    }
  };

  const handleRevoke = async (id: string) => {
    if (!address) {
      toast.error("Please connect your wallet first.");
      return;
    }
    try {
      await revokeAgentCredential(address, id);
      toast.success("Key revoked");
      await loadKeys();
    } catch {
      toast.error("Failed to revoke");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  const selectedKeyToDisplay = latestIssued?.token
    ?? (selectedTokenPrefix ? `${selectedTokenPrefix}...` : "agt_xxxxxxxxxx");
  const balanceDisplay = balanceUsdc === null ? "0.00" : balanceUsdc.toFixed(2);
  const apiCallEstimate = balanceUsdc === null ? 0 : Math.floor(balanceUsdc * 1000).toLocaleString();
  const topUpAmountNumber = Number(topUpAmount);
  const topUpAmountDisplay = Number.isFinite(topUpAmountNumber) ? topUpAmountNumber.toFixed(2) : "0.00";
  const topUpExecuteTone = topUpStep === "executing_tx" || isConfirming
    ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
    : "border-gray-800 bg-gray-800/30 text-gray-500";
  const topUpExecuteActive = topUpStep === "executing_tx" || isConfirming;

  return (
    <div className="max-w-5xl p-6 mx-auto space-y-6">
      
      {/* HEADER */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-800">
        <div>
          <h1 className="flex items-center text-3xl font-bold tracking-tight text-white">
            <TerminalSquare className="w-8 h-8 mr-3 text-green-400" />
            Developer Console
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            One-stop workspace to manage balance, API keys, and integration settings.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* LEFT COLUMN: Balance + API Keys */}
        <div className="space-y-6">
          
          {/* BALANCE CARD */}
          <div className="p-6 border shadow-lg border-green-900/40 rounded-xl bg-gray-900/50">
            <div className="flex items-start justify-between">
              <div>
                <p className="flex items-center text-sm font-semibold tracking-wider text-gray-400 uppercase">
                  <Wallet className="w-4 h-4 mr-2" />
                  My Balance
                </p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-4xl font-black text-white">
                    {balanceDisplay}
                  </span>
                  <span className="text-gray-400">USDC</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  ≈ {apiCallEstimate} API Calls available
                </p>
                {isConnected && (
                  <p className="mt-3 text-xs font-medium text-blue-400 bg-blue-900/20 px-2 py-1 rounded inline-flex items-center gap-1 border border-blue-900/30">
                    <Wallet className="w-3 h-3" /> Wallet: {walletUsdcBalance.toFixed(2)} USDC
                  </p>
                )}
              </div>
              <button
                onClick={handleMint}
                disabled={isMinting}
                className="flex items-center px-4 py-2 mr-3 text-sm font-bold text-blue-900 transition-colors bg-blue-400 hover:bg-blue-300 rounded-xl"
              >
                {isMinting ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : "💧 "}
                Faucet: Get 100 USDC 
              </button>
              <button
                onClick={handleAddFundsClick}
                className="flex items-center px-4 py-2 text-sm font-bold text-black transition-colors bg-green-500 hover:bg-green-400 rounded-xl"
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Funds
              </button>
            </div>
          </div>

          {/* API KEYS CARD */}
          <div className="p-6 border border-gray-800 shadow-lg rounded-xl bg-black/40">
            <div className="flex items-center justify-between mb-6">
              <h2 className="flex items-center text-lg font-bold text-white">
                <Key className="w-5 h-5 mr-2 text-yellow-400" />
                API Keys
              </h2>
              <button
                onClick={handleOpenKeyModal}
                className="flex items-center px-3 py-1.5 text-xs font-semibold text-white transition-colors bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700"
              >
                Create new secret key
              </button>
            </div>

            {latestIssued && (
              <div className="p-4 mb-6 mb-4 border border-green-500/50 bg-green-500/10 rounded-xl">
                <p className="flex items-center text-sm font-bold text-green-400">
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Save your secret key
                </p>
                <p className="mt-1 text-xs text-gray-400">Please copy this newly generated key now. You won&apos;t be able to see the full key again.</p>
                <div className="flex items-center mt-3 bg-black border border-green-900 rounded-lg">
                  <input readOnly value={latestIssued.token} className="w-full px-3 py-2 text-sm font-mono text-green-300 bg-transparent outline-none focus:ring-0" />
                  <button onClick={() => copyToClipboard(latestIssued.token)} className="p-2 text-gray-400 hover:text-white"><Copy className="w-4 h-4" /></button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <ApiKeyListContent
                isSessionAuthenticated={isSessionAuthenticated}
                keys={keys}
                selectedTokenPrefix={selectedTokenPrefix}
                onSelectTokenPrefix={setSelectedTokenPrefix}
                onRevoke={(id) => {
                  void handleRevoke(id);
                }}
              />
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN: Quick Start */}
        <div className="flex flex-col p-6 border border-gray-800 rounded-xl bg-gray-950">
          <div className="flex items-center mb-6">
            <TerminalSquare className="w-5 h-5 mr-3 text-cyan-400" />
            <h2 className="text-lg font-bold text-white">Quick Start</h2>
          </div>
          
          <div className="flex-1 space-y-4">
            <p className="text-sm text-gray-400">1. Install the Python SDK</p>
            <div className="relative group">
              <pre className="p-3 overflow-x-auto font-mono text-sm leading-relaxed text-gray-300 bg-black border border-gray-800 rounded-lg">
                pip install synapse-client
              </pre>
              <button onClick={() => copyToClipboard("pip install synapse-client")} className="absolute p-2 text-gray-500 transition-opacity opacity-0 top-1 right-2 hover:text-white group-hover:opacity-100"><Copy className="w-4 h-4" /></button>
            </div>

            <p className="mt-6 text-sm text-gray-400">2. Call AI services magically</p>
            <div className="relative flex-1 group">
              <pre className="min-h-full p-4 overflow-x-auto font-mono text-sm leading-relaxed text-blue-300 bg-black border border-gray-800 rounded-lg">
<span className="text-gray-500"># main.py</span>{"\n"}
<span className="text-purple-400">from</span> synapse_client <span className="text-purple-400">import</span> SynapseClient{"\n\n"}
<span className="text-gray-500"># Instantiates client using your active API key</span>{"\n"}
client = SynapseClient(api_key=<span className="text-green-300">&quot;{selectedKeyToDisplay}&quot;</span>){"\n\n"}
<span className="text-gray-500"># Send a request to an available service seamlessly</span>{"\n"}
response = client.call_service({"\n"}
    service_name=<span className="text-green-300">&quot;DeepSeek-Chat&quot;</span>,{"\n"}
    prompt=<span className="text-green-300">&quot;Hello from external app!&quot;</span>{"\n"}
){"\n\n"}
print(response.content){"\n"}
              </pre>
              <button 
                onClick={() => copyToClipboard(`from synapse_client import SynapseClient\n\nclient = SynapseClient(api_key="${selectedKeyToDisplay}")\n\nresponse = client.call_service(\n    service_name=&quot;DeepSeek-Chat&quot;,\n    prompt=&quot;Hello from external app!&quot;\n)\n\nprint(response.content)`)} 
                className="absolute p-2 text-gray-500 transition-opacity opacity-0 top-2 right-2 hover:text-white group-hover:opacity-100"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex items-start p-3 mt-4 text-xs text-yellow-500 border border-yellow-900/50 bg-yellow-900/10 rounded-xl">
              <AlertCircle className="w-4 h-4 mr-2 shrink-0" />
              <p>The SDK seamlessly proxies your API requests and automatically deducts the required USDC from your deposited Balance.</p>
            </div>
          </div>
        </div>
      </div>

      {/* TOP UP MODAL */}
      {isTopUpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 bg-gray-900 border border-gray-700 shadow-2xl rounded-2xl">
            <h3 className="mb-4 text-xl font-bold text-white">Add Funds</h3>
            <p className="mb-6 text-sm text-gray-400">Deposit USDC into your Developer Vault to pay for API calls without signing txs for each request.</p>
            
            <label className="block mb-4">
              <span className="mb-2 text-xs font-semibold tracking-wider text-gray-500 uppercase">Amount (USDC)</span>
              <div className="relative mt-1">
                <input 
                  type="number" 
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  disabled={topUpStep !== "input"}
                  className="w-full px-4 py-3 text-lg font-bold text-white bg-black border border-gray-700 rounded-xl focus:border-green-500 focus:ring-1 focus:ring-green-500/50 outline-none disabled:opacity-50"
                  min="1"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-4">
                  <span className="text-gray-500 font-bold">USDC</span>
                </div>
              </div>
            </label>

            {topUpError ? (
              <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {topUpError}
              </div>
            ) : null}

            <div className="mb-5 p-4 border border-cyan-900/50 bg-cyan-950/30 rounded-xl">
              <p className="text-xs font-semibold tracking-wider text-cyan-300 uppercase">Transaction Summary</p>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-gray-400">From Wallet</span>
                  <span className="font-mono text-gray-200">{shortAddress(walletAddress)}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-gray-400">To (Vault Contract)</span>
                  <span className="font-mono text-cyan-300" title={vaultAddress}>{shortAddress(vaultAddress)}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-gray-400">Deposit Amount</span>
                  <span className="font-bold text-white">{topUpAmountDisplay} USDC</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-gray-400">Max Permit Allowance (this tx)</span>
                  <span className="font-semibold text-cyan-200">{topUpAmountDisplay} USDC</span>
                </div>
              </div>
              <p className="mt-3 text-xs text-cyan-200/80">
                You are authorizing and depositing USDC to the on-chain Vault contract, not directly to a personal wallet.
              </p>
            </div>

            {/* Stepper Logic */}
            {(topUpStep !== "input" || isPending || isConfirming) && (
              <div className="mb-6 space-y-3">
                <div className={`p-3 border rounded-xl flex items-center gap-3 ${topUpStep === "signing_permit" ? "border-blue-500/50 bg-blue-500/10 text-blue-400" : "border-green-500/50 bg-green-500/10 text-green-400"}`}>
                  {topUpStep === "signing_permit" ? <RefreshCw className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                  <div className="text-sm">
                    <p className="font-bold">Step 1: 授权额度 (Permit)</p>
                    <p className="text-xs opacity-80">{topUpStep === "signing_permit" ? "MetaMask 弹窗：请签名授予智能合约扣款许可 (免 Gas)" : "✅ 授权签名已完成"}</p>
                  </div>
                </div>

                <div className={`p-3 border rounded-xl flex items-center gap-3 ${topUpExecuteTone}`}>
                   {topUpExecuteActive ? <RefreshCw className="w-5 h-5 animate-spin" /> : <AlertCircle className="w-5 h-5" />}
                  <div className="text-sm">
                    <p className="font-bold">Step 2: 充值上链 (Execute)</p>
                    <p className="text-xs opacity-80">{topUpExecuteActive ? "MetaMask 弹窗：支付矿工费，将资金充入合约金库安全保管..." : "等待第一步完成"}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-end mt-8">
              <button 
                onClick={closeTopUpModal}
                disabled={isPending || isConfirming}
                className="px-4 py-2 text-sm font-semibold text-gray-300 transition-colors hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button 
                onClick={handleTopUp}
                disabled={topUpStep !== "input" || isPending || isConfirming}
                className="px-6 py-2 text-sm font-bold text-black transition-colors bg-green-500 hover:bg-green-400 rounded-xl disabled:opacity-50 flex items-center gap-2"
              >
                {(isPending || isConfirming) ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                {topUpStep !== "input" || isConfirming ? "Processing..." : `Confirm Deposit ${topUpAmountDisplay} USDC`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE KEY MODAL */}
      {isKeyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm p-6 bg-gray-900 border border-gray-700 shadow-2xl rounded-2xl">
            <h3 className="mb-4 text-xl font-bold text-white">Create Secret Key</h3>
            
            <label className="block mb-6">
              <span className="mb-2 text-xs font-semibold tracking-wider text-gray-500 uppercase">Key Name</span>
              <input 
                type="text" 
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                className="w-full px-4 py-3 mt-1 text-sm font-semibold text-white bg-black border border-gray-700 rounded-xl focus:border-green-500 focus:ring-1 focus:ring-green-500/50 outline-none"
                placeholder="Database Script..."
              />
            </label>

            <label className="block mb-4">
              <span className="mb-2 text-xs font-semibold tracking-wider text-gray-500 uppercase">Credit Limit (USDC)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={newKeyCreditLimit}
                onChange={(e) => setNewKeyCreditLimit(e.target.value)}
                className="w-full px-4 py-3 mt-1 text-sm font-semibold text-white bg-black border border-gray-700 rounded-xl focus:border-green-500 focus:ring-1 focus:ring-green-500/50 outline-none"
                placeholder="100"
              />
            </label>

            <label className="block mb-4">
              <span className="mb-2 text-xs font-semibold tracking-wider text-gray-500 uppercase">Reset Frequency</span>
              <select
                value={newKeyResetFrequency}
                onChange={(e) => setNewKeyResetFrequency(e.target.value as "hourly" | "daily" | "weekly" | "monthly" | "never")}
                className="w-full px-4 py-3 mt-1 text-sm font-semibold text-white bg-black border border-gray-700 rounded-xl focus:border-green-500 focus:ring-1 focus:ring-green-500/50 outline-none"
              >
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="never">Never Reset</option>
              </select>
            </label>

            <label className="block mb-6">
              <span className="mb-2 text-xs font-semibold tracking-wider text-gray-500 uppercase">Expiration (Days)</span>
              <input
                type="number"
                min="1"
                step="1"
                value={newKeyExpirationDays}
                onChange={(e) => setNewKeyExpirationDays(e.target.value)}
                className="w-full px-4 py-3 mt-1 text-sm font-semibold text-white bg-black border border-gray-700 rounded-xl focus:border-green-500 focus:ring-1 focus:ring-green-500/50 outline-none"
                placeholder="30"
              />
              <p className="mt-2 text-xs text-gray-500">Gateway enforces this secret&apos;s spend cap during request forwarding.</p>
            </label>

            <div className="flex gap-3 justify-end mt-8">
              <button 
                onClick={() => setIsKeyModalOpen(false)} 
                className="px-4 py-2 text-sm font-semibold text-gray-300 transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button 
                onClick={handleCreateKeyAttempt}
                className="px-6 py-2 text-sm font-bold text-black transition-colors bg-green-500 hover:bg-green-400 rounded-xl disabled:opacity-50"
              >
                Generate Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}