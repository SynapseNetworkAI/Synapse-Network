export default function CapabilityCards() {
  return (
    <div className="grid grid-cols-1 gap-4 mt-6 md:grid-cols-2 lg:grid-cols-4">
      <div className="p-4 border border-gray-800 rounded-lg bg-gray-950/60">
        <h3 className="text-sm font-semibold text-white">Deposit 预充值</h3>
        <p className="mt-2 text-xs leading-5 text-gray-400">链上充值到 Vault，转为离链可消费余额。</p>
      </div>
      <div className="p-4 border border-gray-800 rounded-lg bg-gray-950/60">
        <h3 className="text-sm font-semibold text-white">Credential 授信</h3>
        <p className="mt-2 text-xs leading-5 text-gray-400">签发 API Key 和 Credential 管理调用身份、额度与限流。</p>
      </div>
      <div className="p-4 border border-gray-800 rounded-lg bg-gray-950/60">
        <h3 className="text-sm font-semibold text-white">Gateway 扣费转发</h3>
        <p className="mt-2 text-xs leading-5 text-gray-400">网关原子扣费、转发请求，失败自动回滚。</p>
      </div>
      <div className="p-4 border border-gray-800 rounded-lg bg-gray-950/60">
        <h3 className="text-sm font-semibold text-white">Settlement 结算提现</h3>
        <p className="mt-2 text-xs leading-5 text-gray-400">卖家可提现收益，买家可退款剩余余额。</p>
      </div>
    </div>
  );
}
