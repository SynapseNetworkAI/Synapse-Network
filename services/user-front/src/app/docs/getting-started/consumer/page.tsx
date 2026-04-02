"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { CodeBlock } from "../../components/CodeBlock";
import { StepItem, StepTip } from "../../components/StepItem";
import { useActiveSection } from "../../use-active-section";

const ACCENT = "#7ff7be";

const PAGE_SECTIONS = [
  "step-auth",
  "step-deposit",
  "step-discover",
  "step-credential",
  "step-invoke",
  "step-verify",
];

export default function ConsumerGuidePage() {
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
            Consumer
          </span>
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
            服务调用者引导
          </span>
        </div>
        <h1 className="x-page-title text-white">Consumer Quick Start</h1>
        <p className="x-body-copy max-w-[560px]">
          从零开始，6 步完成：注册 → 充值 → 发现服务 → 创建凭证 → 调用 → 验证结算。
          预计耗时 <strong className="text-[#c0c5cc]">10 分钟</strong>。
        </p>

        {/* Step progress */}
        <div className="flex items-center gap-0 mt-4 flex-wrap gap-y-2">
          {["Auth", "Deposit", "Discover", "Credential", "Invoke", "Verify"].map((s, i) => (
            <div key={s} className="flex items-center">
              <a
                href={`#step-${PAGE_SECTIONS[i].split("-")[1]}`}
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
          Synapse 使用 <strong className="text-[#c0c5cc]">EIP-191 钱包签名</strong> 认证，
          无需注册账号。用你的 EVM 钱包签名一个挑战串，换取 24 小时有效的 JWT Token。
        </p>
        <CodeBlock lang="typescript" code={`
// Step 1 — 获取挑战串
const { challenge } = await fetch(
  \`/api/v1/auth/challenge?address=\${walletAddress}\`
).then(r => r.json())

// Step 2 — 钱包签名（EIP-191）
const signature = await signer.signMessage(challenge)

// Step 3 — 换取 JWT
const { token } = await fetch('/api/v1/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ wallet_address: walletAddress, message: challenge, signature }),
}).then(r => r.json())

// 后续所有请求加入 header：
// Authorization: Bearer <token>
        `} />
        <StepTip accent={ACCENT}>
          使用 TypeScript SDK：{" "}
          <code className="text-[#c0c5cc] font-mono text-[12px]">await client.auth.connectWallet(signer)</code>{" "}
          自动完成以上三步。
        </StepTip>
      </StepItem>

      {/* ── Step 02: Deposit ────────────────────────────────────── */}
      <StepItem num="02" title="充值 USDC" accent={ACCENT} id="step-deposit">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          链上 approve USDC 并调用 SynapseCore 合约存款，然后通知 Gateway 登记充值意图。
          充值后余额立即可用于调用消费。
        </p>
        <CodeBlock lang="typescript" code={`
import { ethers } from 'ethers'

const depositAmount = ethers.parseUnits('10', 6)   // 充值 10 USDC

// 1. 授权合约使用你的 USDC
await usdcContract.approve(SYNAPSE_CORE_ADDRESS, depositAmount)

// 2. 链上存款
const tx = await synapseCore.deposit(depositAmount)
await tx.wait()

// 3. 登记充值意图（带幂等 Key 防重复）
const idempotencyKey = crypto.randomUUID()
const { intentId } = await fetch('/api/v1/balance/deposit/intent', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${token}\`,
    'X-Idempotency-Key': idempotencyKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ txHash: tx.hash, amountUsdc: 10 }),
}).then(r => r.json())

// 4. 确认（Gateway 会自动监听链上事件，也可手动触发）
await fetch(\`/api/v1/balance/deposit/intents/\${intentId}/confirm\`, {
  method: 'POST',
  headers: { 'Authorization': \`Bearer \${token}\` },
})

console.log('✓ 充值完成，余额已到账')
        `} />
        <StepTip accent={ACCENT}>
          充值意图使用 <code className="text-[#c0c5cc] font-mono text-[12px]">X-Idempotency-Key</code>{" "}
          保证网络重试安全，建议使用 UUID v4。
        </StepTip>
      </StepItem>

      {/* ── Step 03: Discover ───────────────────────────────────── */}
      <StepItem num="03" title="发现可用服务" accent={ACCENT} id="step-discover">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          通过 <code className="text-[#c0c5cc] font-mono text-[12px]">/services/discover</code>{" "}
          接口按 tag 或关键词搜索已注册的 Provider 服务，找到目标服务的{" "}
          <code className="text-[#c0c5cc] font-mono text-[12px]">serviceId</code>。
        </p>
        <CodeBlock lang="typescript" code={`
// 发现可用服务（支持 tag、name 过滤）
const { services } = await fetch(
  '/api/v1/services/discover?tag=llm&limit=20',
  { headers: { 'Authorization': \`Bearer \${token}\` } }
).then(r => r.json())

// 响应示例
// [
//   {
//     serviceId: "svc_abc123",
//     name: "fast-llm-inference",
//     pricePerCallUsdc: "0.001",
//     status: "healthy",
//     tags: ["llm", "inference"],
//     provider: "0xProviderWallet..."
//   }
// ]

const targetServiceId = services[0].serviceId
const pricePerCall = services[0].pricePerCallUsdc
console.log(\`找到服务: \${targetServiceId}，每次调用: \${pricePerCall} USDC\`)
        `} />
      </StepItem>

      {/* ── Step 04: Credential ─────────────────────────────────── */}
      <StepItem num="04" title="创建 Agent Credential" accent={ACCENT} id="step-credential">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          Credential 是绑定单个服务的访问凭证，内含消费额度上限。
          用 <code className="text-[#c0c5cc] font-mono text-[12px]">agentToken</code>{" "}
          替代 API Key 调用目标服务，Gateway 根据此 token 自动扣费。
        </p>
        <CodeBlock lang="typescript" code={`
// 为目标服务颁发 Agent Credential
const { agentToken, credentialId } = await fetch(
  '/api/v1/credentials/agent/issue',
  {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${token}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'my-agent-bot',            // 可选标签，便于管理
      creditLimit: 1.00,               // 每日额度上限（USDC），每天重置
      maxCalls: 200,                   // 生命周期调用次数上限（不会每日重置）
      resetInterval: 'daily',          // creditLimit 重置周期
    }),
  }
).then(r => r.json())

console.log('Credential ID:', credentialId)
console.log('Agent Token:', agentToken)   // agt_xxxxx...
// 保存 agentToken，后续调用时使用
        `} />
        <StepTip accent={ACCENT}>
          每个 Credential 独立限额，可为不同 Agent / 场景创建多个 Credential，
          额度耗尽后自动失效，不会超额扣费。
          <br />
          <span className="opacity-80">
            <strong>Daily Budget</strong>（<code>creditLimit</code>）按 <code>resetInterval</code> 每日重置；
            {" "}<strong>Max Calls</strong>（<code>maxCalls</code>）是生命周期累计上限，不会重置。
          </span>
        </StepTip>
      </StepItem>

      {/* ── Step 05: Invoke ─────────────────────────────────────── */}
      <StepItem num="05" title="调用服务 · 即时结算" accent={ACCENT} id="step-invoke">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          使用 <code className="text-[#c0c5cc] font-mono text-[12px]">agentToken</code>{" "}
          作为 Bearer Token 发起调用。Gateway 原子执行：消费者余额↓ · Provider 收益↑ · 平台手续费↑。
        </p>
        <CodeBlock lang="typescript" code={`
// 调用服务（带 agentToken）
const invocationKey = crypto.randomUUID()  // 幂等 key，防止重复扣费

const result = await fetch('/api/v1/agent/invocations', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${agentToken}\`,   // 注意：用 agentToken，不是 JWT
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    serviceId: targetServiceId,
    payload: { prompt: 'Summarize this document...' },
    idempotencyKey: invocationKey,
  }),
}).then(r => r.json())

console.log('调用结果:', result.data)
console.log('本次扣费:', result.chargedUsdc, 'USDC')
// → 调用结果: { summary: "..." }
// → 本次扣费: "0.0010" USDC
        `} />
        <StepTip accent={ACCENT}>
          每次调用都带 <code className="text-[#c0c5cc] font-mono text-[12px]">idempotencyKey</code>，
          网络重试时传相同 key，Gateway 返回缓存结果，不重复扣费。
        </StepTip>
      </StepItem>

      {/* ── Step 06: Verify ─────────────────────────────────────── */}
      <StepItem num="06" title="验证结算结果" accent={ACCENT} last id="step-verify">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          调用完成后，查询余额确认扣费已原子完成。
        </p>
        <CodeBlock lang="typescript" code={`
// 查询当前账户余额
const balance = await fetch('/api/v1/balance', {
  headers: { 'Authorization': \`Bearer \${token}\` },
}).then(r => r.json())

console.log('Consumer 可用余额:', balance.consumerBalanceUsdc)
// 减少了本次调用费用

// 验证本次调用记录
const { invocations } = await fetch(
  '/api/v1/agent/invocations?limit=5',
  { headers: { 'Authorization': \`Bearer \${token}\` } },
).then(r => r.json())

const latest = invocations[0]
console.log('调用状态:', latest.status)        // "settled"
console.log('实际扣费:', latest.chargedUsdc)   // "0.0010"
console.log('结算时间:', latest.settledAt)
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
            <div className="text-[14px] font-semibold text-white mb-1">Consumer 引导完成</div>
            <p className="text-[13px] text-[#71767b]">
              你已完成完整的 Consumer 链路：身份认证 → 充值 → 发现服务 → 凭证管理 → 调用结算。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <button
            onClick={() => router.push("/docs/concepts")}
            className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
            style={{ color: ACCENT, background: `${ACCENT}10`, border: `1px solid ${ACCENT}20` }}
          >
            深入理解结算机制 <ArrowRight size={13} />
          </button>
          <button
            onClick={() => router.push("/docs/sdk")}
            className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg text-[#71767b] hover:text-white transition-colors border border-white/[0.06] hover:border-white/10"
          >
            TypeScript SDK <ArrowRight size={13} />
          </button>
        </div>
      </StepItem>

      <div className="h-16" />
    </div>
  );
}
