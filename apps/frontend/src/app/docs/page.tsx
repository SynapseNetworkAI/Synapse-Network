"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Zap, Radio, Package, BookOpen, Code2, FileText,
  GitBranch, ChevronDown, ChevronRight, Copy, Check,
  ExternalLink, ArrowRight, Search, Terminal, Layers,
  Shield, Activity, Webhook, Database,
} from "lucide-react";

// ─── Navigation tree ──────────────────────────────────────────────────────────

const NAV_TREE = [
  {
    id: "overview",
    label: "OVERVIEW",
    items: [
      { id: "introduction", label: "Introduction", href: "#introduction" },
      { id: "architecture", label: "Architecture", href: "#architecture" },
    ],
  },
  {
    id: "getting-started",
    label: "GETTING STARTED",
    items: [
      { id: "quickstart", label: "Quick Start (5 min)", href: "#quickstart" },
      { id: "authentication", label: "Authentication", href: "#authentication" },
      { id: "deposit", label: "Deposit USDC", href: "#deposit" },
    ],
  },
  {
    id: "core-concepts",
    label: "CORE CONCEPTS",
    items: [
      { id: "settlement", label: "How Settlement Works", href: "#settlement" },
      { id: "service-registry", label: "Service Registry", href: "#service-registry" },
      { id: "credentials", label: "Agent Credentials", href: "#credentials" },
      { id: "idempotency", label: "Idempotency", href: "#idempotency" },
    ],
  },
  {
    id: "api-reference",
    label: "API REFERENCE",
    items: [
      { id: "api-auth", label: "Auth", href: "#api-auth" },
      { id: "api-balance", label: "Balance", href: "#api-balance" },
      { id: "api-services", label: "Services", href: "#api-services" },
      { id: "api-invocations", label: "Agent Invocations", href: "#api-invocations" },
      { id: "api-credentials", label: "Credentials", href: "#api-credentials" },
    ],
  },
  {
    id: "sdk",
    label: "SDK",
    items: [
      { id: "sdk-ts", label: "TypeScript SDK", href: "#sdk-ts" },
      { id: "sdk-py", label: "Python SDK", href: "#sdk-py", soon: true },
    ],
  },
  {
    id: "contracts",
    label: "SMART CONTRACTS",
    items: [
      { id: "contract-core", label: "SynapseCore", href: "#contract-core" },
      { id: "contract-usdc", label: "MockUSDC (Testnet)", href: "#contract-usdc" },
    ],
  },
  {
    id: "resources",
    label: "RESOURCES",
    items: [
      { id: "changelog", label: "Changelog", href: "#changelog" },
      { id: "status", label: "Status", href: "#status" },
      { id: "community", label: "Community", href: "#community" },
    ],
  },
];

// ─── Products grid content ────────────────────────────────────────────────────

const PRODUCTS = [
  {
    icon: Terminal,
    title: "Gateway API",
    desc: "结算网关核心 REST API。处理认证、计费与链路路由，亚毫秒级 overhead。",
    status: "GA",
    href: "#api-reference",
  },
  {
    icon: Layers,
    title: "Service Registry",
    desc: "Provider 服务注册、定价配置、健康检测与公开发现接口。",
    status: "GA",
    href: "#service-registry",
  },
  {
    icon: Shield,
    title: "Agent Credentials",
    desc: "消费方凭证颁发、额度控制、生命周期管理与撤销流程。",
    status: "GA",
    href: "#credentials",
  },
  {
    icon: Activity,
    title: "Settlement Engine",
    desc: "链下原子扣费 + 分账，链上 USDC 可提现。gas-free 高频结算。",
    status: "GA",
    href: "#settlement",
  },
  {
    icon: Database,
    title: "Deposit Indexer",
    desc: "链上充值事件监听、自动确认、idempotent 意图管理。",
    status: "GA",
    href: "#deposit",
  },
  {
    icon: Webhook,
    title: "Webhooks",
    desc: "调用完成回调与事件推送 ——  Provider 可订阅 settled 事件。",
    status: "SOON",
    href: "#",
  },
];

// ─── API routes quick reference ───────────────────────────────────────────────

