import Link from "next/link";
import { Bot, Check, Copy } from "lucide-react";

type AgentFlowStats = {
  income: number;
  expense: number;
};

type AgentLite = {
  id: string;
  name: string;
  role?: string;
  address: string;
};

type AgentTablePanelProps = {
  ownerAgents: AgentLite[];
  agentFlowStats: Record<string, AgentFlowStats>;
  agentUsdcBalances: Record<string, string>;
  agentEthBalances: Record<string, string>;
  copiedAgentId: string | null;
  onCopyAddress: (agentId: string, address: string) => void;
};

export default function AgentTablePanel({
  ownerAgents,
  agentFlowStats,
  agentUsdcBalances,
  agentEthBalances,
  copiedAgentId,
  onCopyAddress,
}: AgentTablePanelProps) {
  return (
    <div className="border border-gray-800 rounded-xl bg-gray-900/20">
      <div className="px-6 py-4 border-b border-gray-800 bg-black/40">
        <h3 className="text-lg font-semibold text-white">Agents Under This Wallet</h3>
        <p className="mt-1 text-xs text-gray-500">Showing agent address and on-chain balances (USDC / ETH).</p>
      </div>

      {ownerAgents.length === 0 ? (
        <div className="py-20 text-center border border-gray-800 border-dashed rounded-b-xl bg-gray-900/20">
          <Bot className="w-12 h-12 mx-auto mb-4 text-gray-600" />
          <h3 className="text-xl font-medium text-gray-300">No Agents Found</h3>
          <p className="mt-2 text-gray-500">Create your first agent in Agent Management.</p>
          <Link href="/dashboard/agents" className="inline-flex items-center px-4 py-2 mt-4 text-sm font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-600">
            Go to Agent Management
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="text-xs text-gray-400 uppercase bg-gray-900 border-b border-gray-800">
              <tr>
                <th className="px-6 py-3">Agent</th>
                <th className="px-6 py-3">Address</th>
                <th className="px-6 py-3 text-right">Income / Expense</th>
                <th className="px-6 py-3 text-right">USDC Balance</th>
                <th className="px-6 py-3 text-right">ETH Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/80">
              {ownerAgents.map((agent) => (
                <tr key={agent.id} className="transition-colors hover:bg-gray-900/40">
                  <td className="px-6 py-4 text-white">
                    <div className="font-semibold">{agent.name}</div>
                    <div className="text-xs text-gray-500">{agent.role || "seller"}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="inline-flex items-center gap-2 px-3 py-2 font-mono text-xs text-gray-300 border rounded-lg bg-gray-900/50 border-gray-800/50 max-w-[420px]">
                      <span className="truncate">{agent.address}</span>
                      <button
                        onClick={() => onCopyAddress(agent.id, agent.address)}
                        className="text-gray-300 transition-colors hover:text-white"
                        aria-label="Copy agent address"
                      >
                        {copiedAgentId === agent.id ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono text-right">
                    <div className="text-green-400">+{(agentFlowStats[agent.id]?.income || 0).toFixed(2)}</div>
                    <div className="text-red-400">-{(agentFlowStats[agent.id]?.expense || 0).toFixed(2)}</div>
                  </td>
                  <td className="px-6 py-4 font-mono text-right text-green-400">{agentUsdcBalances[agent.id] || "0.00"}</td>
                  <td className="px-6 py-4 font-mono text-right text-blue-400">{agentEthBalances[agent.id] || "0.0000"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
