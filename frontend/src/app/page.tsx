"use client";

import React, { useState, useEffect } from 'react';
import { Activity, ShieldCheck, ArrowRightLeft, DollarSign } from 'lucide-react';
import { ethers } from 'ethers';

// Load ABIs and Addresses dynamically generated from Hardhat
import config from '../contract-config.json';
import usdcAbi from '../MockUSDCABI.json';
import escrowAbi from '../EscrowABI.json';

// Mock Data for frontend visuals
const MOCK_AGENTS = [
  { id: '0x12...34aB', name: 'Auto-Trader-X', status: 'Active', balance: 540.2, limit: 1000, spent: 459.8 },
  { id: '0x88...f1C2', name: 'Data-Scraper-99', status: 'Warning', balance: 12.5, limit: 50, spent: 48.5 },
  { id: '0xFF...00E1', name: 'Arbitrage-Bot', status: 'Paused', balance: 0, limit: 500, spent: 500 },
];

export default function Dashboard() {
  const [logs, setLogs] = useState<{ time: string; type: string; msg: string }[]>([]);
  const [treasuryBalance, setTreasuryBalance] = useState("0.00");
  const [provider, setProvider] = useState<ethers.JsonRpcProvider | null>(null);

  // Initialize Web3 Connection
  useEffect(() => {
    // Connect to the local Hardhat Node
    const rpcProvider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    setProvider(rpcProvider);

    const initWeb3 = async () => {
      const usdcContract = new ethers.Contract(config.MockUSDC, usdcAbi, rpcProvider);
      
      const updateBalance = async () => {
        try {
          const balanceWei = await usdcContract.balanceOf(config.Treasury);
          setTreasuryBalance(ethers.formatUnits(balanceWei, 18));
        } catch (e) {
          console.error("Failed to fetch treasury balance:", e);
        }
      };

      await updateBalance();

      // Listen to Escrow events
      const escrowContract = new ethers.Contract(config.Escrow, escrowAbi, rpcProvider);
      
      escrowContract.on("TaskCreated", (taskId, buyer, seller, amount, event) => {
        const amt = ethers.formatUnits(amount, 18);
        addLog('ESCROW', `Locked ${amt} USDC for task ${taskId.substring(0,6)}...`);
      });

      escrowContract.on("TaskCompleted", (taskId, seller, sellerAmount, feeAmount, event) => {
        const fee = ethers.formatUnits(feeAmount, 18);
        const paid = ethers.formatUnits(sellerAmount, 18);
        addLog('RELEASE', `${paid} USDC paid to seller, ${fee} USDC protocol fee`);
        updateBalance(); // Refresh treasury balance when fee is collected
      });
    };

    initWeb3();

    return () => {
      // Cleanup event listeners
      rpcProvider.removeAllListeners();
    };
  }, []);

  const addLog = (type: string, msg: string) => {
    setLogs((prev) => {
      const newLog = {
        time: new Date().toLocaleTimeString('en-US', { hour12: false }),
        type,
        msg,
      };
      return [newLog, ...prev].slice(0, 15);
    });
  };

  return (
    <div className="min-h-screen p-8 max-w-7xl mx-auto space-y-8 animate-fade-in text-[#00FFA3] font-mono">
      
      {/* Header */}
      <header className="flex justify-between items-center border-b border-[#00FFA3]/30 pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-wider flex items-center gap-3">
            <ShieldCheck className="w-8 h-8" />
            AGENT_PAY / COMMAND_CENTER
          </h1>
          <p className="text-[#00FFA3]/70 mt-1 text-sm">ERC-4337 Session Key Management & Protocol Escrow</p>
          <div className="text-xs text-gray-500 mt-1">Local Network: HTTP://127.0.0.1:8545</div>
        </div>
        
        <div className="text-right">
          <div className="text-sm text-[#00FFA3]/70">REAL TREASURY BALANCE (USDC)</div>
          <div className="text-4xl font-black font-mono">
            ${parseFloat(treasuryBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Left Column: Active Agents & Session Keys */}
        <div className="md:col-span-2 space-y-6">
          <h2 className="text-xl font-bold border-b border-[#00FFA3]/30 pb-2 flex items-center gap-2">
            <Activity className="w-5 h-5" />
            ACTIVE SESSION KEYS
          </h2>
          
          <div className="grid gap-4">
            {MOCK_AGENTS.map((agent) => {
              const usagePercent = (agent.spent / agent.limit) * 100;
              let barColor = 'bg-[#00FFA3]';
              if (usagePercent > 80) barColor = 'bg-yellow-400';
              if (usagePercent >= 100) barColor = 'bg-red-500';

              return (
                <div key={agent.id} className="border border-[#00FFA3]/30 p-4 rounded-lg bg-black/50 hover:bg-[#00FFA3]/5 transition-colors">
                  <div className="flex justify-between items-center mb-3">
                    <div>
                      <div className="font-bold text-lg">{agent.name}</div>
                      <div className="text-sm text-[#00FFA3]/60 font-mono">{agent.id}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm">Daily Budget</div>
                      <div className="font-mono">
                        ${agent.spent.toFixed(2)} / ${agent.limit.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="w-full bg-gray-900 rounded-full h-2.5 outline outline-1 outline-[#00FFA3]/20">
                    <div className={`${barColor} h-2.5 rounded-full transition-all duration-500`} style={{ width: `${Math.min(usagePercent, 100)}%` }}></div>
                  </div>
                  
                  <div className="flex justify-between mt-2 text-xs opacity-70">
                    <div>Status: <span className={agent.status === 'Paused' ? 'text-red-500' : 'text-[#00FFA3]'}>[{agent.status}]</span></div>
                    <div>Remaining: ${(agent.limit - agent.spent).toFixed(2)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right Column: Live Escrow Feed */}
        <div className="space-y-6">
          <h2 className="text-xl font-bold border-b border-[#00FFA3]/30 pb-2 flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5" />
            LIVE CHAIN EVENTS
          </h2>
          
          <div className="border border-[#00FFA3]/30 h-[500px] overflow-hidden rounded-lg bg-gray-900/50 p-4 font-mono text-sm relative">
            <div className="absolute top-0 left-0 w-full h-8 bg-gradient-to-b from-black to-transparent z-10 pointer-events-none"></div>
            <div className="space-y-3 mt-4">
              {logs.length === 0 ? (
                <div className="text-gray-500 italic flex h-full items-center justify-center">Listening for on-chain events...</div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="animate-slide-up border-l-2 border-[#00FFA3] pl-3 py-1">
                    <div className="text-xs text-[#00FFA3]/60 mb-1">{log.time} | {log.type}</div>
                    <div className="text-gray-300">{log.msg}</div>
                  </div>
                ))
              )}
            </div>
            <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-black to-transparent z-10 pointer-events-none"></div>
          </div>
          
          <button className="w-full py-3 border border-[#00FFA3] hover:bg-[#00FFA3] hover:text-black font-bold tracking-widest transition-all uppercase flex justify-center items-center gap-2 mt-4 bg-black/50">
            <DollarSign className="w-5 h-5" />
            Top Up Master Wallet
          </button>

        </div>
      </div>
    </div>
  );
}
