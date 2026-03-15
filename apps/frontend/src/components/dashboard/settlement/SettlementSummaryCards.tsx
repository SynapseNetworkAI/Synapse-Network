type SettlementSummaryCardsProps = {
  sellerReceivable: number;
  sellerGross: number;
  platformFee: number;
  walletUsdc: number;
};

export default function SettlementSummaryCards({
  sellerReceivable,
  sellerGross,
  platformFee,
  walletUsdc,
}: SettlementSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
        <p className="text-xs text-gray-500">seller_receivable (estimated)</p>
        <p className="mt-2 font-mono text-2xl text-green-400">${sellerReceivable.toFixed(4)}</p>
      </div>
      <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
        <p className="text-xs text-gray-500">seller_gross</p>
        <p className="mt-2 font-mono text-2xl text-white">${sellerGross.toFixed(4)}</p>
      </div>
      <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
        <p className="text-xs text-gray-500">platform_fee</p>
        <p className="mt-2 font-mono text-2xl text-yellow-300">${platformFee.toFixed(4)}</p>
      </div>
      <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
        <p className="text-xs text-gray-500">buyer_refundable (wallet snapshot)</p>
        <p className="mt-2 font-mono text-2xl text-yellow-300">${walletUsdc.toFixed(4)}</p>
      </div>
    </div>
  );
}
