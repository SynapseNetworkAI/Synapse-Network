"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { CodeBlock } from "../../components/CodeBlock";
import { StepItem, StepTip } from "../../components/StepItem";
import { useActiveSection } from "../../use-active-section";
import { useDocsPageNav } from "../../use-docs-page-nav";

const ACCENT = "#6eb6f6";

const PAGE_SECTIONS = [
  "step-auth",
  "step-register",
  "step-endpoint",
  "step-health",
  "step-earnings",
  "step-withdraw",
];

export default function ProviderGuidePage() {
  const router = useRouter();
  const { t, tList } = useLanguage();
  useActiveSection(PAGE_SECTIONS, "step-auth");
  const progressLabels = tList("docsPage.providerProgress");
  const stepTitles = tList("docsPage.providerStepTitles");
  const stepBodies = tList("docsPage.providerStepBodies");
  const stepTips = tList("docsPage.providerStepTips");
  const endpointKeys = tList("docsPage.providerEndpointGridKeys");
  const endpointValues = tList("docsPage.providerEndpointGridValues");
  const healthStatuses = tList("docsPage.providerHealthStatuses");
  const healthDescriptions = tList("docsPage.providerHealthDescriptions");
  const settlementRows = tList("docsPage.providerSettlementModelRows");
  const settlementValues = tList("docsPage.providerSettlementModelValues");
  useDocsPageNav(PAGE_SECTIONS.map((id, index) => ({
    id,
    label: stepTitles[index] ?? id,
  })));

  return (
    <div className="space-y-4">

      {/* Page header */}
      <div className="space-y-3 border-b border-white/[0.06] pb-8 mb-12">
        <div className="flex items-center gap-3">
          <span
            className="text-[10px] font-semibold tracking-[0.14em] uppercase px-2 py-1 rounded"
            style={{ color: ACCENT, background: `${ACCENT}12`, border: `1px solid ${ACCENT}25` }}
          >
            {t("docsPage.providerEyebrow")}
          </span>
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
            {t("docsPage.providerPageEyebrow")}
          </span>
        </div>
        <h1 className="x-page-title text-white">{t("docsPage.providerTitle")}</h1>
        <p className="x-body-copy max-w-[560px]">
          {t("docsPage.providerDescription")}
        </p>

        {/* Step progress */}
        <div className="flex items-center gap-0 mt-4 flex-wrap gap-y-2">
          {progressLabels.map((s, i) => (
            <div key={s} className="flex items-center">
              <a
                href={`#${PAGE_SECTIONS[i]}`}
                className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={{ color: ACCENT, background: `${ACCENT}10` }}
              >
                <span
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                  style={{ background: `${ACCENT}20`, color: ACCENT }}
                >
                  {i + 1}
                </span>
                {s}
              </a>
              {i < 5 && <span className="text-[#3a3f45] text-[12px] px-1">→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Step 01: Auth ───────────────────────────────────────── */}
      <StepItem num="01" title={stepTitles[0] ?? ""} accent={ACCENT} id="step-auth">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[0]}
        </p>
        <CodeBlock lang="typescript" code={`
const { challenge } = await fetch(
  \`/api/v1/auth/challenge?address=\${providerWallet}\`
).then(r => r.json())

const signature = await signer.signMessage(challenge)

const { token } = await fetch('/api/v1/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    wallet_address: providerWallet,
    message: challenge,
    signature,
  }),
}).then(r => r.json())

// token 有效期 24h
        `} />
      </StepItem>

      {/* ── Step 02: Register ───────────────────────────────────── */}
      <StepItem num="02" title={stepTitles[1] ?? ""} accent={ACCENT} id="step-register">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[1]}
        </p>
        <CodeBlock lang="typescript" code={`
const { service } = await fetch('/api/v1/services', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${token}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'my-llm-api',                          // 服务名称（全局唯一建议）
    endpoint: 'https://api.example.com/v1/infer', // 你的 API 端点
    pricePerCallUsdc: '0.001',                   // 每次调用收费（USDC）
    description: 'Fast LLM inference — 200ms p95',
    tags: ['llm', 'inference', 'text'],
  }),
}).then(r => r.json())

console.log('服务 ID:', service.serviceId)   // svc_xxxxxxxx
console.log('服务状态:', service.status)     // "pending_health_check"
        `} />
        <StepTip accent={ACCENT}>
          {stepTips[1]}
        </StepTip>
      </StepItem>

      {/* ── Step 03: Endpoint Spec ──────────────────────────────── */}
      <StepItem num="03" title={stepTitles[2] ?? ""} accent={ACCENT} id="step-endpoint">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[2]}
        </p>

        <div
          className="rounded-xl p-4 space-y-3 mt-2"
          style={{ background: `${ACCENT}06`, border: `1px solid ${ACCENT}14` }}
        >
          <div className="text-[11px] font-semibold tracking-widest text-[#4e535a] uppercase">{t("docsPage.providerStepTitles.2", undefined, "Gateway forwarding contract")}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
            {endpointKeys.map((key, index) => (
              <div key={key} className="flex gap-2">
                <code className="text-[#6eb6f6] font-mono shrink-0">{key}:</code>
                <span className="text-[#71767b]">{endpointValues[index] ?? ""}</span>
              </div>
            ))}
          </div>
        </div>

        <CodeBlock lang="typescript" code={`
// Express.js 示例
import express from 'express'
const app = express()
app.use(express.json())

app.post('/v1/infer', async (req, res) => {
  const serviceId     = req.headers['x-synapse-service-id']
  const invocationId  = req.headers['x-synapse-invocation-id']
  const consumerWallet= req.headers['x-synapse-consumer-wallet']
  const { prompt }    = req.body   // Consumer payload

  // ⚠️ 必须在 30s 内响应，否则 Gateway 超时
  const result = await callYourLLM(prompt)

  // 返回 JSON，Gateway 转发给 Consumer
  res.json({ result })
})

app.listen(3000)
        `} />
        <CodeBlock lang="python" code={`
# FastAPI 示例
from fastapi import FastAPI, Header, Request

app = FastAPI()

@app.post("/v1/infer")
async def infer(
    request: Request,
    x_synapse_service_id: str = Header(None),
    x_synapse_invocation_id: str = Header(None),
):
    body = await request.json()
    prompt = body.get("prompt")

    result = await call_your_llm(prompt)
    return {"result": result}
        `} />
        <StepTip accent={ACCENT}>
          {stepTips[2]}
        </StepTip>
      </StepItem>

      {/* ── Step 04: Health Check ───────────────────────────────── */}
      <StepItem num="04" title={stepTitles[3] ?? ""} accent={ACCENT} id="step-health">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[3]}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
          {healthStatuses.map((status, index) => (
            <div key={status} className="x-panel-muted rounded-xl p-4">
              <span
                className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded border mb-2 font-mono"
                style={{
                  color: index === 0 ? "#f9c74f" : index === 1 ? "#7ff7be" : "#ff6b6b",
                  background: `${index === 0 ? "#f9c74f" : index === 1 ? "#7ff7be" : "#ff6b6b"}10`,
                  borderColor: `${index === 0 ? "#f9c74f" : index === 1 ? "#7ff7be" : "#ff6b6b"}30`,
                }}
              >
                {status}
              </span>
              <p className="text-[12px] text-[#71767b]">{healthDescriptions[index] ?? ""}</p>
            </div>
          ))}
        </div>

        <CodeBlock lang="typescript" code={`
// 轮询服务状态，等待 healthy
const waitForHealthy = async (serviceId: string, token: string) => {
  for (let i = 0; i < 10; i++) {
    const res = await fetch(\`/api/v1/services/\${serviceId}\`, {
      headers: { Authorization: \`Bearer \${token}\` }
    }).then(r => r.json())

    if (res.status === 'healthy') {
      console.log('✓ 服务健康，已对消费方可见')
      return
    }
    console.log(\`等待健康检测... (\${i + 1}/10)\`)
    await new Promise(r => setTimeout(r, 3000))
  }
  throw new Error('健康检测超时，请检查端点是否可公网访问')
}

await waitForHealthy(service.serviceId, token)
        `} />
      </StepItem>

      {/* ── Step 05: View Earnings ──────────────────────────────── */}
      <StepItem num="05" title={stepTitles[4] ?? ""} accent={ACCENT} id="step-earnings">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[4]}
        </p>
        <CodeBlock lang="typescript" code={`
// 查询收益余额
const balance = await fetch('/api/v1/balance', {
  headers: { Authorization: \`Bearer \${token}\` }
}).then(r => r.json())

console.log('Provider 可提现余额:', balance.providerReceivableUsdc)
// → "9.0000"（假设已有 10 次调用，每次 0.001 USDC，平台手续费 10%）

// 查看调用记录（作为 Provider 收到的调用）
const { invocations } = await fetch(
  '/api/v1/agent/invocations?role=provider&limit=20',
  { headers: { Authorization: \`Bearer \${token}\` } }
).then(r => r.json())

invocations.forEach(inv => {
  console.log(\`调用 \${inv.id}: \${inv.providerEarnedUsdc} USDC | \${inv.settledAt}\`)
})
        `} />
        <div
          className="rounded-xl p-4 mt-2"
          style={{ background: `${ACCENT}06`, border: `1px solid ${ACCENT}14` }}
        >
          <div className="text-[11px] font-semibold tracking-widest text-[#4e535a] uppercase mb-2">{t("docsPage.providerSettlementModelLabel")}</div>
          <div className="space-y-1.5 text-[12px]">
            {settlementRows.map((label, index) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-[#71767b]">{label}</span>
                <code className="font-mono text-[11px]" style={{ color: index === 0 ? "#ff6b6b" : index === 1 ? ACCENT : "#f9c74f" }}>{settlementValues[index] ?? ""}</code>
              </div>
            ))}
          </div>
        </div>
      </StepItem>

      {/* ── Step 06: Withdraw ───────────────────────────────────── */}
      <StepItem num="06" title={stepTitles[5] ?? ""} accent={ACCENT} last id="step-withdraw">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[5]}
        </p>
        <CodeBlock lang="typescript" code={`
// 查询当前可提现余额
const { providerReceivableUsdc } = await fetch('/api/v1/balance', {
  headers: { Authorization: \`Bearer \${token}\` }
}).then(r => r.json())

console.log('可提现:', providerReceivableUsdc, 'USDC')

// 发起提现（全额提现）
const withdrawal = await fetch('/api/v1/balance/withdraw', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${token}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    amountUsdc: providerReceivableUsdc,  // 提现金额
    toAddress: providerWallet,           // 到账地址（默认为钱包地址）
  }),
}).then(r => r.json())

console.log('提现交易 Hash:', withdrawal.txHash)
// ─── SynapseCore.withdraw() 执行 ─── USDC 到账 ✓
        `} />

        {/* Completion badge */}
        <div
          className="mt-6 rounded-2xl p-5 flex items-center gap-4"
          style={{ background: `${ACCENT}08`, border: `1px solid ${ACCENT}20` }}
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-[18px] shrink-0"
            style={{ background: `${ACCENT}18` }}
          >
            ✓
          </div>
          <div>
            <div className="text-[14px] font-semibold text-white mb-1">{t("docsPage.providerCompletionTitle")}</div>
            <p className="text-[13px] text-[#71767b]">
              {t("docsPage.providerCompletionDescription")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <button
            onClick={() => router.push("/docs/api-reference#api-services")}
            className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
            style={{ color: ACCENT, background: `${ACCENT}10`, border: `1px solid ${ACCENT}20` }}
          >
            {t("docsPage.providerServicesApiCta")} <ArrowRight size={13} />
          </button>
          <button
            onClick={() => router.push("/docs/concepts")}
            className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg text-[#71767b] hover:text-white transition-colors border border-white/[0.06] hover:border-white/10"
          >
            {t("docsPage.providerDeepDiveCta")} <ArrowRight size={13} />
          </button>
        </div>
      </StepItem>

      <div className="h-16" />
    </div>
  );
}
