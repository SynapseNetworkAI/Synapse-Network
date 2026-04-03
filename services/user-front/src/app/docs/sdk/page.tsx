"use client";

import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { StatusBadge } from "../components/StatusBadge";
import { CodeBlock } from "../components/CodeBlock";
import { useActiveSection } from "../use-active-section";

const PAGE_SECTIONS = ["sdk-ts", "sdk-py"];

export default function SdkPage() {
  const router = useRouter();
  const { t, tList } = useLanguage();
  useActiveSection(PAGE_SECTIONS, "sdk-ts");
  const authMethods = tList("docsPage.sdkAuthMethods");
  const authReturns = tList("docsPage.sdkAuthReturns");
  const authDescriptions = tList("docsPage.sdkAuthDescriptions");
  const clientMethods = tList("docsPage.sdkClientMethods");
  const clientReturns = tList("docsPage.sdkClientReturns");
  const clientDescriptions = tList("docsPage.sdkClientDescriptions");

  return (
    <div className="space-y-20">

      {/* Page header */}
      <div className="space-y-2 border-b border-white/[0.06] pb-8">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">{t("docsPage.sdkEyebrow")}</span>
        <div className="flex items-center gap-3">
          <h1 className="x-page-title text-white">{t("docsPage.sdkTitle")}</h1>
        </div>
        <p className="x-body-copy max-w-[560px]">
          {t("docsPage.sdkDescription")}
        </p>
      </div>

      {/* ── TypeScript SDK ──────────────────────────────────────── */}
      <section id="sdk-ts" className="space-y-6">
        <div className="flex items-center gap-3">
          <h2 className="x-section-title text-white">{t("docsPage.sdkTsTitle")}</h2>
          <StatusBadge status="BETA" />
        </div>
        <p className="x-body-copy">
          {t("docsPage.sdkTsDescription")}
        </p>

        <CodeBlock lang="bash" code={`npm install @synapse-network/sdk ethers
# or
yarn add @synapse-network/sdk ethers`} />

        {/* Consumer quick-start */}
        <h3 className="text-[15px] font-semibold text-white mt-8">{t("docsPage.sdkConsumerQuickStartTitle")}</h3>
        <p className="text-[13px] text-[#71767b]">
          {t("docsPage.sdkConsumerQuickStartDescription")}
        </p>
        <CodeBlock lang="typescript" code={`import { Wallet } from 'ethers'
import { SynapseAuth, SynapseClient } from '@synapse-network/sdk'

const GATEWAY = 'https://gateway.synapse.network'

// 1. 钱包认证 — EIP-191 challenge / sign / JWT（自动管理缓存）
const wallet = new Wallet(process.env.PRIVATE_KEY!)
const auth   = SynapseAuth.fromWallet(wallet, { gatewayUrl: GATEWAY })

// 2. 颁发 Agent Credential（per-agent 预算窗口；不设则余额耗尽前无限调用）
const { token } = await auth.issueCredential({
  name:          'my-agent',
  creditLimit:   5.0,       // USDC — 滚动窗口上限
  resetInterval: 'daily',   // 每日重置（hourly / weekly / monthly / never）
  maxCalls:      200,       // 生命周期调用次数上限
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
        <h3 className="text-[15px] font-semibold text-white mt-8">{t("docsPage.sdkDiscoveryTitle")}</h3>
        <CodeBlock lang="typescript" code={`// 浏览全部可用服务（无需鉴权）
const services = await client.discover({ limit: 20 })
services.forEach(s => {
  console.log(s.serviceId, s.serviceName, s.pricing)
})`} />

        {/* Balance */}
        <h3 className="text-[15px] font-semibold text-white mt-8">{t("docsPage.sdkBalanceTitle")}</h3>
        <CodeBlock lang="typescript" code={`const balance = await auth.getBalance()
console.log('可用余额:', balance.consumerAvailableBalance)  // "9.9800"
console.log('Provider收益:', balance.providerReceivable)   // "0.0000"`} />

        {/* Deposit */}
        <h3 className="text-[15px] font-semibold text-white mt-8">{t("docsPage.sdkDepositTitle")}</h3>
        <CodeBlock lang="typescript" code={`// 1. 先在链上调用 SynapseCore.deposit(amountWei)，获得 txHash
// 2. 登记充值意图到网关
const intentResp = await auth.registerDepositIntent(txHash, 10.0)
// 3. 确认
const intentId = intentResp.intent.id
const eventKey = intentResp.intent.eventKey ?? txHash
await auth.confirmDeposit(intentId, eventKey)`} />

        {/* API table */}
        <h3 className="text-[15px] font-semibold text-white mt-8">{t("docsPage.sdkApiCheatsheetTitle")}</h3>

        {/* SynapseAuth */}
        <div className="text-[11px] font-semibold tracking-widest text-[#4e535a] uppercase mb-1">SynapseAuth</div>
        <div className="rounded-2xl border border-white/[0.06] overflow-hidden mb-6">
          <table className="w-full text-left">
            <thead><tr className="border-b border-white/[0.06] bg-white/[0.02]">
              <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3">{t("docsPage.sdkMethod")}</th>
              <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3 hidden md:table-cell">{t("docsPage.sdkReturns")}</th>
              <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3 hidden md:table-cell">{t("docsPage.sdkDescriptionLabel")}</th>
            </tr></thead>
            <tbody>
              {authMethods.map((method, index) => (
                <tr key={method} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3"><code className="text-[12px] font-mono text-[#7ff7be]">{method}</code></td>
                  <td className="px-4 py-3 hidden md:table-cell"><code className="text-[11px] font-mono text-[#6eb6f6]">{authReturns[index] ?? ""}</code></td>
                  <td className="px-4 py-3 hidden md:table-cell"><span className="text-[12px] text-[#71767b]">{authDescriptions[index] ?? ""}</span></td>
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
              <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3">{t("docsPage.sdkMethod")}</th>
              <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3 hidden md:table-cell">{t("docsPage.sdkReturns")}</th>
              <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3 hidden md:table-cell">{t("docsPage.sdkDescriptionLabel")}</th>
            </tr></thead>
            <tbody>
              {clientMethods.map((method, index) => (
                <tr key={method} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3"><code className="text-[12px] font-mono text-[#7ff7be]">{method}</code></td>
                  <td className="px-4 py-3 hidden md:table-cell"><code className="text-[11px] font-mono text-[#6eb6f6]">{clientReturns[index] ?? ""}</code></td>
                  <td className="px-4 py-3 hidden md:table-cell"><span className="text-[12px] text-[#71767b]">{clientDescriptions[index] ?? ""}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Python SDK ──────────────────────────────────────────── */}
      <section id="sdk-py" className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="x-section-title text-white">{t("docsPage.sdkPyTitle")}</h2>
          <StatusBadge status="STABLE" />
        </div>
        <p className="x-body-copy">
          {t("docsPage.sdkPyDescription")}{" "}
          <code className="text-[#c0c5cc] font-mono text-[12px]">sdk/python/</code>
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
          {t("docsPage.sdkPyReadmeLead")}{" "}
          <a href="https://github.com/synapse-network/sdk/tree/main/python" className="text-[#7ff7be] hover:underline">
            {t("docsPage.sdkPyReadmeCta")}
          </a>。
        </p>
      </section>

      <div className="h-16" />
    </div>
  );
}
