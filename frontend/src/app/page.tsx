"use client";

import React, { useState, useEffect } from 'react';
import { Activity, ArrowRightLeft, DollarSign, Database, BrainCircuit, Terminal, GlobeLock } from 'lucide-react';
import { ethers } from 'ethers';

import config from '../contract-config.json';
import usdcAbi from '../MockUSDCABI.json';
import escrowAbi from '../EscrowABI.json';

interface Deal {
  taskId: string;
  buyer: string;
  seller: string;
  amount: string;
  status: "LOCKED" | "RELEASED" | "DISPUTED" | "RESOLVED";
  txHash: string;
  blockNumber: number;
}

export default function GodsViewDashboard() {
  const [logs, setLogs] = useState<{ time: string; type: string; msg: string; hash?: string }[]>([]);
  const [treasuryBalance, setTreasuryBalance] = useState("0.00");
  const [deals, setDeals] = useState<Deal[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'LOCKED': return 'border-yellow-500/50 bg-yellow-500/10 text-yellow-500';
      case 'RELEASED': return 'border-[#00FFA3]/50 bg-[#00FFA3]/10 text-[#00FFA3]';
      case 'DISPUTED': return 'border-red-500/50 bg-red-500/10 text-red-500 animate-pulse';
      case 'RESOLVED': return 'border-blue-500/50 bg-blue-500/10 text-blue-500';
      default: return 'border-gray-500/50 bg-gray-500/10 text-gray-500';
    }
  };
  
  const getStatusText = (status: string) => {
    switch(status) {
      case 'LOCKED': return 'ESCROW LOCKED';
      case 'RELEASED': return 'CLEARED & TAXED';
      case 'DISPUTED': return 'COURT JURY (FROZEN)';
      case 'RESOLVED': return 'ARBITRATION CLOSED';
      default: return 'UNKNOWN';
    }
  };

  const addLog = (type: string, msg: string, hash?: string) => {
    setLogs(prev => [{
      time: new Date().toLocaleTimeString(),
      type,
      msg,
      hash
    }, ...prev].slice(0, 50));
  };

  useEffect(() => {
    let provider: ethers.JsonRpcProvider;
    let usdcContract: ethers.Contract;
    let escrowContract: ethers.Contract;

    const initData = async () => {
      try {
        provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
        usdcContract = new ethers.Contract(config.MockUSDC, usdcAbi, provider);
        escrowContract = new ethers.Contract(config.Escrow, escrowAbi, provider);
        
        setIsConnected(true);
        addLog("SYSTEM", "AI Matrix Uplink Established (Local Node 127.0.0.1)");

        // Fetch Treasury
        const balanceWei = await usdcContract.balanceOf(config.Treasury);
        setTreasuryBalance(ethers.formatUnits(balanceWei, 18));

        // Fetch History Deals
        const taskCreatedFilter = escrowContract.filters.TaskCreated();
        const createdEvents = await escrowContract.queryFilter(taskCreatedFilter, 0, "latest");
        
        const taskReleasedFilter = escrowContract.filters.TaskCompleted();
        const releasedEvents = await escrowContract.queryFilter(taskReleasedFilter, 0, "latest");
        
        // Find which ones are released
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const releasedIds = new Set(releasedEvents.map((e: any) => e.args[0]));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const historyDeals: Deal[] = createdEvents.map((e: any) => ({
          taskId: e.args[0],
          buyer: e.args[1],
          seller: e.args[2],
          amount: ethers.formatUnits(e.args[3], 18),
          status: (releasedIds.has(e.args[0]) ? "RELEASED" : "LOCKED") as Deal["status"],
          txHash: e.transactionHash,
          blockNumber: e.blockNumber
        })).reverse(); // Newest first

        setDeals(historyDeals);

        if(historyDeals.length > 0) {
            addLog("SCANNER", `Detected ${historyDeals.length} past protocol swaps in mempool.`);
        }

        // Real-time Event Listeners
        escrowContract.on("TaskCreated", (taskId, buyer, seller, amount, event) => {
          const amt = ethers.formatUnits(amount, 18);
          addLog('ESCROW', `A2A Negotiation Settled! Locked ${amt} USDC for task ${taskId.substring(0,8)}...`, event.log.transactionHash);
          setDeals(prev => [{
            taskId: taskId,
            buyer: buyer,
            seller: seller,
            amount: amt,
            status: "LOCKED",
            txHash: event.log.transactionHash,
            blockNumber: event.log.blockNumber
          }, ...prev]);
        });

        escrowContract.on("TaskCompleted", (taskId, seller, amount, fee, event) => {
          const amt = ethers.formatUnits(amount, 18);
          const f = ethers.formatUnits(fee, 18);
          addLog('PROTOCOL', `Task Complete: Released ${amt} USDC. Tax collected: ${f} USDC`, event.log.transactionHash);
          
          setDeals(prev => prev.map(d => 
            d.taskId === taskId ? { ...d, status: "RELEASED" } : d
          ));
          
          // Refresh Treasury
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          usdcContract.balanceOf(config.Treasury).then((bal: any) => {
            setTreasuryBalance(ethers.formatUnits(bal, 18));
          });
        });

        escrowContract.on("DisputeRaised", (taskId, raiser, event) => {
          addLog('DISPUTE', `[!] ALERT: Game Theory Conflict! Dispute raised by ${raiser.substring(0,8)}... on task ${taskId.substring(0,8)}. Funds frozen.`, event.log.transactionHash);
          setDeals(prev => prev.map(d => 
            d.taskId === taskId ? { ...d, status: "DISPUTED" } : d
          ));
        });

        escrowContract.on("DisputeResolved", (taskId, winner, event) => {
          addLog('ARBITRATION', `Multi-Agent Jury ruled in favor of ${winner.substring(0,8)}. Assets re-routed.`, event.log.transactionHash);
          setDeals(prev => prev.map(d => 
            d.taskId === taskId ? { ...d, status: "RESOLVED" } : d
          ));
        });

      } catch (err) {
        console.error("Connection error:", err);
        addLog("ERROR", "Failed to uplink to local hardhat node.");
      }
    };

    initData();

    return () => {
      // Need to clean up listener safely
      if (escrowContract) {
        escrowContract.removeAllListeners();
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#050505] text-[#00FFA3] font-mono p-6 selection:bg-[#00FFA3] selection:text-black">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-[#00FFA3]/30 pb-4 mb-8">
        <div className="flex items-center space-x-3">
          <BrainCircuit className="w-8 h-8 text-[#00FFA3] shadow-[0_0_15px_#00FFA3] animate-pulse" />
          <h1 className="text-2xl font-bold tracking-widest uppercase">
            NoCenterPay <span className="text-sm opacity-50">:: The God&apos;s View</span>
          </h1>
        </div>
        <div className="flex items-center space-x-6 text-sm">
          <div className="flex items-center space-x-2 border border-[#00FFA3]/20 bg-[#00FFA3]/5 px-3 py-1 rounded">
            <GlobeLock className="w-4 h-4" />
            <span>A2A-ANP Protocol: <span className="font-bold text-green-400">ONLINE</span></span>
          </div>
          <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-[#00FFA3] shadow-[0_0_8px_#00FFA3]' : 'bg-red-500'}`}></div>
            <span>{isConnected ? "Base Node Synced" : "Node Offline"}</span>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        
        {/* Left Column: Stats & Entities */}
        <div className="space-y-6">
          <div className="border border-[#00FFA3]/30 bg-black/50 p-6 rounded relative overflow-hidden group hover:border-[#00FFA3] transition-colors">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#00FFA3] opacity-5 blur-[50px] group-hover:opacity-10 transition-opacity"></div>
            <h2 className="flex items-center mb-4 text-sm tracking-widest uppercase opacity-60"><Database className="w-4 h-4 mr-2"/> Platform Protocol Treasury</h2>
            <div className="flex items-center mb-2 text-5xl font-black">
              <DollarSign className="w-10 h-10 mr-[-5px]" />
              {treasuryBalance} <span className="mt-4 ml-2 text-sm opacity-50">USDC</span>
            </div>
            <p className="text-xs opacity-50 uppercase mt-4 border-t border-[#00FFA3]/10 pt-4">Autonomously accumulating zero-friction protocol gas...</p>
          </div>

          <div className="border border-[#00FFA3]/30 bg-black/50 rounded flex flex-col h-[600px]">
            <div className="p-4 border-b border-[#00FFA3]/30 bg-[#00FFA3]/10 uppercase text-xs font-bold tracking-wider flex items-center">
              <Terminal className="w-4 h-4 mr-2" /> Live Neuromancer Log
            </div>
            <div className="p-4 font-mono text-[11px] space-y-3 overflow-y-auto flex-1">
              {logs.length === 0 && <div className="text-[#00FFA3]/30 italic animate-pulse">Scanning the void... awaiting Agent interactions</div>}
              {logs.map((log, i) => (
                <div key={i} className="flex flex-col mb-2 border-l-2 border-[#00FFA3]/20 pl-2">
                  <div className="flex">
                    <span className="text-[#00FFA3]/40 w-20 flex-shrink-0">[{log.time}]</span>
                    <span className={`w-20 font-bold flex-shrink-0 ${log.type === 'ESCROW' ? 'text-yellow-400' : log.type === 'PROTOCOL' ? 'text-purple-400' : log.type === 'ERROR' ? 'text-red-500' : 'text-[#00FFA3]/70'}`}>{log.type}</span>
                    <span className="ml-2 text-white">{log.msg}</span>
                  </div>
                  {log.hash && (
                    <div className="text-[9px] ml-40 mt-1 opacity-40 hover:text-[#00FFA3] cursor-pointer">Hash: {log.hash}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Live Matrix View */}
        <div className="lg:col-span-2 space-y-6 flex flex-col h-[calc(100vh-140px)]">
          <div className="border border-[#00FFA3]/30 bg-black/50 rounded flex flex-col flex-1">
            <div className="p-4 border-b border-[#00FFA3]/30 bg-[#00FFA3]/10 uppercase text-xs font-bold tracking-wider flex justify-between items-center">
              <span className="flex items-center"><Activity className="w-4 h-4 mr-2 text-[#00FFA3]" /> On-chain A2A Swaps Matrix (Real-Time)</span>
              <span className="text-[10px] bg-[#00FFA3]/20 text-[#00FFA3] px-2 py-1 rounded">Total: {deals.length} deals</span>
            </div>
            <div className="flex-1 p-0 overflow-auto">
              <table className="w-full text-left text-sm text-[#00FFA3]">
                <thead className="bg-[#00FFA3]/5 text-[10px] uppercase opacity-70 sticky top-0 backdrop-blur-md z-10 shadow-md">
                  <tr>
                    <th className="p-4 font-bold border-b border-[#00FFA3]/20">Block</th>
                    <th className="p-4 font-bold border-b border-[#00FFA3]/20">A2A Task ID</th>
                    <th className="p-4 font-bold border-b border-[#00FFA3]/20">Execution Trace (Buyer <ArrowRightLeft className="inline w-3 h-3 mx-1"/> Seller)</th>
                    <th className="p-4 font-bold border-b border-[#00FFA3]/20 text-right">Fund Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#00FFA3]/10">
                  {deals.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="relative p-8 text-center opacity-50 group">
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#00FFA3]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        Awaiting the first A2A transaction... Run the Python Agent Script!
                      </td>
                    </tr>
                  ) : deals.map((d, i) => (
                    <tr key={i} className="hover:bg-[#00FFA3]/10 transition-colors group">
                      <td className="p-4 font-mono text-xs opacity-50">#{d.blockNumber}</td>
                      <td className="p-4 space-y-1">
                        <div className="font-bold text-white group-hover:text-[#00FFA3] transition-colors">{d.taskId.substring(0, 14)}...</div>
                        <div className="text-[10px] opacity-40">Tx: {d.txHash.substring(0,14)}...</div>
                      </td>
                      <td className="p-4 space-x-2 text-xs font-medium">
                        <span className="opacity-50 bg-[#00FFA3]/10 px-2 py-1 rounded">{d.buyer.substring(0,6)}...{d.buyer.substring(38)}</span>
                        <ArrowRightLeft className="w-3 h-3 inline text-[#00FFA3]" />
                        <span className="opacity-50 bg-[#00FFA3]/10 px-2 py-1 rounded">{d.seller.substring(0,6)}...{d.seller.substring(38)}</span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end text-xl font-black text-white">
                          <span className={d.status === 'DISPUTED' ? 'text-red-400 animate-pulse' : (d.status === 'LOCKED' ? 'text-yellow-400' : (d.status === 'RESOLVED' ? 'text-blue-400' : 'text-[#00FFA3]'))}>{d.amount}</span>
                          <span className="text-[10px] ml-1 opacity-50">USDC</span>
                        </div>
                        <div className={`text-[10px] mt-1 inline-block px-2 py-0.5 rounded font-bold border ${getStatusColor(d.status)}`}>
                          {getStatusText(d.status)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
