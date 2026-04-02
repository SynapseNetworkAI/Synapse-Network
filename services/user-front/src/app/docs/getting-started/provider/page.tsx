"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { CodeBlock } from "../../components/CodeBlock";
import { StepItem, StepTip } from "../../components/StepItem";
import { useActiveSection } from "../../use-active-section";

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
  useActiveSection(PAGE_SECTIONS, "step-auth");

  return (
    <div className="space-y-4">

      {/* Page header */}
      <div className="space-y-3 border-b border-white/[0.06] pb-8 mb-12">
        <div className="flex items-center gap-3">
          <span
            className="text-[10px] font-semibold tracking-[0.14em] uppercase px-2 py-1 rounded"
            style={{ color: ACCENT, background: `${ACCENT}12`, border: `1px solid ${ACCENT}25` }}
          >
            Provider
          </span>
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
            服务提供者引导
          </span>
        </div>
        <h1 className="x-page-title text-white">Provider Quick Start</h1>
        <p className="x-body-copy max-w-[560px]">
          将你的 API 接入 Synapse 结算网络，6 步完成：注册 → 配置端点 → 健康检测 → 接收调用 → 查看收益 → 提现。
          预计耗时 <strong className="text-[#c0c5cc]">15 分钟</strong>。
        </p>

        {/* Step progress */}
        <div className="flex items-center gap-0 mt-4 flex-wrap gap-y-2">
          {["Auth", "Register", "Endpoint", "Health", "Earnings", "Withdraw"].map((s, i) => (
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
      <StepItem num="01" title="连接钱包 · 获取 JWT" accent={ACCENT} id="step-auth">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          Provider 与 Consumer 使用相同的认证机制：EIP-191 钱包签名 + JWT。
          你的钱包地址即为 Provider 身份标识，Provider 收益将提现到此地址。
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
      <StepItem num="02" title="注册服务" accent={ACCENT} id="step-register">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          向 Gateway 注册你的服务端点、定价与标签。
          注册成功后获得全局唯一的{" "}
          <code className="text-[#c0c5cc] font-mono text-[12px]">serviceId</code>，
          消费方通过此 ID 调用你的服务。
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
          <code className="text-[#c0c5cc] font-mono text-[12px]">pricePerCallUsdc</code> 支持小数到 6 位，
          最低 0.000001 USDC（约 0.0001 美分）。可随时通过{" "}
          <code className="text-[#c0c5cc] font-mono text-[12px]">PUT /services/:id</code> 更新定价。
        </StepTip>
      </StepItem>

      {/* ── Step 03: Endpoint Spec ──────────────────────────────── */}
      <StepItem num="03" title="实现端点接口规范" accent={ACCENT} id="step-endpoint">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          Gateway 收到 Consumer 调用后，将请求转发到你注册的端点。
          你的端点需符合以下规范才能正常接收调用。
        </p>

        <div
          className="rounded-xl p-4 space-y-3 mt-2"
          style={{ background: `${ACCENT}06`, border: `1px solid ${ACCENT}14` }}
        >
          <div className="text-[11px] font-semibold tracking-widest text-[#4e535a] uppercase">Gateway 转发格式</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
            {[
              { key: "Method",  val: "POST" },
              { key: "Timeout", val: "30s（超时 Gateway 返回 504）" },
              { key: "Header: X-Synapse-Service-Id",      val: "你的 serviceId" },
              { key: "Header: X-Synapse-Invocation-Id",   val: "本次调用唯一 ID（可用于幂等）" },
              { key: "Header: X-Synapse-Consumer-Wallet", val: "调用方钱包地址" },
              { key: "Body",    val: "Consumer 传入的 payload（JSON）" },
            ].map((r) => (
              <div key={r.key} className="flex gap-2">
                <code className="text-[#6eb6f6] font-mono shrink-0">{r.key}:</code>
                <span className="text-[#71767b]">{r.val}</span>
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
          你的端点响应时间直接影响消费方体验。建议 p95 响应时间控制在 5s 以内，
          避免 Gateway 超时（30s）返回错误给 Consumer。
        </StepTip>
      </StepItem>

      {/* ── Step 04: Health Check ───────────────────────────────── */}
      <StepItem num="04" title="通过健康检测" accent={ACCENT} id="step-health">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          注册服务后，Gateway 会自动 ping 你的端点进行健康检测。
          只有状态为 <code className="text-[#c0c5cc] font-mono text-[12px]">healthy</code>{" "}
          的服务才对消费方可见。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
          {[
            { status: "pending_health_check", color: "#f9c74f", desc: "刚注册，等待首次 ping" },
            { status: "healthy",              color: "#7ff7be", desc: "端点响应正常，对消费方可见" },
            { status: "unhealthy",            color: "#ff6b6b", desc: "端点无响应或返回非 2xx" },
          ].map((s) => (
            <div key={s.status} className="x-panel-muted rounded-xl p-4">
              <span
                className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded border mb-2 font-mono"
                style={{ color: s.color, background: `${s.color}10`, borderColor: `${s.color}30` }}
              >
                {s.status}
              </span>
              <p className="text-[12px] text-[#71767b]">{s.desc}</p>
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
      <StepItem num="05" title="接收调用 · 查看收益" accent={ACCENT} id="step-earnings">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          服务变为 healthy 后，Consumer 即可通过 Gateway 调用。
          每次调用完成，Platform 原子将{" "}
          <code className="text-[#c0c5cc] font-mono text-[12px]">provider_receivable</code>{" "}
          余额增加（扣除平台手续费后的净收益）。
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
          <div className="text-[11px] font-semibold tracking-widest text-[#4e535a] uppercase mb-2">结算分账模型</div>
          <div className="space-y-1.5 text-[12px]">
            {[
              { label: "Consumer 扣费",         val: "pricePerCall × 1",          color: "#ff6b6b" },
              { label: "Provider 收益",          val: "pricePerCall × (1 - 手续费率)", color: ACCENT },
              { label: "Platform Fee",           val: "pricePerCall × 手续费率",  color: "#f9c74f" },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between">
                <span className="text-[#71767b]">{r.label}</span>
                <code className="font-mono text-[11px]" style={{ color: r.color }}>{r.val}</code>
              </div>
            ))}
          </div>
        </div>
      </StepItem>

      {/* ── Step 06: Withdraw ───────────────────────────────────── */}
      <StepItem num="06" title="提现 USDC 至链上钱包" accent={ACCENT} last id="step-withdraw">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          随时发起提现申请，Gateway 触发链上合约将 USDC 转移至你的钱包地址。
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
            <div className="text-[14px] font-semibold text-white mb-1">Provider 引导完成</div>
            <p className="text-[13px] text-[#71767b]">
              你已完成完整的 Provider 链路：身份认证 → 服务注册 → 端点实现 → 健康检测 → 收益管理 → 提现。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <button
            onClick={() => router.push("/docs/api-reference#api-services")}
            className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
            style={{ color: ACCENT, background: `${ACCENT}10`, border: `1px solid ${ACCENT}20` }}
          >
            Services API 完整文档 <ArrowRight size={13} />
          </button>
          <button
            onClick={() => router.push("/docs/concepts")}
            className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg text-[#71767b] hover:text-white transition-colors border border-white/[0.06] hover:border-white/10"
          >
            深入理解结算机制 <ArrowRight size={13} />
          </button>
        </div>
      </StepItem>

      <div className="h-16" />
    </div>
  );
}
