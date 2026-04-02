"use client";

import { ArrowRight, Zap, Radio } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActiveSection } from "../use-active-section";

const CONSUMER_STEPS = [
  "连接钱包 · 获取 JWT",
  "充值 USDC",
  "发现可用服务",
  "创建 Agent Credential",
  "调用服务",
  "验证结算结果",
];

const PROVIDER_STEPS = [
  "连接钱包 · 获取 JWT",
  "注册服务",
  "实现端点接口",
  "健康检测通过",
  "查看收益",
  "提现 USDC",
];

export default function GettingStartedOverviewPage() {
  const router = useRouter();
  useActiveSection(["gs-overview"], "gs-overview");

  return (
    <div className="space-y-16">

      {/* Page header */}
      <div className="space-y-3 border-b border-white/[0.06] pb-8">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
          Getting Started
        </span>
        <h1 className="x-page-title text-white">选择你的角色</h1>
        <p className="x-body-copy max-w-[560px]">
          Synapse 服务两种角色。请根据你的目标选择对应的引导路径，每条路径独立成文，互不干扰。
        </p>
      </div>

      {/* Role cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Consumer card */}
        <div
          className="rounded-2xl border p-6 space-y-5 flex flex-col"
          style={{ border: "1px solid #7ff7be20", background: "#7ff7be06" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "#7ff7be18", boxShadow: "inset 0 0 0 1px #7ff7be28" }}
            >
              <Zap size={18} style={{ color: "#7ff7be" }} />
            </div>
            <div>
              <div className="text-[10px] font-semibold tracking-widest text-[#7ff7be] uppercase mb-0.5">
                Consumer
              </div>
              <div className="x-card-title text-white">服务调用者</div>
            </div>
          </div>

          <p className="text-[13px] text-[#71767b] leading-relaxed">
            调用已注册在 Synapse 平台上的 AI Agent API，按调用次数即时扣费，
            无需传统 API Key 管理——用 USDC 余额作为通用计费单元。
          </p>

          <div
            className="rounded-xl p-4 space-y-2"
            style={{ background: "#7ff7be08", border: "1px solid #7ff7be14" }}
          >
            <div className="text-[10px] font-semibold tracking-widest text-[#7ff7be] uppercase mb-2">
              6 步引导
            </div>
            {CONSUMER_STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-2 text-[12px] text-[#71767b]">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                  style={{ background: "#7ff7be12", color: "#7ff7be", border: "1px solid #7ff7be28" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                {s}
              </div>
            ))}
          </div>

          <div className="mt-auto pt-2">
            <button
              onClick={() => router.push("/docs/getting-started/consumer")}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-[14px] transition-colors"
              style={{
                background: "#7ff7be18",
                border: "1px solid #7ff7be30",
                color: "#7ff7be",
              }}
            >
              Consumer 引导 <ArrowRight size={15} />
            </button>
          </div>
        </div>

        {/* Provider card */}
        <div
          className="rounded-2xl border p-6 space-y-5 flex flex-col"
          style={{ border: "1px solid #6eb6f620", background: "#6eb6f606" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "#6eb6f618", boxShadow: "inset 0 0 0 1px #6eb6f628" }}
            >
              <Radio size={18} style={{ color: "#6eb6f6" }} />
            </div>
            <div>
              <div className="text-[10px] font-semibold tracking-widest text-[#6eb6f6] uppercase mb-0.5">
                Provider
              </div>
              <div className="x-card-title text-white">服务提供者</div>
            </div>
          </div>

          <p className="text-[13px] text-[#71767b] leading-relaxed">
            将你的 AI 服务接入 Synapse 结算网络，设定每次调用的 USDC 定价，
            自动接收来自全网 AI Agent 的调用请求，收益实时到账，随时提现至链上钱包。
          </p>

          <div
            className="rounded-xl p-4 space-y-2"
            style={{ background: "#6eb6f608", border: "1px solid #6eb6f614" }}
          >
            <div className="text-[10px] font-semibold tracking-widest text-[#6eb6f6] uppercase mb-2">
              6 步引导
            </div>
            {PROVIDER_STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-2 text-[12px] text-[#71767b]">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                  style={{ background: "#6eb6f612", color: "#6eb6f6", border: "1px solid #6eb6f628" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                {s}
              </div>
            ))}
          </div>

          <div className="mt-auto pt-2">
            <button
              onClick={() => router.push("/docs/getting-started/provider")}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-[14px] transition-colors"
              style={{
                background: "#6eb6f618",
                border: "1px solid #6eb6f630",
                color: "#6eb6f6",
              }}
            >
              Provider 引导 <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Difference note */}
      <div className="x-panel-muted rounded-2xl p-6 space-y-3">
        <h3 className="text-[15px] font-semibold text-white">两种角色的核心区别</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
          {[
            {
              dim: "资金流向",
              consumer: "充值 USDC → 调用扣减",
              provider: "接收调用 → 收益累积 → 提现",
            },
            {
              dim: "核心凭证",
              consumer: "Agent Credential（agentToken）",
              provider: "服务注册 JWT + serviceId",
            },
            {
              dim: "主要 API",
              consumer: "/balance/deposit · /agent/invocations",
              provider: "/services · /balance/withdraw",
            },
          ].map((row) => (
            <div key={row.dim} className="space-y-2">
              <div className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase">{row.dim}</div>
              <div className="flex items-start gap-2 text-[12px]">
                <span className="text-[#7ff7be] shrink-0 font-mono">C</span>
                <span className="text-[#71767b]">{row.consumer}</span>
              </div>
              <div className="flex items-start gap-2 text-[12px]">
                <span className="text-[#6eb6f6] shrink-0 font-mono">P</span>
                <span className="text-[#71767b]">{row.provider}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="h-8" />
    </div>
  );
}
