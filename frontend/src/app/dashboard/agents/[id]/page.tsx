"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Wallet, Copy, Check, ShieldAlert } from "lucide-react";
import { agentStore, AgentIdentity } from "@/utils/agentStore";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { address: userAddress } = useAccount();
  const id = params.id as string;

  const [agent, setAgent] = useState<AgentIdentity | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState("0.00");
  const [ethBalance, setEthBalance] = useState("0.0000");

  useEffect(() => {
    const data = agentStore.getAgent(id);
    if (!data) {
      router.push("/dashboard/agents");
      return;
    }

    if (userAddress && data.ownerAddress && data.ownerAddress.toLowerCase() !== userAddress.toLowerCase()) {
      router.push("/dashboard/agents");
      return;
    }

    setAgent(data);
  }, [id, router, userAddress]);

  useEffect(() => {
    if (!agent?.address) {
      return;
    }

    const fetchBalances = async () => {
      try {
        const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
        const usdcContract = new ethers.Contract(contractConfig.MockUSDC, MockUSDCABI, provider);
        const [usdcRaw, ethRaw] = await Promise.all([
          usdcContract.balanceOf(agent.address),
          provider.getBalance(agent.address),
        ]);
        setUsdcBalance(Number.parseFloat(ethers.formatUnits(usdcRaw, 18)).toFixed(2));
        setEthBalance(Number.parseFloat(ethers.formatEther(ethRaw)).toFixed(4));
      } catch {
        setUsdcBalance("0.00");
        setEthBalance("0.0000");
      }
    };

    fetchBalances();
  }, [agent?.address]);

  const copyValue = async (value: string, type: "addr" | "key") => {
    await navigator.clipboard.writeText(value);
    if (type === "addr") {
      setCopiedAddr(true);
      setTimeout(() => setCopiedAddr(false), 1200);
      return;
    }
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1200);
  };

  if (!agent) {
    return null;
  }

  return (
    <div className="max-w-6xl p-8 mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Agent Details</h1>
          <p className="mt-1 text-gray-400">Read-only profile and wallet overview.</p>
        </div>
        <Link
          href="/dashboard/agents"
          className="inline-flex items-center px-3 py-2 text-xs font-bold text-gray-300 transition-colors border border-gray-700 rounded-lg hover:bg-gray-800"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Agents
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="p-4 border border-gray-800 rounded-xl bg-black/50">
          <div className="text-xs font-bold tracking-wider text-gray-500 uppercase">Agent Name</div>
          <div className="mt-2 text-lg font-semibold text-white">{agent.name}</div>
        </div>
        <div className="p-4 border border-gray-800 rounded-xl bg-black/50">
          <div className="text-xs font-bold tracking-wider text-gray-500 uppercase">Role</div>
          <div className="mt-2 text-lg font-semibold text-white">{agent.role || "seller"}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_230px]">
        <div className="p-4 border border-gray-800 rounded-xl bg-black/50">
          <h3 className="flex items-center mb-4 text-sm font-bold tracking-widest text-white uppercase">
            <Wallet className="w-4 h-4 mr-2 text-gray-400" />
            Agent Cryptographic Identity
          </h3>

          <div className="mb-4">
            <span className="block mb-2 text-xs font-bold tracking-wide text-gray-500 uppercase">Public Address</span>
            <div className="flex items-center">
              <code className="flex-1 p-3 overflow-hidden font-mono text-xs text-green-400 border border-gray-800 rounded-l-lg bg-gray-900/80 text-ellipsis">
                {agent.address}
              </code>
              <button
                type="button"
                onClick={() => copyValue(agent.address, "addr")}
                className="p-3 text-white transition-colors bg-gray-800 border-r border-gray-800 rounded-r-lg hover:bg-gray-700 border-y"
              >
                {copiedAddr ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <span className="block mb-2 text-xs font-bold tracking-wide text-gray-500 uppercase">Agent Wallet Private Key</span>
            <div className="flex items-start p-3 mb-3 border bg-red-950/20 border-red-900/40 rounded-xl">
              <ShieldAlert className="w-4 h-4 text-red-500 mt-0.5 mr-2 flex-shrink-0" />
              <p className="text-xs text-red-300">Read-only view. Keep this key secret and backed up.</p>
            </div>

            <div className="flex items-center h-12">
              <div className="relative flex items-center flex-1 h-full px-3 overflow-hidden border border-gray-800 rounded-l-lg bg-gray-900/80">
                <div className={`font-mono text-xs break-all ${showPrivateKey ? "text-red-400" : "text-gray-600 blur-sm select-none"}`}>
                  {agent.privateKey}
                </div>
                {!showPrivateKey && (
                  <button
                    type="button"
                    aria-label="Reveal private key"
                    className="absolute inset-0 z-10 flex items-center justify-center transition-colors cursor-pointer hover:bg-white/5"
                    onClick={() => setShowPrivateKey(true)}
                  >
                    <span className="px-3 py-1 text-xs font-bold text-gray-300 border border-gray-700 rounded bg-black/90">
                      Click to reveal
                    </span>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => copyValue(agent.privateKey, "key")}
                className="flex items-center justify-center h-full px-4 text-white transition-colors bg-gray-800 border-r border-gray-800 rounded-r-lg hover:bg-gray-700 border-y"
              >
                {copiedKey ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="p-3 border border-gray-800 rounded-lg bg-gray-900/40">
              <div className="text-[10px] font-bold tracking-wider text-gray-500 uppercase">USDC Balance</div>
              <div className="mt-1 font-mono text-base font-bold text-green-400">
                {usdcBalance}
                <span className="ml-1 text-xs text-gray-500">USDC</span>
              </div>
            </div>
            <div className="p-3 border border-gray-800 rounded-lg bg-gray-900/40">
              <div className="text-[10px] font-bold tracking-wider text-gray-500 uppercase">Native Balance</div>
              <div className="mt-1 font-mono text-base font-bold text-blue-400">
                {ethBalance}
                <span className="ml-1 text-xs text-gray-500">ETH</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center p-4 text-center border border-green-500/20 rounded-xl bg-green-500/5">
          <span className="mb-3 text-xs font-bold tracking-widest text-white uppercase">Address QR</span>
          <div className="inline-block p-3 mb-3 bg-white rounded-lg shadow-[0_0_20px_rgba(34,197,94,0.12)]">
            <QRCodeSVG value={agent.address || "0x"} size={140} level="H" />
          </div>
          <p className="font-mono text-[10px] leading-relaxed text-gray-400 break-all">{agent.address}</p>
        </div>
      </div>
    </div>
  );
}
