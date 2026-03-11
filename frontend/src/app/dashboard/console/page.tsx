"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useReadContract, useWriteContract, useSignTypedData, useChainId, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits, parseSignature, parseAbi } from "viem";
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

const ROUTER_ADDRESS = contractConfig.A2APaySyncRouter as `0x${string}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const VAULT_ADDRESS = (contractConfig as any).A2APayVault ? ((contractConfig as any).A2APayVault as `0x${string}`) : ROUTER_ADDRESS;

const vaultABI = parseAbi([
  "function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external"
]);

export default function DeveloperConsole() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  
  // --- 1. Top-up Balance State ---
  const [balanceUsdc, setBalanceUsdc] = useState<number | null>(null);
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("10");

  const { data: usdcNonce } = useReadContract({
    address: contractConfig.MockUSDC as `0x${string}`,
    abi: parseAbi(["function nonces(address) view returns (uint256)"]),
    functionName: "nonces",
    args: address ? [address] : undefined,
    query: { enabled: !!address }
  });

  const { signTypedDataAsync } = useSignTypedData();
  const { data: hash, writeContractAsync, isPending } = useWriteContract();
  const { writeContractAsync: writeMintAsync, isPending: isMinting } = useWriteContract();
  
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  // --- 2. API Keys State ---
  const [keys, setKeys] = useState<AgentCredentialRecord[]>([]);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("My App Key");
  const [latestIssued, setLatestIssued] = useState<AgentCredentialIssueResponse | null>(null);
  const [selectedTokenPrefix, setSelectedTokenPrefix] = useState<string>("");

  const loadBalance = useCallback(async () => {
    if (!address) return;
    try {
      const bal = await getV2Balance(address);
      setBalanceUsdc(bal.buyerBalance);
    } catch {
      // Ignore
    }
  }, [address]);

  const loadKeys = useCallback(async () => {
    if (!address) return;
    try {
      const rows = await listAgentCredentials(address);
      const activeRows = rows.filter((k) => k.status === "active").sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
      setKeys(activeRows);
      if (activeRows.length > 0 && !selectedTokenPrefix) {
        setSelectedTokenPrefix(activeRows[0].tokenPrefix || "");
      }
    } catch (e) {
      console.error(e);
    }
  }, [address, selectedTokenPrefix]);

  useEffect(() => {
    if (isConnected) {
      loadBalance();
      loadKeys();
    }
  }, [isConnected, loadBalance, loadKeys]);

  useEffect(() => {
    if (isConfirmed) {
      toast.success("Deposit successful!");
      setIsTopUpOpen(false);
      setTimeout(loadBalance, 2000);
    }
  }, [isConfirmed, loadBalance]);

  // --- Handlers ---
  
  const handleMint = async () => {
    if (!address) return;
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

  

  const handleTopUp = async () => {
    if (!address) return;
    const amountUsdc = Number(topUpAmount);
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return toast.error("Invalid amount");

    try {
      const amountBigInt = parseUnits(String(amountUsdc), 18);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hr
      const nonce = usdcNonce ?? BigInt(0);

      const signature = await signTypedDataAsync({
        domain: {
          name: "Mock USDC",
          version: "1",
          chainId: chainId,
          verifyingContract: contractConfig.MockUSDC as `0x${string}`,
        },
        types: {
          Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }],
        },
        primaryType: "Permit",
        message: { owner: address, spender: VAULT_ADDRESS, value: amountBigInt, nonce, deadline },
      });

      const { v, r, s } = parseSignature(signature);

      await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultABI,
        functionName: "depositWithPermit",
        args: [amountBigInt, deadline, Number(v), r, s],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User rejected") || msg.toLowerCase().includes("rejected")) {
        toast("Sign/Transaction cancelled by user", { icon: "ℹ️" });
      } else if (msg.includes("Insufficient Balance") || msg.includes("insufficient funds") || msg.includes("gas required exceeds allowance")) {
        toast.error("USDC 余额不足，请点击获取测试币", { duration: 5000 });
      } else {
        toast.error("Failed to top up: " + msg);
      }
    }
  };

  const handleCreateKey = async () => {
    if (!address) return;
    try {
      const created = await issueAgentCredential(address, {
        expiresInSec: 3600 * 24 * 365 * 10, // 10 years / basically never
        maxCalls: 1000000, 
        rpm: 600,
      });
      setLatestIssued(created);
      toast.success("New API Key created!");
      setIsKeyModalOpen(false);
      setSelectedTokenPrefix(created.id); // temporary visual fallback until refresh
      await loadKeys();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err instanceof Error ? err instanceof Error ? err.message : String(err) : String(err) : String(err) || "Failed to create key");
    }
  };

  const handleRevoke = async (id: string) => {
    if (!address) return;
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

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-gray-400">Please connect your wallet to view the developer console.</p>
      </div>
    );
  }

  const selectedKeyToDisplay = latestIssued ? latestIssued.token : (selectedTokenPrefix ? `${selectedTokenPrefix}...` : "agt_xxxxxxxxxx");

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
                    {balanceUsdc !== null ? balanceUsdc.toFixed(2) : "0.00"}
                  </span>
                  <span className="text-gray-400">USDC</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  ≈ {balanceUsdc !== null ? Math.floor(balanceUsdc * 1000).toLocaleString() : 0} API Calls available
                </p>
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
                onClick={handleMint}
                disabled={isMinting}
                className="flex items-center px-4 py-2 mr-3 text-sm font-bold text-blue-900 transition-colors bg-blue-400 hover:bg-blue-300 rounded-xl"
              >
                {isMinting ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : "💧 "}
                Faucet: Get 100 USDC 
              </button>
              <button
                onClick={() => setIsTopUpOpen(true)}
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
                onClick={() => setIsKeyModalOpen(true)}
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
              {keys.length === 0 ? (
                <p className="text-sm text-center text-gray-500 py-4">No active API keys found.</p>
              ) : (
                keys.map((key) => (
                  <div key={key.id} className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${selectedTokenPrefix === key.tokenPrefix ? "border-green-500/50 bg-green-500/5" : "border-gray-800 bg-gray-900/30"} cursor-pointer`} onClick={() => setSelectedTokenPrefix(key.tokenPrefix || "")}>
                    <div>
                      <p className="font-mono text-sm text-gray-300">{key.tokenPrefix || "agt_"}••••••••</p>
                      <p className="mt-1 text-[10px] text-gray-500 uppercase tracking-widest">
                        {key.callsUsed} / {key.maxCalls} Calls Used
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRevoke(key.id); }}
                      className="p-2 text-gray-500 transition-colors hover:text-red-400"
                      title="Revoke Key"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
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
                pip install a2a-pay
              </pre>
              <button onClick={() => copyToClipboard("pip install a2a-pay")} className="absolute p-2 text-gray-500 transition-opacity opacity-0 top-1 right-2 hover:text-white group-hover:opacity-100"><Copy className="w-4 h-4" /></button>
            </div>

            <p className="mt-6 text-sm text-gray-400">2. Call AI services magically</p>
            <div className="relative flex-1 group">
              <pre className="min-h-full p-4 overflow-x-auto font-mono text-sm leading-relaxed text-blue-300 bg-black border border-gray-800 rounded-lg">
