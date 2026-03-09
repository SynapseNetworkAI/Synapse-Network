type BillingSummaryCardsProps = {
  totalSpend: number;
  totalIncome: number;
  totalPlatformFee: number;
};

export default function BillingSummaryCards({ totalSpend, totalIncome, totalPlatformFee }: BillingSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
        <p className="text-xs text-gray-500">Total Spend</p>
        <p className="mt-2 font-mono text-2xl text-red-400">-${totalSpend.toFixed(4)}</p>
      </div>
      <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
        <p className="text-xs text-gray-500">Total Income (seller_net)</p>
        <p className="mt-2 font-mono text-2xl text-green-400">+${totalIncome.toFixed(4)}</p>
      </div>
      <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
        <p className="text-xs text-gray-500">Platform Fee (observed)</p>
        <p className="mt-2 font-mono text-2xl text-yellow-300">${totalPlatformFee.toFixed(4)}</p>
      </div>
    </div>
  );
}
