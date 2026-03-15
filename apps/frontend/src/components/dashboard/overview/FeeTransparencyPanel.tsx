type FeeTransparencyPanelProps = {
  masterBalance: string;
  sellerNetTotal: number;
  platformFeesTotal: number;
  platformFeeRatePercent: number | null;
};

export default function FeeTransparencyPanel({
  masterBalance,
  sellerNetTotal,
  platformFeesTotal,
  platformFeeRatePercent,
}: FeeTransparencyPanelProps) {
  return (
    <div className="grid grid-cols-1 gap-4 mt-6 md:grid-cols-3">
      <div>
        <p className="text-xs text-gray-500">available_balance</p>
        <p className="mt-1 font-mono text-lg text-yellow-400">${masterBalance}</p>
        <p className="mt-1 text-xs text-gray-500">链上确认完成前不可消费</p>
      </div>
      <div>
        <p className="text-xs text-gray-500">seller_net total</p>
        <p className="mt-1 font-mono text-lg text-green-400">${sellerNetTotal.toFixed(2)}</p>
        <p className="mt-1 text-xs text-gray-500">卖家净收入（扣除平台费后）</p>
      </div>
      <div>
        <p className="mt-2 text-xs text-red-300">
          {platformFeeRatePercent === null
            ? `platform_fee total: $${platformFeesTotal.toFixed(2)}`
            : `effective fee rate: ${platformFeeRatePercent.toFixed(2)}%`}
        </p>
        <p className="mt-1 font-mono text-xs text-gray-300">platform_fee = unit_price × fee_rate</p>
        <p className="mt-1 font-mono text-xs text-gray-300">seller_net = unit_price - platform_fee</p>
      </div>
    </div>
  );
}
