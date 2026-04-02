"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { CodeBlock } from "../components/CodeBlock";
import { useActiveSection } from "../use-active-section";

const PAGE_SECTIONS = ["quickstart", "authentication", "deposit", "service-registry"];

export default function GettingStartedPage() {
  const router = useRouter();
  useActiveSection(PAGE_SECTIONS, "quickstart");

  return (
    <div className="space-y-20">

      {/* Page header */}
      <div className="space-y-2 border-b border-white/[0.06] pb-8">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
          Getting Started
        </span>
        <h1 className="x-page-title text-white">Quick Start Guide</h1>
        <p className="x-body-copy max-w-[560px]">
          5 分钟内完成第一笔 AI Agent 服务调用与即时结算。
        </p>
      </div>

      {/* ── Prerequisites ───────────────────────────────────────── */}
      <section id="quickstart" className="space-y-4">
        <h2 className="x-section-title text-white">Quick Start (5 min)</h2>
        <p className="x-body-copy">开始之前你需要准备：</p>
        <ul className="space-y-2">
          {[
            "一个 EVM 钱包（MetaMask / Rabby 均可）",
            "少量测试网 USDC（可从 Faucet 获取）",
            "Node.js 18+ 已安装",
          ].map((item) => (
            <li key={item} className="flex items-start gap-3 text-[13px] text-[#71767b]">
              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#7ff7be] shrink-0" />
              {item}
            </li>
          ))}
        </ul>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
          {[
            { step: "01", title: "连接钱包", desc: "使用 EIP-191 签名认证，获取 JWT 访问令牌" },
            { step: "02", title: "充值 USDC", desc: "链上存款锁仓，链下余额即时到账" },
            { step: "03", title: "调用服务", desc: "凭 Credential 调用 Provider API，余额原子扣减" },
          ].map((s) => (
            <div key={s.step} className="x-panel-muted rounded-2xl p-5">
              <div className="text-[10px] font-semibold tracking-widest text-[#7ff7be] mb-3">{s.step}</div>
              <div className="x-card-title text-white mb-2">{s.title}</div>
              <p className="text-[13px] text-[#71767b] leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Authentication ──────────────────────────────────────── */}
      <section id="authentication" className="space-y-4">
        <h2 className="x-section-title text-white">Authentication</h2>
        <p className="x-body-copy">
          Synapse 使用 <strong className="text-[#c0c5cc]">EIP-191 钱包签名</strong> + JWT 认证。
          无需传统账号密码，连接钱包即可获取 API 访问令牌。
        </p>
        <CodeBlock lang="typescript" code={`
// 1. 获取挑战串
const { challenge } = await fetch(
  '/api/v1/auth/challenge?address=0xYOUR_WALLET'
).then(r => r.json())

// 2. 用钱包签名
const signature = await signer.signMessage(challenge)

// 3. 换取 JWT
const { token } = await fetch('/api/v1/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    wallet_address: '0xYOUR_WALLET',
    message: challenge,
    signature,
  }),
}).then(r => r.json())

// token 有效期 24h，请求时放入 Authorization header
// Authorization: Bearer <token>
        `} />
        <div className="x-panel-muted rounded-xl p-4 flex gap-3">
          <span className="text-[#7ff7be] mt-0.5 shrink-0">💡</span>
          <p className="text-[13px] text-[#71767b] leading-relaxed">
            使用 TypeScript SDK 时，<code className="text-[#c0c5cc] font-mono text-[12px]">client.auth.connectWallet(signer)</code>{" "}
            会自动完成以上三步，无需手动管理 token。
          </p>
        </div>
      </section>

      {/* ── Deposit USDC ────────────────────────────────────────── */}
      <section id="deposit" className="space-y-4">
        <h2 className="x-section-title text-white">Deposit USDC</h2>
        <p className="x-body-copy">
          充值分三步：链上 approve → 调用合约 deposit → 通知网关确认。
          确认后余额立即可用，无需等待额外区块确认。
        </p>
        <CodeBlock lang="typescript" code={`
import { ethers } from 'ethers'

const provider = new ethers.BrowserProvider(window.ethereum)
const signer = await provider.getSigner()

const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer)
const core = new ethers.Contract(SYNAPSE_CORE_ADDRESS, CORE_ABI, signer)

// 1. Approve
await usdc.approve(SYNAPSE_CORE_ADDRESS, ethers.parseUnits('10', 6))

// 2. Deposit on-chain
const tx = await core.deposit(ethers.parseUnits('10', 6))
await tx.wait()

// 3. Register intent (idempotent)
const intentKey = crypto.randomUUID()
await fetch('/api/v1/balance/deposit/intent', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${token}\`,
    'X-Idempotency-Key': intentKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ txHash: tx.hash, amountUsdc: 10 }),
})

// 4. Confirm (Gateway listens on-chain → auto-confirms, but you can also call manually)
await fetch(\`/api/v1/balance/deposit/intents/\${intentId}/confirm\`, {
  method: 'POST',
  headers: { 'Authorization': \`Bearer \${token}\` },
})
        `} />
      </section>

      {/* ── Register a Service ──────────────────────────────────── */}
      <section id="service-registry" className="space-y-4">
        <h2 className="x-section-title text-white">Register a Service (Provider)</h2>
        <p className="x-body-copy">
          作为 Provider，注册你的 API 服务，设置定价，即可开始接收来自 AI Agent 的调用与收益。
        </p>
        <CodeBlock lang="typescript" code={`
// 注册服务
const { service } = await fetch('/api/v1/services', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${token}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'my-ai-api',
    endpoint: 'https://api.example.com/v1/infer',
    pricePerCallUsdc: 0.001,          // 每次调用收费 0.001 USDC
    description: 'Fast LLM inference endpoint',
    tags: ['llm', 'inference'],
  }),
}).then(r => r.json())

console.log(service.serviceId)  // svc_xxxxxxxx
        `} />
        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={() => router.push("/docs/concepts#service-registry")}
            className="inline-flex items-center gap-2 text-[13px] text-[#7ff7be] hover:underline"
          >
            了解 Service Registry 更多细节 <ArrowRight size={13} />
          </button>
        </div>
      </section>

      {/* Next steps */}
      <section className="border-t border-white/[0.06] pt-10">
        <h3 className="x-card-title text-white mb-4">下一步</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { label: "Core Concepts",  desc: "深入理解结算机制与凭证系统",  href: "/docs/concepts" },
            { label: "API Reference",  desc: "完整 REST API 端点文档",       href: "/docs/api-reference" },
            { label: "TypeScript SDK", desc: "SDK 快速集成指南",             href: "/docs/sdk" },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => router.push(item.href)}
              className="x-tile-flat x-tile-flat-hover text-left p-4 rounded-xl flex items-center justify-between gap-3"
            >
              <div>
                <div className="x-card-title text-white mb-1">{item.label}</div>
                <p className="text-[12px] text-[#71767b]">{item.desc}</p>
              </div>
              <ArrowRight size={15} className="text-[#4e535a] shrink-0" />
            </button>
          ))}
        </div>
      </section>

      <div className="h-16" />
    </div>
  );
}
