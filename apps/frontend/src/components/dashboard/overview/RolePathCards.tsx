import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function RolePathCards() {
  return (
    <div className="grid grid-cols-1 gap-4 mt-6 lg:grid-cols-2">
      <div className="p-4 border border-gray-800 rounded-lg bg-gray-950/60">
        <h3 className="text-sm font-bold text-white">Owner / Agent 接入</h3>
        <ol className="mt-3 space-y-2 text-xs text-gray-300 list-decimal list-inside h-24">
          <li>连接钱包并完成签名登录</li>
          <li>充值 USDC（Deposit to Vault）</li>
          <li>签发 Agent Credential</li>
          <li>高速调用服务并查看消费明细</li>
        </ol>
        <div className="flex flex-wrap gap-2 mt-2">
          <Link href="/dashboard/agents" className="flex items-center px-4 py-2.5 text-xs font-bold text-black bg-blue-500 rounded-lg hover:bg-blue-400 transition-colors">
            点击进入 Agent Workspace
            <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
        </div>
      </div>

      <div className="p-4 border border-gray-800 rounded-lg bg-gray-950/60">
        <h3 className="text-sm font-bold text-white">Provider 接入</h3>
        <ol className="mt-3 space-y-2 text-xs text-gray-300 list-decimal list-inside h-24">
          <li>阅读 Provider 接入文档</li>
          <li>注册 Service 路由与单次价格</li>
          <li>接收网关转发的高频调用</li>
          <li>查看账单收益并发起免 Gas 提现</li>
        </ol>
        <div className="flex flex-wrap gap-2 mt-2">
          <Link href="/dashboard/console" className="flex items-center px-4 py-2.5 text-xs font-bold text-black bg-green-500 rounded-lg hover:bg-green-400 transition-colors">
            点击进入 Developer Console
            <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
        </div>
      </div>
    </div>
  );
}
