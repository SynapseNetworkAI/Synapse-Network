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
          <li>进入 Provider Workspace</li>
          <li>配置 Access Keys 与健康检查</li>
          <li>发布 API Service 并接收网关调用</li>
          <li>在 Settlements / Revenue Analytics 查看收益</li>
        </ol>
        <div className="flex flex-wrap gap-2 mt-2">
          <Link href="/provider/sell" className="flex items-center px-4 py-2.5 text-xs font-bold text-black bg-green-500 rounded-lg hover:bg-green-400 transition-colors">
            点击进入 Provider Workspace
            <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
        </div>
      </div>
    </div>
  );
}
