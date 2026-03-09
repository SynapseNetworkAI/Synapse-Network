import { Activity } from "lucide-react";

type ServicePaidRow = {
  buyer: string;
  seller: string;
  serviceId: string;
  amount: number;
  fee: number;
  txHash: string;
  blockNumber: number;
  timestamp: number;
};

type EventStreamTableProps = {
  paidEvents: ServicePaidRow[];
};

export default function EventStreamTable({ paidEvents }: EventStreamTableProps) {
  return (
    <>
      <div id="event-stream" className="mt-12 mb-6">
        <h2 className="flex items-center gap-2 pl-3 text-xl font-bold text-white border-l-4 border-blue-500">
          <Activity className="w-5 h-5 text-blue-500" /> ServicePaid Event Stream
        </h2>
      </div>
      <div className="overflow-hidden bg-black border border-gray-800 rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="text-xs text-gray-400 uppercase bg-gray-900 border-b border-gray-800">
              <tr>
                <th className="px-6 py-4 font-medium tracking-wider">Service ID</th>
                <th className="px-6 py-4 font-medium tracking-wider">Buyer</th>
                <th className="px-6 py-4 font-medium tracking-wider text-right">Amount (USDC)</th>
                <th className="px-6 py-4 font-medium tracking-wider text-right">Fee (USDC)</th>
                <th className="px-6 py-4 font-medium tracking-wider">Tx Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/80">
              {paidEvents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500 bg-gray-900/10">No ServicePaid events found for current seller address.</td>
                </tr>
              ) : (
                paidEvents.slice(0, 20).map((event) => (
                  <tr key={`${event.txHash}-${event.blockNumber}`} className="transition-colors hover:bg-gray-900/50">
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2 py-1 text-xs text-blue-300 border rounded bg-blue-500/10 border-blue-500/30">
                        {event.serviceId}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-block w-40 font-mono text-xs text-gray-500 truncate">{event.buyer}</span>
                    </td>
                    <td className="px-6 py-4 font-mono font-bold text-right text-green-400">+{event.amount.toFixed(4)}</td>
                    <td className="px-6 py-4 font-mono font-bold text-right text-red-400">-{event.fee.toFixed(4)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="font-mono text-xs text-blue-500">
                        {`${event.txHash.substring(0, 8)}...${event.txHash.substring(event.txHash.length - 6)}`}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
