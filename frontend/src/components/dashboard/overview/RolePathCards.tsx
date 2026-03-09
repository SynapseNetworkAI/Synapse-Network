import Link from "next/link";

export default function RolePathCards() {
  return (
    <div className="grid grid-cols-1 gap-4 mt-6 lg:grid-cols-2">
      <div className="p-4 border border-gray-800 rounded-lg bg-gray-950/60">
        <h3 className="text-sm font-bold text-white">买家路径（How to Buy）</h3>
        <ol className="mt-3 space-y-2 text-xs text-gray-300 list-decimal list-inside">
          <li>连接钱包并完成签名登录</li>
          <li>充值 USDC（Deposit）</li>
          <li>创建/领取 Agent Credential</li>
          <li>调用服务并查看消费明细</li>
        </ol>
        <div className="flex flex-wrap gap-2 mt-4">
          <Link href="/dashboard/router" className="px-3 py-2 text-xs font-semibold text-black bg-yellow-500 rounded-lg hover:bg-yellow-400">去充值</Link>
          <Link href="/dashboard/credentials" className="px-3 py-2 text-xs font-semibold text-black bg-green-500 rounded-lg hover:bg-green-400">去凭据管理</Link>
          <Link href="#service-market" className="px-3 py-2 text-xs font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">去调用服务</Link>
        </div>
      </div>

      <div className="p-4 border border-gray-800 rounded-lg bg-gray-950/60">
        <h3 className="text-sm font-bold text-white">卖家路径（How to Earn）</h3>
        <ol className="mt-3 space-y-2 text-xs text-gray-300 list-decimal list-inside">
          <li>注册 Agent</li>
          <li>注册 Service（endpoint + unit_price）</li>
          <li>接收网关转发调用</li>
          <li>查看收益并发起提现</li>
        </ol>
        <div className="flex flex-wrap gap-2 mt-4">
          <Link href="/dashboard/agents" className="px-3 py-2 text-xs font-semibold text-black bg-green-500 rounded-lg hover:bg-green-400">去注册 Agent</Link>
          <Link href="/dashboard/services" className="px-3 py-2 text-xs font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">去注册服务</Link>
          <Link href="#event-stream" className="px-3 py-2 text-xs font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">查看调用记录</Link>
        </div>
      </div>
    </div>
  );
}