<span className="text-gray-500"># main.py</span>{"\n"}
<span className="text-purple-400">from</span> a2a_pay <span className="text-purple-400">import</span> AgentPayClient{"\n\n"}
<span className="text-gray-500"># Instantiates client using your active API key</span>{"\n"}
client = AgentPayClient(api_key=<span className="text-green-300">&quot;{selectedKeyToDisplay}&quot;</span>){"\n\n"}
<span className="text-gray-500"># Send a request to an available service seamlessly</span>{"\n"}
response = client.call_service({"\n"}
    service_name=<span className="text-green-300">&quot;DeepSeek-Chat&quot;</span>,{"\n"}
    prompt=<span className="text-green-300">&quot;Hello from external app!&quot;</span>{"\n"}
){"\n\n"}
print(response.content){"\n"}
              </pre>
              <button 
                onClick={() => copyToClipboard(`from a2a_pay import AgentPayClient\n\nclient = AgentPayClient(api_key="${selectedKeyToDisplay}")\n\nresponse = client.call_service(\n    service_name=&quot;DeepSeek-Chat&quot;,\n    prompt=&quot;Hello from external app!&quot;\n)\n\nprint(response.content)`)} 
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
                  className="w-full px-4 py-3 text-lg font-bold text-white bg-black border border-gray-700 rounded-xl focus:border-green-500 focus:ring-1 focus:ring-green-500/50 outline-none"
                  min="1"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-4">
                  <span className="text-gray-500 font-bold">USDC</span>
                </div>
              </div>
            </label>

            <div className="flex gap-3 justify-end mt-8">
              <button 
                onClick={() => setIsTopUpOpen(false)} 
                disabled={isPending || isConfirming}
                className="px-4 py-2 text-sm font-semibold text-gray-300 transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button 
                onClick={handleTopUp}
                disabled={isPending || isConfirming}
                className="px-6 py-2 text-sm font-bold text-black transition-colors bg-green-500 hover:bg-green-400 rounded-xl disabled:opacity-50 flex items-center gap-2"
              >
                {(isPending || isConfirming) ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                {isConfirming ? "Confirming..." : isPending ? "Signing..." : "Complete Top-up"}
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
              <p className="mt-2 text-xs text-gray-500">By default, new keys have full access to all proxy services.</p>
            </label>

            <div className="flex gap-3 justify-end mt-8">
              <button 
                onClick={() => setIsKeyModalOpen(false)} 
                className="px-4 py-2 text-sm font-semibold text-gray-300 transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button 
                onClick={handleCreateKey}
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