const API_ROUTES = [
  { method: "GET",  path: "/api/v1/auth/challenge",                    desc: "获取 EIP-191 签名挑战串" },
  { method: "POST", path: "/api/v1/auth/verify",                       desc: "验证签名，返回 JWT" },
  { method: "GET",  path: "/api/v1/balance",                           desc: "查询当前账户余额摘要" },
  { method: "POST", path: "/api/v1/balance/deposit/intent",            desc: "登记充值意图（需 X-Idempotency-Key）" },
  { method: "POST", path: "/api/v1/balance/deposit/intents/:id/confirm", desc: "确认链上充值事件" },
  { method: "POST", path: "/api/v1/services",                          desc: "Provider 注册服务" },
  { method: "GET",  path: "/api/v1/services/discover",                 desc: "消费方发现可用服务" },
  { method: "POST", path: "/api/v1/credentials/agent/issue",           desc: "颁发 Agent Credential" },
  { method: "POST", path: "/api/v1/agent/quotes",                      desc: "获取服务调用报价" },
  { method: "POST", path: "/api/v1/agent/invocations",                 desc: "执行 Agent 服务调用并即时结算" },
];

const METHOD_COLOR: Record<string, string> = {
  GET:  "text-[#7ff7be] bg-[#7ff7be]/10 border-[#7ff7be]/20",
  POST: "text-[#6eb6f6] bg-[#6eb6f6]/10 border-[#6eb6f6]/20",
  PUT:  "text-[#f9c74f] bg-[#f9c74f]/10 border-[#f9c74f]/20",
  DELETE: "text-red-400 bg-red-400/10 border-red-400/20",
};

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: Readonly<{ status: string }>) {
  if (status === "GA")
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-700 tracking-widest uppercase border border-[#7ff7be]/25 bg-[#7ff7be]/10 text-[#7ff7be]">
        GA
      </span>
    );
  if (status === "BETA")
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-700 tracking-widest uppercase border border-[#6eb6f6]/25 bg-[#6eb6f6]/10 text-[#6eb6f6]">
        BETA
      </span>
    );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-700 tracking-widest uppercase border border-white/10 bg-white/5 text-[#9a9fa6]">
      SOON
    </span>
  );
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: Readonly<{ text: string }>) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="absolute top-2.5 right-2.5 p-1.5 rounded-md text-[#71767b] hover:text-white hover:bg-white/8 transition-colors"
      aria-label="Copy code"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

// ─── Code block ───────────────────────────────────────────────────────────────

function CodeBlock({ code, lang = "bash" }: Readonly<{ code: string; lang?: string }>) {
  return (
    <div className="relative mt-4 rounded-xl overflow-hidden border border-white/6 bg-[#0a0b0d]">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5">
        <span className="x-overline-label text-[#4e535a] font-mono tracking-widest uppercase">{lang}</span>
      </div>
      <pre className="p-4 text-[13px] font-mono text-[#c9d1d9] leading-relaxed overflow-x-auto whitespace-pre">
        {code.trim()}
      </pre>
      <CopyButton text={code.trim()} />
    </div>
  );
}

// ─── Left sidebar ─────────────────────────────────────────────────────────────

