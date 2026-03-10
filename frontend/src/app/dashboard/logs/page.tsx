"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { UserOperationLog } from "@/types/logger";

export default function LogsPage() {
  const { address } = useAccount();
  const [logs, setLogs] = useState<UserOperationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchLogs() {
      if (!address) {
        setLoading(false);
        return;
      }
      
      try {
        const res = await fetch(`/api/logs?user_address=${address}&limit=100`);
        if (!res.ok) throw new Error("Failed to fetch logs");
        const json = await res.json();
        setLogs(json.data || []);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError(String(err));
        }
      } finally {
        setLoading(false);
      }
    }

    fetchLogs();
  }, [address]);

  return (
    <div className="max-w-6xl p-6 mx-auto">
      <h1 className="mb-6 text-3xl font-bold text-white">Operation Logs</h1>
      
      {!address ? (
        <div className="p-4 text-gray-400 bg-gray-800 rounded">
          Please connect your wallet to view your logs.
        </div>
      ) : loading ? (
        <div className="text-gray-400">Loading logs...</div>
      ) : error ? (
        <div className="text-red-500">Error: {error}</div>
      ) : logs.length === 0 ? (
        <div className="p-4 text-gray-400 bg-gray-800 rounded">
          No operation logs found for this address.
        </div>
      ) : (
        <div className="overflow-x-auto bg-gray-900 border border-gray-800 rounded-lg">
          <table className="w-full text-left text-gray-300 border-collapse">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800/50">
                <th className="p-4 font-semibold">Timestamp</th>
                <th className="p-4 font-semibold">Action Type</th>
                <th className="p-4 font-semibold">Status</th>
                <th className="p-4 font-semibold">Details</th>
                <th className="p-4 font-semibold">Tx Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-800/20 transition-colors">
                  <td className="p-4 whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="p-4">
                    <span className="px-2 py-1 text-xs font-medium tracking-wider text-blue-400 bg-blue-900/30 rounded">
                      {log.action_type}
                    </span>
                  </td>
                  <td className="p-4">
                    {log.status === 'SUCCESS' && <span className="text-green-400">Success</span>}
                    {log.status === 'FAILED' && (
                      <span className="text-red-400" title={log.error_message}>Failed</span>
                    )}
                    {log.status === 'PENDING' && <span className="text-yellow-400">Pending</span>}
                  </td>
                  <td className="p-4">
                    <pre className="text-xs text-gray-500 overflow-hidden max-w-xs text-ellipsis">
                      {JSON.stringify(log.details)}
                    </pre>
                  </td>
                  <td className="p-4 text-xs font-mono">
                    {log.tx_hash ? (
                      <a 
                        href={`https://sepolia.arbiscan.io/tx/${log.tx_hash}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-blue-500 hover:underline"
                        title={log.tx_hash}
                      >
                        {log.tx_hash.slice(0, 10)}...
                      </a>
                    ) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
