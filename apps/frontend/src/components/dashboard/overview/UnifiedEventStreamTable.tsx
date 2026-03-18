import { Activity, ExternalLink } from "lucide-react";
import { UsageLogRecord } from "@/utils/usageApi";
import StatusBadge from "@/components/dashboard/shared/StatusBadge";

type UnifiedEventStreamTableProps = {
  logs: UsageLogRecord[];
};

export default function UnifiedEventStreamTable({ logs }: UnifiedEventStreamTableProps) {
  return (
    <div className="overflow-hidden bg-black border border-gray-800 rounded-xl">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="text-xs text-gray-400 uppercase bg-gray-900 border-b border-gray-800">
            <tr>
              <th className="px-6 py-4 font-medium tracking-wider">Service / Request</th>
              <th className="px-6 py-4 font-medium tracking-wider">Status</th>
              <th className="px-6 py-4 font-medium tracking-wider text-right">Amount (USDC)</th>
              <th className="px-6 py-4 font-medium tracking-wider">Time</th>
              <th className="px-6 py-4 font-medium tracking-wider">Tx Hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/80">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500 bg-gray-900/10">
                  <div className="flex flex-col items-center gap-2">
                    <Activity className="w-8 h-8 opacity-20" />
                    <p>No recent activity</p>
                  </div>
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.request_id} className="transition-colors hover:bg-gray-900/50">
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-white">{log.service_id || "Unknown Service"}</span>
                      <span className="font-mono text-xs text-gray-500">{log.request_id}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={log.status} />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className={`font-mono font-bold ${log.status === 'succeeded' ? 'text-green-400' : 'text-gray-400'}`}>
                      {log.unit_price ? `${log.unit_price.toFixed(4)}` : "0.0000"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-500 text-xs">
                    {log.created_at ? new Date(log.created_at * 1000).toLocaleString() : "Pending"}
                  </td>
                  <td className="px-6 py-4">
                    {log.tx_hash ? (
                      <a 
                        href={`https://basescan.org/tx/${log.tx_hash}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-400 transition-colors"
                      >
                        <span className="font-mono">{`${log.tx_hash.substring(0, 6)}...${log.tx_hash.substring(log.tx_hash.length - 4)}`}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-gray-700 font-mono text-xs">N/A</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
