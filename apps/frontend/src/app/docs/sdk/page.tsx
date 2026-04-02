"use client";

import { useRouter } from "next/navigation";
import { StatusBadge } from "../components/StatusBadge";
import { CodeBlock } from "../components/CodeBlock";
import { useActiveSection } from "../use-active-section";

const PAGE_SECTIONS = ["sdk-ts", "sdk-py"];

export default function SdkPage() {
  const router = useRouter();
  useActiveSection(PAGE_SECTIONS, "sdk-ts");

  return (
    <div className="space-y-20">

      {/* Page header */}
      <div className="space-y-2 border-b border-white/[0.06] pb-8">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">SDK</span>
        <div className="flex items-center gap-3">
          <h1 className="x-page-title text-white">SDK Reference</h1>
        </div>
        <p className="x-body-copy max-w-[560px]">
          官方 SDK 封装了认证、充值、调用全流程，最少 3 行代码完成集成。
        </p>
      </div>

      {/* ── TypeScript SDK ──────────────────────────────────────── */}
      <section id="sdk-ts" className="space-y-6">
        <div className="flex items-center gap-3">
          <h2 className="x-section-title text-white">TypeScript SDK</h2>
          <StatusBadge status="BETA" />
        </div>
        <p className="x-body-copy">
          适用于 Node.js 18+ 与浏览器环境，完整 TypeScript 类型支持。
        </p>

        <CodeBlock lang="bash" code={`npm install @synapse-network/sdk
# or
yarn add @synapse-network/sdk`} />

        <h3 className="text-[15px] font-semibold text-white mt-8">Consumer — 调用服务</h3>
        <CodeBlock lang="typescript" code={`
import { SynapseClient } from '@synapse-network/sdk'

const client = new SynapseClient({
  gatewayUrl: 'https://gateway.synapse.network',
})

// 1. 连接钱包（自动处理 challenge / sign / JWT）
await client.auth.connectWallet(signer)

// 2. 颁发 Credential（绑定服务 + 消费上限）
const credential = await client.credentials.issue({
  serviceId: 'svc_target',
  spendingLimitUsdc: 5.00,
})

// 3. 调用服务（自动带 Bearer agentToken）
const result = await client.invoke({
  credentialToken: credential.agentToken,
  serviceId: 'svc_target',
  payload: { prompt: 'Hello AI' },
})

console.log(result.data)         // { result: "..." }
console.log(result.chargedUsdc)  // "0.0011"
        `} />

        <h3 className="text-[15px] font-semibold text-white mt-8">Provider — 注册服务</h3>
        <CodeBlock lang="typescript" code={`
import { SynapseClient } from '@synapse-network/sdk'

const client = new SynapseClient({ gatewayUrl: 'https://gateway.synapse.network' })
await client.auth.connectWallet(providerSigner)

// 注册服务
const service = await client.services.register({
  name: 'my-llm-api',
  endpoint: 'https://api.example.com/v1/infer',
  pricePerCallUsdc: 0.001,
  description: 'Fast LLM inference',
  tags: ['llm', 'inference'],
})

console.log(service.serviceId)  // svc_xxxxxxxx

// 查询收益余额
const balance = await client.balance.get()
console.log(balance.providerReceivableUsdc)  // "9.0000"
        `} />

        <h3 className="text-[15px] font-semibold text-white mt-8">API Reference</h3>
        <div className="rounded-2xl border border-white/[0.06] overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3">Method</th>
                <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3 hidden md:table-cell">Description</th>
              </tr>
            </thead>
            <tbody>
              {[
                { m: "client.auth.connectWallet(signer)",            d: "EIP-191 签名认证，自动管理 JWT" },
                { m: "client.balance.get()",                         d: "获取账户余额（consumer / receivable / fee）" },
                { m: "client.balance.deposit(txHash, amount)",       d: "登记并确认链上充值" },
                { m: "client.services.register(opts)",               d: "注册 Provider 服务" },
                { m: "client.services.discover(filters)",            d: "发现可用服务列表" },
                { m: "client.credentials.issue(opts)",               d: "颁发 Agent Credential" },
                { m: "client.credentials.revoke(credentialId)",      d: "撤销 Credential" },
                { m: "client.invoke(opts)",                          d: "调用服务并即时结算" },
                { m: "client.quotes.get(serviceId)",                 d: "获取调用报价" },
              ].map((row) => (
                <tr
                  key={row.m}
                  className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-4 py-3">
                    <code className="text-[12px] font-mono text-[#7ff7be]">{row.m}</code>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-[12px] text-[#71767b]">{row.d}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Python SDK ──────────────────────────────────────────── */}
      <section id="sdk-py" className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="x-section-title text-white">Python SDK</h2>
          <StatusBadge status="SOON" />
        </div>
        <p className="x-body-copy">Python SDK 正在开发中，预计 Q3 2026 发布。</p>
        <div className="x-panel-muted rounded-xl p-5 border border-dashed border-white/10">
          <p className="text-[13px] text-[#71767b]">
            {"如需提前使用，可直接调用 "}
            <button
              onClick={() => router.push("/docs/api-reference")}
              className="text-[#7ff7be] hover:underline"
            >
              REST API
            </button>
            {"。Python 封装将与 TypeScript SDK 接口保持一致。"}
          </p>
          <CodeBlock lang="python" code={`
# Coming soon — preview API shape:
from synapse_network import SynapseClient

client = SynapseClient(gateway_url="https://gateway.synapse.network")
client.auth.connect_wallet(private_key)

result = client.invoke(
    credential_token="agt_xxxxx",
    service_id="svc_target",
    payload={"prompt": "Hello AI"},
)
print(result.data)           # {"result": "..."}
print(result.charged_usdc)   # "0.0011"
          `} />
        </div>
      </section>

      <div className="h-16" />
    </div>
  );
}
