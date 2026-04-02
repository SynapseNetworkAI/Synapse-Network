"use client";

import {
  Zap, Radio, Package, ArrowRight,
  Terminal, Layers, Shield, Activity, Database, Webhook,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "./components/StatusBadge";
import { useActiveSection } from "./use-active-section";

const QUICK_START_CARDS = [
  {
    icon: Zap,
    tag: "5 min",
    title: "Use an Agent Service",
    desc: "充值 USDC → 创建 Credential → 调用 API → 余额即时扣减",
    href: "/docs/getting-started",
    color: "#7ff7be",
  },
  {
    icon: Radio,
    tag: "10 min",
    title: "Register a Service",
    desc: "注册服务 → 配置 pricing → 上线 → 实时接收收益",
    href: "/docs/getting-started#service-registry",
    color: "#6eb6f6",
  },
  {
    icon: Package,
    tag: "NEW",
    title: "TypeScript SDK",
    desc: "npm install → import SynapseClient → 3 行代码完成调用",
    href: "/docs/sdk",
    color: "#f9c74f",
  },
];

const PRODUCTS = [
  { icon: Terminal, title: "Gateway API",       desc: "结算网关核心 REST API。处理认证、计费与链路路由，亚毫秒级 overhead。",         status: "GA",   href: "/docs/api-reference" },
  { icon: Layers,   title: "Service Registry",  desc: "Provider 服务注册、定价配置、健康检测与公开发现接口。",                      status: "GA",   href: "/docs/concepts#service-registry" },
  { icon: Shield,   title: "Agent Credentials", desc: "消费方凭证颁发、额度控制、生命周期管理与撤销流程。",                         status: "GA",   href: "/docs/concepts#credentials" },
  { icon: Activity, title: "Settlement Engine", desc: "链下原子扣费 + 分账，链上 USDC 可提现。gas-free 高频结算。",                status: "GA",   href: "/docs/concepts" },
  { icon: Database, title: "Deposit Indexer",   desc: "链上充值事件监听、自动确认、idempotent 意图管理。",                         status: "GA",   href: "/docs/getting-started#deposit" },
  { icon: Webhook,  title: "Webhooks",           desc: "调用完成回调与事件推送 —— Provider 可订阅 settled 事件。",                 status: "SOON", href: "#" },
];

export default function DocsOverviewPage() {
  const router = useRouter();
  useActiveSection(["introduction", "architecture"], "introduction");

  return (
    <div className="space-y-20">

      {/* Hero */}
      <section id="introduction" data-testid="docs-hero" className="space-y-6">
        <div className="flex items-center gap-3">
          <StatusBadge status="BETA" />
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
            Developer Documentation
          </span>
        </div>

        <h1 className="x-page-title text-white" style={{ maxWidth: 600 }}>
          Synapse Developer Platform
        </h1>

        <p className="x-body-copy max-w-[560px]">
          AI Agent 经济基础设施 ——{" "}
          <span className="text-[#c0c5cc]">
            链上充值担保 · 链下网关秒扣 · 凭票免 Gas 提现。
          </span>{" "}
          让 AI 之间（M2M）以毫秒级延迟、零 Gas 成本完成 API 服务的购买与结算。
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            data-testid="cta-quickstart"
            onClick={() => router.push("/docs/getting-started")}
            className="x-button-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-[14px]"
          >
            Quick Start <ArrowRight size={15} />
          </button>
          <button
            onClick={() => router.push("/docs/api-reference")}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-[14px] text-white border border-white/10 hover:border-white/20 hover:bg-white/[0.04] transition-colors"
          >
            API Reference
          </button>
        </div>

        <div className="mt-2 p-5 rounded-2xl border border-white/[0.06] bg-[#0a0b0d] font-mono text-[12px] text-[#71767b] leading-relaxed">
          <span className="text-[#7ff7be]">Consumer</span>
          {" /deposit USDC → "}
          <span className="text-[#6eb6f6]">Gateway</span>
          {" /quote → /invoke → "}
          <span className="text-[#f9c74f]">Provider API</span>
          {" → settled "}
          <span className="text-[#7ff7be]">✓</span>
          <br />
          <span className="text-[#3a3f45]">
            {"                  ↓ platform fee accrued · provider receivable ++"}
          </span>
        </div>
      </section>

      {/* Quick Start Cards */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">Get Started</span>
          <div className="flex-1 h-px bg-white/[0.045]" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="quickstart-cards">
          {QUICK_START_CARDS.map((card) => (
            <button
              key={card.title}
              onClick={() => router.push(card.href)}
              className="x-tile-flat x-tile-flat-hover text-left p-5 rounded-2xl block"
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center mb-4"
                style={{ background: `${card.color}18`, boxShadow: `inset 0 0 0 1px ${card.color}28` }}
              >
                <card.icon size={17} style={{ color: card.color }} />
              </div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="x-card-title text-white">{card.title}</span>
                <span
                  className="text-[10px] font-semibold shrink-0 px-2 py-0.5 rounded border"
                  style={{ color: card.color, borderColor: `${card.color}28`, background: `${card.color}10` }}
                >
                  {card.tag}
                </span>
              </div>
              <p className="text-[13px] text-[#71767b] leading-relaxed">{card.desc}</p>
              <div className="mt-4 flex items-center gap-1 text-[12px] font-medium" style={{ color: card.color }}>
                <span>Read guide</span>
                <ArrowRight size={12} />
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Architecture */}
      <section id="architecture" className="space-y-4">
        <h2 className="x-section-title text-white">Architecture</h2>
        <p className="x-body-copy">
          Synapse 采用<strong className="text-[#c0c5cc]">混合结算模型</strong>：链上 USDC
          存入合约作担保，链下网关完成毫秒级扣费与分账，Provider 凭收益凭证随时提现至链上地址。
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          {[
            { num: "01", label: "链上担保", desc: "SynapseCore 合约接收 USDC 存款，资金锁仓作为消费配额" },
            { num: "02", label: "链下结算", desc: "Gateway 实时扣费 + 分账：consumer↓ · provider↑ · platform_fee↑" },
            { num: "03", label: "凭证提现", desc: "Provider 凭 receivable 余额发起提现，合约转账 USDC 至钱包" },
          ].map((step) => (
            <div key={step.num} className="x-panel-muted rounded-2xl p-5">
              <div className="text-[10px] font-semibold tracking-widest text-[#7ff7be] mb-3">{step.num}</div>
              <div className="x-card-title text-white mb-2">{step.label}</div>
              <p className="text-[13px] text-[#71767b] leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Platform Products */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">Platform Products</span>
          <div className="flex-1 h-px bg-white/[0.045]" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="products-grid">
          {PRODUCTS.map((p) => (
            <button
              key={p.title}
              onClick={() => router.push(p.href)}
              className="x-tile-flat x-tile-flat-hover text-left p-5 rounded-2xl"
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

      <div className="h-16" />
    </div>
  );
}