function Sidebar({
  activeSection,
  onNavigate,
}: Readonly<{
  activeSection: string;
  onNavigate: (id: string, href: string) => void;
}>) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <aside
      data-testid="docs-sidebar"
      className="hidden lg:flex flex-col w-[240px] shrink-0 sticky top-[56px] h-[calc(100vh-56px)] overflow-y-auto border-r border-white/[0.045]"
      style={{ background: "#08090b" }}
    >
      {/* Search stub */}
      <div className="px-4 py-3 border-b border-white/[0.045]">
        <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[#4e535a] hover:border-white/10 transition-colors">
          <Search size={13} />
          <span className="x-meta-label text-[#4e535a]">Search docs...</span>
          <span className="ml-auto x-overline-label text-[#2e3338] border border-white/10 px-1.5 py-0.5 rounded">⌘K</span>
        </button>
      </div>

      <nav className="py-4 px-2 space-y-1" aria-label="Docs navigation">
        {NAV_TREE.map((section) => {
          const isOpen = collapsed[section.id] !== true;
          return (
            <div key={section.id}>
              <button
                onClick={() => toggle(section.id)}
                className="w-full flex items-center justify-between px-2 py-1.5 text-left"
              >
                <span className="x-overline-label text-[#4e535a] tracking-[0.12em] font-semibold">
                  {section.label}
                </span>
                {isOpen ? (
                  <ChevronDown size={12} className="text-[#3a3f45]" />
                ) : (
                  <ChevronRight size={12} className="text-[#3a3f45]" />
                )}
              </button>
              {isOpen && (
                <div className="mt-0.5 mb-1 space-y-0.5">
                  {section.items.map((item) => {
                    const isActive = activeSection === item.id;
                    return (
                      <button
                        key={item.id}
                        data-nav-id={item.id}
                        onClick={() => onNavigate(item.id, item.href)}
                        className={[
                          "w-full flex items-center gap-2 px-3 py-[7px] rounded-lg text-left transition-colors",
                          isActive
                            ? "bg-[#7ff7be]/[0.06] text-white border-l-[3px] border-[#7ff7be] rounded-l-none pl-[calc(12px-3px)]"
                            : "text-[#71767b] hover:text-[#c0c5cc] hover:bg-white/[0.03]",
                        ].join(" ")}
                      >
                        <span className="x-meta-label">{item.label}</span>
                        {(item as { soon?: boolean }).soon && (
                          <span className="ml-auto x-overline-label text-[#4e535a] border border-white/10 px-1 rounded">
                            SOON
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

export default function DocsPage() {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState("introduction");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // IntersectionObserver for sidebar highlight
  useEffect(() => {
    const allIds = NAV_TREE.flatMap((s) => s.items.map((i) => i.id));
    const observers: IntersectionObserver[] = [];

    allIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      sectionRefs.current[id] = el;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveSection(id);
        },
        { rootMargin: "-30% 0px -60% 0px", threshold: 0 }
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const handleNavigate = (_id: string, href: string) => {
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleQuickStart = () => router.push("/dashboard");

  return (
    <div className="flex min-h-screen" style={{ paddingTop: "56px" }}>
      <Sidebar activeSection={activeSection} onNavigate={handleNavigate} />

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-x-hidden">
        <div className="max-w-[900px] mx-auto px-6 lg:px-10 py-12 space-y-20">

          {/* ── Hero ──────────────────────────────────────────────── */}
          <section id="introduction" data-testid="docs-hero" className="space-y-6">
            <div className="flex items-center gap-3">
              <StatusBadge status="BETA" />
              <span className="x-overline-label text-[#4e535a] tracking-[0.14em]">DEVELOPER DOCUMENTATION</span>
            </div>

            <h1 className="x-page-title text-white" style={{ maxWidth: 600 }}>
              Synapse Developer Platform
            </h1>

            <p className="x-body-copy max-w-[560px]">
              AI Agent 经济基础设施 ——{" "}
              <span className="text-[#c0c5cc]">链上充值担保 · 链下网关秒扣 · 凭票免 Gas 提现。</span>
              {" "}让 AI 之间（M2M）以毫秒级延迟、零 Gas 成本完成 API 服务的购买与结算。
            </p>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                data-testid="cta-quickstart"
                onClick={handleQuickStart}
                className="x-button-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold x-action-label"
              >
                Quick Start
                <ArrowRight size={15} />
              </button>
              <button
                data-testid="cta-api-ref"
                onClick={() => handleNavigate("api-auth", "#api-auth")}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold x-action-label text-white border border-white/[0.1] hover:border-white/20 hover:bg-white/[0.04] transition-colors"
              >
                API Reference
              </button>
            </div>

            {/* Settlement flow diagram (text-art) */}
            <div className="mt-2 p-5 rounded-2xl border border-white/[0.06] bg-[#0a0b0d] font-mono text-[12px] text-[#71767b] leading-relaxed">
              <span className="text-[#7ff7be]">Consumer</span>
              {" /deposit USDC → "}
              <span className="text-[#6eb6f6]">Gateway</span>
              {" /quote → /invoke → "}
              <span className="text-[#f9c74f]">Provider API</span>
              {" → settled "}
              <span className="text-[#7ff7be]">✓</span>
              <br />
              <span className="text-[#3a3f45]">                  ↓ platform fee accrued · provider receivable ++</span>
            </div>
          </section>

          {/* ── Quick Start Cards ──────────────────────────────────── */}
          <section id="quickstart" data-testid="quickstart-section">
            <div className="flex items-center gap-3 mb-6">
              <span className="x-overline-label text-[#4e535a] tracking-[0.14em] uppercase">Get Started</span>
              <div className="flex-1 h-px bg-white/[0.045]" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="quickstart-cards">
              {[
                {
                  icon: Zap,
                  tag: "5 min",
                  title: "Use an Agent Service",
                  desc: "充值 USDC → 创建 Credential → 调用 API → 余额即时扣减",
                  href: "#authentication",
                  color: "#7ff7be",
                },
                {
                  icon: Radio,
                  tag: "10 min",
                  title: "Register a Service",
                  desc: "注册服务 → 配置 pricing → 上线 → 实时接收收益",
                  href: "#service-registry",
                  color: "#6eb6f6",
                },
                {
                  icon: Package,
                  tag: "NEW",
                  title: "TypeScript SDK",
                  desc: "npm install → import SynapseClient → 3 行代码完成调用",
                  href: "#sdk-ts",
                  color: "#f9c74f",
                },
              ].map((card) => (
                <button
                  key={card.title}
                  onClick={() => handleNavigate("", card.href)}
                  className="x-tile-flat x-tile-flat-hover text-left p-5 rounded-2xl group block"
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center mb-4"
                    style={{
                      background: `${card.color}18`,
                      boxShadow: `inset 0 0 0 1px ${card.color}28`,
                    }}
                  >
                    <card.icon size={17} style={{ color: card.color }} />
                  </div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="x-card-title text-white">{card.title}</span>
                    <span
                      className="x-overline-label shrink-0 px-2 py-0.5 rounded border"
                      style={{
                        color: card.color,
                        borderColor: `${card.color}28`,
                        background: `${card.color}10`,
                      }}
                    >
                      {card.tag}
                    </span>
                  </div>
                  <p className="x-body-copy text-[13px]">{card.desc}</p>
                  <div className="mt-4 flex items-center gap-1 text-[12px] font-medium" style={{ color: card.color }}>
                    <span>Read guide</span>
                    <ArrowRight size={12} />
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* ── Architecture ──────────────────────────────────────── */}
          <section id="architecture" className="space-y-4">
            <h2 className="x-section-title text-white">Architecture</h2>
            <p className="x-body-copy">
              Synapse 采用<strong className="text-[#c0c5cc]">混合结算模型</strong>：链上 USDC 存入合约作担保，
              链下网关完成毫秒级扣费与分账，Provider 凭收益凭证随时提现至链上地址。
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
              {[
                { num: "01", label: "链上担保", desc: "SynapseCore 合约接收 USDC 存款，资金锁仓作为消费配额" },
                { num: "02", label: "链下结算", desc: "Gateway 实时扣费 + 分账：consumer↓ · provider↑ · platform_fee↑" },
                { num: "03", label: "凭证提现", desc: "Provider 凭 receivable 余额发起提现，合约转账 USDC 至钱包" },
              ].map((step) => (
                <div key={step.num} className="x-panel-muted rounded-2xl p-5">
                  <div className="x-overline-label text-[#7ff7be] tracking-widest mb-3">{step.num}</div>
                  <div className="x-card-title text-white mb-2">{step.label}</div>
                  <p className="text-[13px] text-[#71767b] leading-relaxed">{step.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── Products Grid ─────────────────────────────────────── */}
          <section id="service-registry">
            <div className="flex items-center gap-3 mb-6">
              <span className="x-overline-label text-[#4e535a] tracking-[0.14em] uppercase">Platform Products</span>
              <div className="flex-1 h-px bg-white/[0.045]" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="products-grid">
              {PRODUCTS.map((p) => (
                <button
                  key={p.title}
                  onClick={() => handleNavigate("", p.href)}
                  className="x-tile-flat x-tile-flat-hover text-left p-5 rounded-2xl group"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.04] border border-white/[0.06]">
                      <p.icon size={15} className="text-[#71767b]" />
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="x-card-title text-white mb-1.5">{p.title}</div>
                  <p className="text-[13px] text-[#71767b] leading-relaxed">{p.desc}</p>
                </button>
              ))}
            </div>
          </section>

          {/* ── Authentication guide ────────────────────────────────── */}
          <section id="authentication" className="space-y-4">
            <h2 className="x-section-title text-white">Authentication</h2>
            <p className="x-body-copy">
              Synapse 使用 <strong className="text-[#c0c5cc]">EIP-191 钱包签名</strong> + JWT 认证。
              无需传统账号密码，连接钱包即可获取 API 访问令牌。
            </p>
            <CodeBlock lang="typescript" code={`
// 1. 获取挑战串
const { challenge } = await fetch('/api/v1/auth/challenge?address=0xYOUR_WALLET').then(r => r.json())

// 2. 用钱包签名
const signature = await signer.signMessage(challenge)

// 3. 换取 JWT
const { token } = await fetch('/api/v1/auth/verify', {
  method: 'POST',
  body: JSON.stringify({ wallet_address: '0xYOUR_WALLET', message: challenge, signature })
}).then(r => r.json())
`} />
          </section>

          {/* ── Deposit ──────────────────────────────────────────────── */}
          <section id="deposit" className="space-y-4">
            <h2 className="x-section-title text-white">Deposit USDC</h2>
            <p className="x-body-copy">
              充值分三步：链上 approve → 调用合约 deposit → 通知网关确认。
              确认后余额立即可用，无需等待区块确认数量。
            </p>
            <CodeBlock lang="typescript" code={`
// 1. Approve USDC to SynapseCore
await usdcContract.approve(SYNAPSE_CORE_ADDRESS, amount)

// 2. Deposit on-chain
const tx = await synapseCore.deposit(amount)
await tx.wait()

// 3. Register intent (idempotent)
await fetch('/api/v1/balance/deposit/intent', {
  method: 'POST',
  headers: { 'Authorization': \`Bearer \${token}\`, 'X-Idempotency-Key': uuid() },
  body: JSON.stringify({ txHash: tx.hash, amountUsdc: 10 })
})

// 4. Confirm
await fetch(\`/api/v1/balance/deposit/intents/\${intentId}/confirm\`, { method: 'POST', ... })
`} />
          </section>

          {/* ── Settlement ───────────────────────────────────────────── */}
          <section id="settlement" className="space-y-4">
            <h2 className="x-section-title text-white">How Settlement Works</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { label: "充值 (Deposit)", desc: "USDC 锁入 SynapseCore 合约，Gateway 记录 consumer 可用余额" },
                { label: "报价 (Quote)", desc: "Consumer 请求报价，Gateway 返回本次调用预计花费 USDC" },
                { label: "调用 (Invoke)", desc: "原子扣费：consumer↓ · provider receivable↑ · platform fee↑" },
                { label: "提现 (Withdraw)", desc: "Provider 发起提现，合约按 receivable 余额转账 USDC" },
              ].map((step) => (
                <div key={step.label} className="x-panel-muted rounded-xl p-4">
                  <div className="x-card-title text-[#c0c5cc] mb-1.5">{step.label}</div>
                  <p className="text-[13px] text-[#71767b]">{step.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── API Reference table ───────────────────────────────────── */}
          <section id="api-auth" data-testid="api-reference-section" className="space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="x-section-title text-white">API Reference</h2>
              <StatusBadge status="GA" />
            </div>
            <p className="x-body-copy">
              所有路由挂载在 <code className="x-meta-label text-[#7ff7be] bg-[#7ff7be]/8 px-1.5 py-0.5 rounded font-mono">/api</code> 前缀下，
              Base URL: <code className="x-meta-label text-[#c0c5cc] font-mono">https://gateway.synapse.network</code>
            </p>
            <div className="rounded-2xl border border-white/[0.06] overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                    <th className="x-overline-label text-[#4e535a] tracking-widest px-4 py-3 font-semibold w-[80px]">Method</th>
                    <th className="x-overline-label text-[#4e535a] tracking-widest px-4 py-3 font-semibold">Path</th>
                    <th className="x-overline-label text-[#4e535a] tracking-widest px-4 py-3 font-semibold hidden md:table-cell">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {API_ROUTES.map((route) => (
                    <tr
                      key={route.path}
                      className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className={`inline-block x-overline-label px-2 py-0.5 rounded border font-mono tracking-widest ${METHOD_COLOR[route.method] ?? ""}`}>
                          {route.method}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-[12px] font-mono text-[#c0c5cc]">{route.path}</code>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="x-meta-label text-[#71767b]">{route.desc}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Credentials guide ────────────────────────────────────── */}
          <section id="credentials" className="space-y-4">
            <h2 className="x-section-title text-white">Agent Credentials</h2>
            <p className="x-body-copy">
              Credential 是消费方用于调用 Provider 服务的<strong className="text-[#c0c5cc]">访问令牌</strong>。
              每个 Credential 绑定一个服务、一个消费额度，可随时撤销。
            </p>
            <CodeBlock lang="http" code={`
POST /api/v1/credentials/agent/issue
Authorization: Bearer <JWT>

{
  "serviceId": "svc_your_target_service",
  "label": "my-agent-bot",
  "spendingLimitUsdc": 5.00
}

→ 200 { "agentToken": "agt_xxxxx...", "credentialId": "cred_uuid" }
`} />
          </section>

          {/* ── SDK ───────────────────────────────────────────────────── */}
          <section id="sdk-ts" className="space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="x-section-title text-white">TypeScript SDK</h2>
              <StatusBadge status="BETA" />
            </div>
            <p className="x-body-copy">
              官方 TypeScript SDK 封装了完整的认证、充值、调用流程，3 行代码完成 Agent 服务调用。
            </p>
            <CodeBlock lang="bash" code="npm install @synapse-network/sdk" />
            <CodeBlock lang="typescript" code={`
import { SynapseClient } from '@synapse-network/sdk'

const client = new SynapseClient({ gatewayUrl: 'https://gateway.synapse.network' })
await client.auth.connectWallet(signer)

// Invoke a service with a credential
const result = await client.invoke({
  credentialToken: 'agt_xxxxx...',
  serviceId: 'svc_target',
  payload: { prompt: 'Hello AI' },
})

console.log(result.data)  // { result: "..." }
console.log(result.chargedUsdc)  // 0.0011
`} />
          </section>

          {/* ── Smart Contracts ───────────────────────────────────────── */}
          <section id="contract-core" className="space-y-4">
            <h2 className="x-section-title text-white">Smart Contracts</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="x-panel-muted rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <GitBranch size={15} className="text-[#7ff7be]" />
                  <span className="x-card-title text-white">SynapseCore</span>
                </div>
                <p className="text-[13px] text-[#71767b]">主结算合约，处理 deposit / withdraw。部署于 Hardhat Localhost + Arbitrum Sepolia。</p>
                <code className="block text-[11px] font-mono text-[#7ff7be]/70 break-all">
                  0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82
                </code>
              </div>
              <div className="x-panel-muted rounded-2xl p-5 space-y-3" id="contract-usdc">
                <div className="flex items-center gap-2">
                  <FileText size={15} className="text-[#6eb6f6]" />
                  <span className="x-card-title text-white">MockUSDC</span>
                  <StatusBadge status="BETA" />
                </div>
                <p className="text-[13px] text-[#71767b]">测试用 ERC-20（18 decimals），可 mint 供本地链测试。生产环境使用真实 USDC。</p>
                <code className="block text-[11px] font-mono text-[#6eb6f6]/70 break-all">
                  0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0
                </code>
              </div>
            </div>
          </section>

          {/* ── Idempotency ───────────────────────────────────────────── */}
          <section id="idempotency" className="space-y-4">
            <h2 className="x-section-title text-white">Idempotency</h2>
            <p className="x-body-copy">
              所有写操作（充值意图、调用）均支持 idempotency key。
              网络重试时传入相同 key，Gateway 自动返回缓存结果，不重复扣费。
            </p>
            <div className="x-panel-muted rounded-xl p-4 flex gap-3">
              <span className="text-[#7ff7be] mt-0.5 shrink-0">💡</span>
              <p className="text-[13px] text-[#71767b] leading-relaxed">
                充值意图使用 <code className="text-[#c0c5cc] font-mono text-[12px]">X-Idempotency-Key</code> 请求头（min 16 字符），
                调用使用请求体中的 <code className="text-[#c0c5cc] font-mono text-[12px]">idempotencyKey</code> 字段。
                建议使用 UUID v4。
              </p>
            </div>
          </section>

          {/* ── Resources footer ──────────────────────────────────────── */}
          <section id="changelog" className="space-y-6">
            <div className="flex items-center gap-3">
              <span className="x-overline-label text-[#4e535a] tracking-[0.14em] uppercase">Resources</span>
              <div className="flex-1 h-px bg-white/[0.045]" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4" id="status">
              {[
                {
                  icon: BookOpen,
                  title: "Changelog",
                  desc: "版本更新记录与 breaking changes 说明",
                  href: "/blog",
                  external: false,
                },
                {
                  icon: Activity,
                  title: "Status Page",
                  desc: "Gateway、链上合约与 RPC 节点实时状态",
                  href: "#",
                  external: false,
                  soon: true,
                },
                {
                  icon: Code2,
                  title: "GitHub",
                  desc: "开源合约、SDK 与集成示例",
                  href: "https://github.com/synapse-network",
                  external: true,
                },
              ].map((res) => (
                <div key={res.title} className="x-tile-flat rounded-2xl p-5 group" id={res.title === "Status Page" ? "status" : undefined}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.04] border border-white/[0.06] mb-4">
                    <res.icon size={15} className="text-[#71767b]" />
                  </div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="x-card-title text-white">{res.title}</span>
                    {res.external && <ExternalLink size={11} className="text-[#4e535a]" />}
                    {(res as { soon?: boolean }).soon && <StatusBadge status="SOON" />}
                  </div>
                  <p className="text-[13px] text-[#71767b] leading-relaxed">{res.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Bottom spacer */}
          <div className="h-16" />
        </div>
      </main>
    </div>
  );
}
