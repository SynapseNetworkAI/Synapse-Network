import Link from "next/link";

export default function BuyPage() {
  return (
    <div className="p-8 mx-auto space-y-6 max-w-6xl">
      <div>
        <h1 className="text-3xl font-bold text-white">Buy Workspace</h1>
        <p className="mt-2 text-gray-400">面向调用方：充值、签发凭据、调用卖家服务、查看消费流水。</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
          <h2 className="text-lg font-semibold text-white">Step 1 · 充值担保</h2>
          <p className="mt-2 text-sm text-gray-400">先完成钱包登录与充值，链上确认后进入可消费余额。</p>
          <Link href="/dashboard/router" className="inline-flex px-4 py-2 mt-4 text-sm font-semibold text-black bg-yellow-500 rounded-lg hover:bg-yellow-400">
            去充值配置
          </Link>
        </div>

        <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
          <h2 className="text-lg font-semibold text-white">Step 2 · 凭据与调用</h2>
          <p className="mt-2 text-sm text-gray-400">签发 `X-Agent-Credential` 后，通过网关发起付费调用。</p>
          <div className="flex gap-2 mt-4">
            <Link href="/dashboard/credentials" className="inline-flex px-4 py-2 text-sm font-semibold text-black bg-green-500 rounded-lg hover:bg-green-400">
              凭据管理
            </Link>
            <Link href="/dashboard" className="inline-flex px-4 py-2 text-sm font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">
              去调用服务
            </Link>
          </div>
        </div>
      </div>

      <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
        <h2 className="text-lg font-semibold text-white">Step 3 · 消费对账</h2>
        <p className="mt-2 text-sm text-gray-400">在 Billing 查看按 `request_id` 聚合的费用拆分（unit_price / platform_fee / seller_net）。</p>
        <Link href="/dashboard/billing" className="inline-flex px-4 py-2 mt-4 text-sm font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">
          打开 Billing
        </Link>
      </div>
    </div>
  );
}
