"use client";

import React, { useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import toast from "react-hot-toast";
import { listAgentCredentials } from "@/utils/agentCredentialApi";
import RoleWarningModal from "@/components/RoleWarningModal";

export default function SellDashboard() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [isRoleWarningOpen, setIsRoleWarningOpen] = useState(false);

  const handlePublishClick = async () => {
    if (!address) {
      toast.error("Please connect your wallet first.");
      return;
    }
    try {
      const keys = await listAgentCredentials(address);
      const activeKeys = keys.filter(k => k.status === "active");
      if (activeKeys.length > 0) {
        setIsRoleWarningOpen(true);
        return;
      }
      toast("Publish workflow coming soon!", { icon: "🚀" });
    } catch(e) {
      console.warn("Check failed", e);
      toast("Publish workflow coming soon!", { icon: "🚀" });
    }
  };

  return (
    <div className="min-h-screen bg-black text-green-500 font-mono p-8 animate-in fade-in duration-700">
      {/* Hero Section */}
      <section className="mb-12 border-b border-green-500/30 pb-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-4xl font-bold mb-4 text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]">
              Monetize Your AI APIs & Agents
            </h1>
            <p className="text-xl text-green-500/80 max-w-2xl">
              只需 3 行命令，将你的本地 FastAPI / Agent 变现。零 Gas 扣费，极速结算到链上 Vault。
            </p>
          </div>
          {!isConnected && (
            <div className="animate-pulse px-4 py-2 border border-green-500 rounded text-green-400 bg-green-900/20">
              [ Connect Wallet to Action ]
            </div>
          )}
        </div>

        {/* KPI Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-8">
          <div className="border border-green-500/30 p-4 bg-green-900/10">
            <div className="text-green-500/60 text-sm mb-1">Life-Time Earnings</div>
            <div className="text-2xl font-bold">{isConnected ? "1,245.50 USDC" : "0.00 USDC"}</div>
          </div>
          <div className="border border-green-500/30 p-4 bg-green-900/10 relative overflow-hidden group">
            <div className="text-green-500/60 text-sm mb-1">Unclaimed Balance</div>
            <div className="text-2xl font-bold text-green-300">{isConnected ? "305.00 USDC" : "0.00 USDC"}</div>
            {isConnected && (
              <button className="absolute right-4 top-4 text-xs px-2 py-1 border border-green-500 hover:bg-green-500 hover:text-black transition-colors focus:ring-2 focus:ring-green-300">
                Claim
              </button>
            )}
            <div className="absolute inset-0 bg-green-500/5 -translate-x-[100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
          </div>
          <div className="border border-green-500/30 p-4 bg-green-900/10">
            <div className="text-green-500/60 text-sm mb-1">Total API Calls</div>
            <div className="text-2xl font-bold">{isConnected ? "42,109" : "0"}</div>
          </div>
          <div className="border border-green-500/30 p-4 bg-green-900/10">
            <div className="text-green-500/60 text-sm mb-1">Active Services</div>
            <div className="text-2xl font-bold flex items-center gap-2">
              {isConnected ? "2 Online" : "0"}
              {isConnected && <div className="w-2 h-2 rounded-full bg-green-500 animate-ping" />}
            </div>
          </div>
        </div>
      </section>

      {/* 3-Step How-To Earn */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-6 border-l-4 border-green-500 pl-4">3-Step How-To Earn</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border border-green-500/50 p-6 hover:bg-green-900/20 transition-colors">
            <div className="text-3xl font-bold text-green-500/30 mb-4">01</div>
            <h3 className="font-bold text-lg mb-2">Register AI-Native Manifest</h3>
            <p className="text-sm text-green-500/70 mb-4 h-24">
              你的 Web3 钱包即全局唯一法人。直接向平台注册 Manifest，声明端点、调用价格、工具标识及意图标签，买方大模型可自动发掘你的服务。
            </p>
            <button 
              onClick={isConnected ? handlePublishClick : undefined}
              className={`w-full py-2 border transition-all ${isConnected ? "border-green-500 hover:bg-green-500 hover:text-black shadow-[0_0_10px_rgba(74,222,128,0.2)]" : "border-gray-600 text-gray-500 cursor-not-allowed bg-black/50"}`}
            >
              {isConnected ? "Publish Service" : "Connect Wallet"}
            </button>
          </div>
          <div className="border border-green-500/50 p-6 hover:bg-green-900/20 transition-colors">
            <div className="text-3xl font-bold text-green-500/30 mb-4">02</div>
            <h3 className="font-bold text-lg mb-2">Setup Gateway Security</h3>
            <p className="text-sm text-green-500/70 mb-4 h-24">
              平台签发你的 Secret_Key。使用 Python SDK 包装原有接口，基于 HMAC-SHA256 算法，无情拦截所有绕过网关的“白嫖”流量。
            </p>
            <div className="bg-black/80 border border-green-500/30 p-3 text-xs overflow-x-auto rounded mt-2">
              <code className="font-mono">
                <span className="text-gray-500"># HMAC Signature Validation</span><br/>
                <span className="text-pink-500">from</span> synapse_client <span className="text-pink-500">import</span> SynapseGateway<br/>
                <br/>
                <span className="text-blue-300">gw</span> = SynapseGateway(secret_key=<span className="text-green-300">&quot;sk_...&quot;</span>)<br/>
                <span className="text-blue-300">gw</span>.start(port=<span className="text-yellow-400">8000</span>)<br/>
              </code>
            </div>
          </div>
          <div className="border border-green-500/50 p-6 hover:bg-green-900/20 transition-colors bg-[url('/grid-pattern.svg')]">
            <div className="text-3xl font-bold text-green-500/30 mb-4">03</div>
            <h3 className="font-bold text-lg mb-2">Earn & Request Settlement</h3>
            <p className="text-sm text-green-500/70 mb-4 h-24">
              买家高频调用你的服务，收益在本地全数累积。随时一键将加密凭证提交到链上 Vault，零手续费极速全额提取 USDC 到你的钱包。
            </p>
            <button className={`w-full py-2 border transition-all mt-[4.5rem] ${isConnected ? "border-green-500 hover:bg-green-500 hover:text-black" : "border-gray-600 text-gray-500 cursor-not-allowed bg-black/50"}`}>
              {isConnected ? "Go to Settle ->" : "Connect Wallet"}
            </button>
          </div>
        </div>
      </section>

      {/* Services Grid Rendered Only if Connected */}
      {isConnected && (
        <section className="mb-12 animate-in slide-in-from-bottom-4 duration-500 fade-in">
           <h2 className="text-2xl font-bold mb-6 border-l-4 border-green-500 pl-4">My Manifests & Services</h2>
           <div className="w-full border border-green-500/30 bg-black/50 backdrop-blur">
              <table className="w-full text-left">
                <thead className="bg-green-900/30 border-b border-green-500/30 text-green-400/80">
                  <tr>
                    <th className="p-3 font-normal">Service & Tool Name</th>
                    <th className="p-3 font-normal">Endpoint & Health</th>
                    <th className="p-3 font-normal">QoS & Pricing</th>
                    <th className="p-3 font-normal">Status</th>
                    <th className="p-3 font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-green-500/10 hover:bg-green-900/20 transition-colors">
                    <td className="p-3">
                        <div className="font-bold">DeepSeek-Chat</div>
                        <div className="text-xs text-gray-500 font-mono mt-1">Tool: get_deepseek_chat</div>
                        <div className="flex gap-1 mt-1">
                            <span className="text-[10px] px-1 bg-blue-900/30 text-blue-400 border border-blue-500/30 rounded">llm</span>
                        </div>
                    </td>
                    <td className="p-3">
                        <div className="text-sm opacity-80 font-mono">http://localhost:8000/v1/chat</div>
                        <div className="text-xs text-gray-500 font-mono mt-1 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span> Health: OK
                        </div>
                    </td>
                    <td className="p-3">
                        <div className="text-green-300">0.05 USDC / Call</div>
                        <div className="text-xs text-gray-500 mt-1">Max 50 QPS</div>
                    </td>
                    <td className="p-3">
                      <div className="inline-flex items-center gap-2 px-2 py-1 bg-green-900/40 border border-green-500/50 rounded-full text-xs">
                        <div className="w-1.5 h-1.5 bg-green-400 rounded-full shadow-[0_0_5px_#4ade80]"></div>
                        Online
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col gap-2 w-max">
                        <button className="text-xs border border-green-500 px-3 py-1 hover:bg-green-500 hover:text-black transition-colors rounded-sm text-center">View Secret Key</button>
                        <div className="flex gap-2">
                           <button className="text-xs border border-green-500 px-3 py-1 hover:bg-green-500 hover:text-black transition-colors rounded-sm flex-1">Metrics</button>
                           <button className="text-xs border border-green-500 px-3 py-1 hover:bg-green-500 hover:text-black transition-colors rounded-sm flex-1">Edit</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
           </div>
        </section>
      )}

      {/* Income Ledger */}
      {isConnected && (
        <section className="animate-in slide-in-from-bottom-8 duration-700 fade-in delay-150">
          <h2 className="text-2xl font-bold mb-6 border-l-4 border-green-500 pl-4">Income Ledger Pipeline</h2>
           <div className="w-full border border-green-500/30 bg-black/50 backdrop-blur">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-green-900/30 border-b border-green-500/30 text-green-400/80">
                  <tr>
                    <th className="p-3 font-normal">Tx Hash / Job ID</th>
                    <th className="p-3 font-normal">Service</th>
                    <th className="p-3 font-normal">Amount</th>
                    <th className="p-3 font-normal">Net Earned</th>
                    <th className="p-3 font-normal">Status</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <tr className="border-b border-green-500/10 hover:bg-green-900/20 transition-colors">
                    <td className="p-3 text-blue-400">job_9f8x...3j2a</td>
                    <td className="p-3">DeepSeek-Chat</td>
                    <td className="p-3">0.05 USDC</td>
                    <td className="p-3 text-green-400">+0.049 USDC</td>
                    <td className="p-3">
                      <span className="px-2 py-1 bg-yellow-900/30 text-yellow-400 border border-yellow-500/30 rounded text-xs flex w-max">
                        Local Recorded
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b border-green-500/10 hover:bg-green-900/20 transition-colors">
                    <td className="p-3 text-blue-400">tx_0xa1...b89c</td>
                    <td className="p-3">Stable-Diffusion-XL</td>
                    <td className="p-3">0.25 USDC</td>
                    <td className="p-3 text-green-400">+0.245 USDC</td>
                    <td className="p-3">
                      <span className="px-2 py-1 bg-green-900/30 text-green-400 border border-green-500/30 rounded text-xs flex items-center gap-1 w-max">
                        On-chain Confirmed
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
           </div>
        </section>
      )}

      <RoleWarningModal
        isOpen={isRoleWarningOpen}
        onDisconnect={() => {
          disconnect();
          setIsRoleWarningOpen(false);
        }}
        targetRole="Buyer"
      />

    </div>
  );
}
