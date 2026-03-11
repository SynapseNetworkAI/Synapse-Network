import Link from "next/link";

export default function SellPage() {
  return (
    <div className="p-8 mx-auto space-y-6 max-w-6xl">
      <div>
        <h1 className="text-3xl font-bold text-white">Sell Workspace</h1>
        <p className="mt-2 text-gray-400">面向服务方：注册 Service，接收调用并沉淀收益。</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
          <h2 className="text-lg font-semibold text-white">Step 1 · 注册 Provider</h2>
          <p className="mt-2 text-sm text-gray-400">创建服务主体身份，用于服务归属与收益统计。</p>
          <Link href="/dashboard/agents" className="inline-flex px-4 py-2 mt-4 text-sm font-semibold text-black bg-green-500 rounded-lg hover:bg-green-400">
            去 Provider 管理
          </Link>
        </div>

        <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
          <h2 className="text-lg font-semibold text-white">Step 2 · 注册 Service</h2>
          <p className="mt-2 text-sm text-gray-400">配置 `endpoint + unit_price + fee_rate`，开放给买家调用。</p>
          <Link href="/dashboard/services" className="inline-flex px-4 py-2 mt-4 text-sm font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">
            去 Service 管理
          </Link>
        </div>
      </div>

      <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
        <h2 className="text-lg font-semibold text-white">Step 3 · 收益与提现</h2>
        <p className="mt-2 text-sm text-gray-400">调用成功后累积 `seller_net`，在 Settlement 发起提现。</p>
        <div className="flex gap-2 mt-4">
          <Link href="/dashboard" className="inline-flex px-4 py-2 text-sm font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">
            查看收益看板
          </Link>
          <Link href="/dashboard/settlement" className="inline-flex px-4 py-2 text-sm font-semibold text-black bg-yellow-500 rounded-lg hover:bg-yellow-400">
            去 Settlement
          </Link>
        </div>
      </div>
    </div>
  );
}
