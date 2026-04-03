"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { CodeBlock } from "../../components/CodeBlock";
import { StepItem, StepTip } from "../../components/StepItem";
import { useActiveSection } from "../../use-active-section";
import { useDocsPageNav } from "../../use-docs-page-nav";

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
  const { t, tList } = useLanguage();
  useActiveSection(PAGE_SECTIONS, "step-auth");
  const progressLabels = tList("docsPage.consumerProgress");
  const stepTitles = tList("docsPage.consumerStepTitles");
  const stepBodies = tList("docsPage.consumerStepBodies");
  const stepTips = tList("docsPage.consumerStepTips");
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
            {t("docsPage.consumerEyebrow")}
          </span>
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
            {t("docsPage.consumerPageEyebrow")}
          </span>
        </div>
        <h1 className="x-page-title text-white">{t("docsPage.consumerTitle")}</h1>
        <p className="x-body-copy max-w-[560px]">
          {t("docsPage.consumerDescription")}
        </p>

        {/* Step progress */}
        <div className="flex items-center gap-0 mt-4 flex-wrap gap-y-2">
          {progressLabels.map((s, i) => (
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
      <StepItem num="01" title={stepTitles[0] ?? ""} accent={ACCENT} id="step-auth">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[0]}
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
          {stepTips[0]}{" "}
          <code className="text-[#c0c5cc] font-mono text-[12px]">await client.auth.connectWallet(signer)</code>{" "}
        </StepTip>
      </StepItem>

      {/* ── Step 02: Deposit ────────────────────────────────────── */}
      <StepItem num="02" title={stepTitles[1] ?? ""} accent={ACCENT} id="step-deposit">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[1]}
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
          {stepTips[1]}{" "}
          <code className="text-[#c0c5cc] font-mono text-[12px]">X-Idempotency-Key</code>.
        </StepTip>
      </StepItem>

      {/* ── Step 03: Discover ───────────────────────────────────── */}
      <StepItem num="03" title={stepTitles[2] ?? ""} accent={ACCENT} id="step-discover">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[2]}
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
      <StepItem num="04" title={stepTitles[3] ?? ""} accent={ACCENT} id="step-credential">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[3]}
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
          {stepTips[3]}
        </StepTip>
      </StepItem>

      {/* ── Step 05: Invoke ─────────────────────────────────────── */}
      <StepItem num="05" title={stepTitles[4] ?? ""} accent={ACCENT} id="step-invoke">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[4]}
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
          {stepTips[4]}
        </StepTip>
      </StepItem>

      {/* ── Step 06: Verify ─────────────────────────────────────── */}
      <StepItem num="06" title={stepTitles[5] ?? ""} accent={ACCENT} last id="step-verify">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[5]}
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
            <div className="text-[14px] font-semibold text-white mb-1">{t("docsPage.consumerCompletionTitle")}</div>
            <p className="text-[13px] text-[#71767b]">
              {t("docsPage.consumerCompletionDescription")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <button
            onClick={() => router.push("/docs/concepts")}
            className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
            style={{ color: ACCENT, background: `${ACCENT}10`, border: `1px solid ${ACCENT}20` }}
          >
            {t("docsPage.consumerDeepDiveCta")} <ArrowRight size={13} />
          </button>
          <button
            onClick={() => router.push("/docs/sdk/typescript")}
            className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg text-[#71767b] hover:text-white transition-colors border border-white/[0.06] hover:border-white/10"
          >
            {t("docsPage.consumerSdkCta")} <ArrowRight size={13} />
          </button>
        </div>
      </StepItem>

      <div className="h-16" />
    </div>
  );
}
