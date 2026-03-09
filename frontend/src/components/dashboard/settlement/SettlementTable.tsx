import type { SettlementEvent } from "@/hooks/useSettlementData";
import StatusBadge from "@/components/dashboard/shared/StatusBadge";

type SettlementTableProps = {
  loading: boolean;
  rows: SettlementEvent[];
};

export default function SettlementTable({ loading, rows }: SettlementTableProps) {
  return (
    <div className="overflow-hidden border border-gray-800 rounded-xl bg-black/40">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="text-xs text-gray-400 uppercase bg-gray-900 border-b border-gray-800">
            <tr>
              <th className="px-4 py-3">Service ID</th>
              <th className="px-4 py-3">status</th>
              <th className="px-4 py-3 text-right">seller_gross</th>
              <th className="px-4 py-3 text-right">platform_fee</th>
              <th className="px-4 py-3 text-right">seller_net</th>
              <th className="px-4 py-3">request_id (tx)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/80">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  Loading settlement events...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No settlement rows yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.txHash}-${row.blockNumber}`} className="transition-colors hover:bg-gray-900/30">
                  <td className="px-4 py-3 text-blue-300">{row.serviceId}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-right text-white">{row.gross.toFixed(4)}</td>
                  <td className="px-4 py-3 font-mono text-right text-yellow-300">{row.platform_fee.toFixed(4)}</td>
                  <td className="px-4 py-3 font-mono text-right text-green-300">{row.seller_net.toFixed(4)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{`${row.txHash.slice(0, 8)}...${row.txHash.slice(-6)}`}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
