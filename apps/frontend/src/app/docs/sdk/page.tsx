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
          官方 SDK 封装了认证、充值、服务发现、调用结算全链路，
          Consumer 3 行代码完成 API 调用。
        </p>
      </div>

      {/* ── TypeScript SDK ──────────────────────────────────────── */}
      <section id="sdk-ts" className="space-y-6">
        <div className="flex items-center gap-3">
          <h2 className="x-section-title text-white">TypeScript SDK</h2>
          <StatusBadge status="BETA" />
        </div>
        <p className="x-body-copy">
          Node.js 18+ 与现代浏览器，完整 TypeScript 类型，零运行时依赖（仅 ethers 作 peer dep）。
        </p>

        <CodeBlock lang="bash" code={`npm install @synapse-network/sdk ethers
# or
yarn add @synapse-network/sdk ethers`} />

        {/* Consumer quick-start */}
        <h3 className="text-[15px] font-semibold text-white mt-8">Consumer — 快速开始</h3>
        <p className="text-[13px] text-[#71767b]">
          用钱包认证 → 颁发 Credential → 调用服务，3 步完成全链路。
        </p>
        <CodeBlock lang="typescript" code={`import { Wallet } from 'ethers'
import { SynapseAuth, SynapseClient } from '@synapse-network/sdk'

const GATEWAY = 'https://gateway.synapse.network'

// 1. 钱包认证 — EIP-191 challenge / sign / JWT（自动管理缓存）
const wallet = new Wallet(process.env.PRIVATE_KEY!)
const auth   = SynapseAuth.fromWallet(wallet, { gatewayUrl: GATEWAY })

// 2. 颁发 Agent Credential（绑定消费上限）
const { token } = await auth.issueCredential({
  name:        'my-agent',
  creditLimit: 5.0,   // USDC
  maxCalls:    200,
})

// 3. 创建 Client + 调用服务（自动 quote → invoke → 结算）
const client = new SynapseClient({ credential: token, gatewayUrl: GATEWAY })
const result = await client.invoke(
  'svc_web3_sentiment_index',
  { symbol: 'ETH', chain: 'ethereum' },
)

console.log(result.result)       // { sentiment: "bullish", score: 0.82, ... }
console.log(result.chargedUsdc)  // 0.01
console.log(result.invocationId) // inv_xxxxxxxxxx`} />

        {/* Service discovery */}
        <h3 className="text-[15px] font-semibold text-white mt-8">服务发现</h3>
        <CodeBlock lang="typescript" code={`// 浏览全部可用服务（无需鉴权）
const services = await client.discover({ limit: 20 })
services.forEach(s => {
  console.log(s.serviceId, s.serviceName, s.pricing)
})`} />

        {/* Balance */}
        <h3 className="text-[15px] font-semibold text-white mt-8">查询余额</h3>
        <CodeBlock lang="typescript" code={`const balance = await auth.getBalance()
console.log('可用余额:', balance.consumerAvailableBalance)  // "9.9800"
console.log('Provider收益:', balance.providerReceivable)   // "0.0000"`} />

        {/* Deposit */}
        <h3 className="text-[15px] font-semibold text-white mt-8">充值（链上 → 网关）</h3>
        <CodeBlock lang="typescript" code={`// 1. 先在链上调用 SynapseCore.deposit(amountWei)，获得 txHash
// 2. 登记充值意图到网关
const intentResp = await auth.registerDepositIntent(txHash, 10.0)
// 3. 确认
const intentId = intentResp.intent.id
const eventKey = intentResp.intent.eventKey ?? txHash
await auth.confirmDeposit(intentId, eventKey)`} />

        {/* API table */}
        <h3 className="text-[15px] font-semibold text-white mt-8">API 速查</h3>

        {/* SynapseAuth */}
        <div className="text-[11px] font-semibold tracking-widest text-[#4e535a] uppercase mb-1">SynapseAuth</div>
        <div className="rounded-2xl border border-white/[0.06] overflow-hidden mb-6">
          <table className="w-full text-left">
            <thead><tr className="border-b border-white/[0.06] bg-white/[0.02]">
              <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3">Method</th>
              <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3 hidden md:table-cell">Returns</th>
              <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3 hidden md:table-cell">Description</th>
            </tr></thead>
            <tbody>
              {[
                { m: "SynapseAuth.fromWallet(wallet, opts?)",           r: "SynapseAuth", d: "从 ethers.js Wallet 创建 Auth 实例" },
                { m: "auth.getToken()",                                  r: "Promise<string>", d: "获取 JWT（自动 challenge/sign/verify + 缓存）" },
                { m: "auth.issueCredential(opts?)",                      r: "IssueCredentialResult", d: "颁发 Agent Credential，返回 token + id" },
                { m: "auth.listCredentials()",                           r: "AgentCredential[]", d: "列出当前钱包所有 Credential" },
                { m: "auth.getBalance()",                                r: "BalanceSummary", d: "查询余额（consumer / provider / fee）" },
                { m: "auth.registerDepositIntent(txHash, amount)",       r: "DepositIntentResult", d: "登记链上充值意图" },
                { m: "auth.confirmDeposit(intentId, eventKey)",          r: "{ status }",  d: "确认充值到账" },
              ].map((row) => (
                <tr key={row.m} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3"><code className="text-[12px] font-mono text-[#7ff7be]">{row.m}</code></td>
                  <td className="px-4 py-3 hidden md:table-cell"><code className="text-[11px] font-mono text-[#6eb6f6]">{row.r}</code></td>
                  <td className="px-4 py-3 hidden md:table-cell"><span className="text-[12px] text-[#71767b]">{row.d}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* SynapseClient */}
        <div className="text-[11px] font-semibold tracking-widest text-[#4e535a] uppercase mb-1">SynapseClient</div>
        <div className="rounded-2xl border border-white/[0.06] overflow-hidden">
          <table className="w-full text-left">
            <thead><tr className="border-b border-white/[0.06] bg-white/[0.02]">
              <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3">Method</th>
              <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3 hidden md:table-cell">Returns</th>
              <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3 hidden md:table-cell">Description</th>
            </tr></thead>
            <tbody>
              {[
                { m: "new SynapseClient({ credential, gatewayUrl? })",    r: "SynapseClient", d: "创建 Client（使用已颁发的 Credential token）" },
                { m: "client.discover(opts?)",                            r: "ServiceRecord[]", d: "发现可用服务列表" },
                { m: "client.search(query, opts?)",                       r: "ServiceRecord[]", d: "文本搜索服务" },
                { m: "client.quote(serviceId, opts?)",                    r: "QuoteResult", d: "获取调用报价（第一步）" },
                { m: "client.invoke(serviceId, payload, opts?)",          r: "InvocationResult", d: "完整调用（quote → invoke → 轮询直到结算）" },
                { m: "client.invokeByQuote(quoteId, payload, opts?)",     r: "InvocationResult", d: "用已有 quoteId 直接调用" },
                { m: "client.getInvocation(invocationId)",               r: "InvocationResult", d: "查询调用收据" },
                { m: "client.waitForInvocation(id, opts?)",              r: "InvocationResult", d: "轮询直到终态（SUCCEEDED / SETTLED）" },
              ].map((row) => (
                <tr key={row.m} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3"><code className="text-[12px] font-mono text-[#7ff7be]">{row.m}</code></td>
                  <td className="px-4 py-3 hidden md:table-cell"><code className="text-[11px] font-mono text-[#6eb6f6]">{row.r}</code></td>
                  <td className="px-4 py-3 hidden md:table-cell"><span className="text-[12px] text-[#71767b]">{row.d}</span></td>
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
          <StatusBadge status="STABLE" />
        </div>
        <p className="x-body-copy">
          位于 <code className="text-[#c0c5cc] font-mono text-[12px]">sdk/python/</code>，
          适用于后端 Python 3.11+ 服务，通过 pip 本地安装。
        </p>
        <CodeBlock lang="bash" code={`pip install -e sdk/python`} />
        <CodeBlock lang="python" code={`from synapse_client import SynapseClient

client = SynapseClient(
    api_key="agt_xxxxxxxx",          # X-Credential token
    gateway_url="http://127.0.0.1:8000",
)

# 一行调用（内部 quote → invoke → 轮询）
result = client.call_service(
    service_id="svc_web3_sentiment_index",
    payload={"symbol": "ETH", "chain": "ethereum"},
)
print(result.content)        # {"sentiment": "bullish", ...}
print(result.fee_deducted)   # 0.01`} />
        <p className="text-[13px] text-[#71767b]">
          完整文档见{" "}
          <a href="https://github.com/synapse-network/sdk/tree/main/python" className="text-[#7ff7be] hover:underline">
            sdk/python/README.md
          </a>。
        </p>
      </section>

      <div className="h-16" />
    </div>
  );
}
