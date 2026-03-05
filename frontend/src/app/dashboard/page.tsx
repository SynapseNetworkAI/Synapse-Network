"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Bot, Key, Activity } from "lucide-react";
import { agentStore, AgentIdentity } from "@/utils/agentStore";

export default function Dashboard() {
  const [agents, setAgents] = useState<AgentIdentity[]>([]);

  useEffect(() => {
    setAgents(agentStore.getAgents());
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8 border-b border-gray-800 pb-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center">
            <Bot className="mr-3 text-green-400" />
            Agent Fleet Management
          </h1>
          <p className="text-gray-400 mt-2">Manage your autonomous AI entities and their on-chain wallets</p>
        </div>
        <Link href="/dashboard/agents/create">
          <button className="bg-green-500 hover:bg-green-600 text-black font-bold py-2 px-6 rounded-lg flex items-center transition-colors">
            <Plus className="mr-2 h-5 w-5" />
            Create Agent
          </button>
        </Link>
      </div>

      {agents.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-gray-800 rounded-xl bg-gray-900/20">
          <Bot className="mx-auto h-12 w-12 text-gray-600 mb-4" />
          <h3 className="text-xl font-medium text-gray-300">No Agents Deployed</h3>
          <p className="mt-2 text-gray-500">Create your first AI agent to start processing autonomous transactions.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map(agent => (
            <div key={agent.id} className="border border-green-900/30 bg-black p-6 rounded-xl relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-green-500 to-emerald-800"></div>
              
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-xl font-bold text-green-400">{agent.name}</h3>
                <span className="bg-gray-800 text-xs px-2 py-1 rounded text-gray-300 border border-gray-700">
                  {agent.role}
                </span>
              </div>
              
              <div className="space-y-3 mb-6">
                <div>
                  <label className="text-xs text-gray-500 uppercase font-bold tracking-wider">Agent Address</label>
                  <div className="font-mono text-sm text-gray-300 truncate bg-gray-900 p-2 rounded mt-1 border border-gray-800">
                    {agent.address}
                  </div>
                </div>
                
                <div className="flex items-center text-sm text-gray-400">
                  <Activity className="w-4 h-4 mr-2 text-green-500/70" />
                  Status: <span className="text-green-400 ml-1">Active</span>
                </div>
              </div>
              
              <div className="flex gap-3">
                <Link href={`/dashboard/agents/${agent.id}`} className="flex-1">
                  <button className="w-full bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-lg text-sm font-medium transition-colors border border-gray-700 flex items-center justify-center">
                    <Key className="w-4 h-4 mr-2" />
                    Manage & Setup
                  </button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}