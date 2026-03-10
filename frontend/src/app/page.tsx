"use client";

import Link from "next/link";
import { ArrowRight, ShieldCheck, Zap, Wallet, Bot, Store, ReceiptText, TerminalSquare } from "lucide-react";

export default function Home() {
  return (
    <div className="px-6 py-10 mx-auto space-y-16 max-w-7xl md:px-8">
      <section className="max-w-4xl space-y-6">
        <p className="text-xs tracking-[0.2em] uppercase text-green-300">AgentPay</p>
        <h1 className="text-4xl font-black leading-tight text-transparent md:text-6xl bg-clip-text bg-gradient-to-r from-green-400 to-emerald-700">
          Agentic Economy Infrastructure
        </h1>
        <p className="max-w-3xl text-lg leading-8 text-gray-300">
          我们是面向 AI Agent 的支付与结算基础设施：让买家 Agent 可以安全调用他人 API，让卖家 API 可以按调用自动收款。
          通过链上充值担保 + 链下网关扣费 + 链上结算提现，兼顾资金安全与高频低延迟。
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard" className="inline-flex items-center gap-2 px-5 py-3 text-sm font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400">
            进入控制台
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link href="/dashboard/credentials" className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white transition-colors border border-gray-700 rounded-lg hover:bg-gray-900">
            买家接入
          </Link>
          <Link href="/dashboard/services" className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white transition-colors border border-gray-700 rounded-lg hover:bg-gray-900">
            卖家接入
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
          <ShieldCheck className="w-6 h-6 mb-3 text-green-400" />
          <h2 className="text-lg font-bold text-white">资金安全</h2>
          <p className="mt-2 text-sm leading-6 text-gray-400">买家先充值到智能合约 Vault，资金有链上担保，不依赖单点托管账户。</p>
        </div>
        <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
          <Zap className="w-6 h-6 mb-3 text-yellow-400" />
          <h2 className="text-lg font-bold text-white">高频低延迟</h2>
          <p className="mt-2 text-sm leading-6 text-gray-400">调用走平台 Gateway 离链原子扣费，不必逐笔上链，适配 Agent 高频调用场景。</p>
        </div>
        <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
          <ReceiptText className="w-6 h-6 mb-3 text-blue-400" />
          <h2 className="text-lg font-bold text-white">费用透明</h2>
          <p className="mt-2 text-sm leading-6 text-gray-400">每笔调用都展示扣费拆分：平台费、卖家净收入、剩余余额，账单可审计可对账。</p>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="p-6 border border-gray-800 rounded-xl bg-black/40">
          <div className="flex items-center gap-2 mb-3">
            <Bot className="w-5 h-5 text-green-400" />
            <h3 className="text-xl font-bold text-white">买家 / 调用方：如何接入与调用</h3>
          </div>
          <ol className="space-y-2 text-sm leading-6 text-gray-300 list-decimal list-inside">
            <li>连接钱包并完成签名登录</li>
            <li>充值 USDC 到智能合约（Deposit 担保）</li>
            <li>签发 `X-Agent-Credential` 给你的 Agent</li>
            <li>调用卖家 API（通过平台网关转发）</li>
            <li>查看每笔消费、余额与扣费明细</li>
          </ol>
          <div className="flex flex-wrap gap-2 mt-4">
              <Link href="/dashboard/console" className="px-3 py-2 text-xs font-semibold text-black bg-yellow-500 rounded-lg hover:bg-yellow-400">快速充值</Link>
              <Link href="/dashboard/console" className="px-3 py-2 text-xs font-semibold text-black bg-green-500 rounded-lg hover:bg-green-400">获取 API Key</Link>
              <Link href="/dashboard/console" className="px-3 py-2 text-xs font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">查看 Quick Start</Link>
          </div>
        </div>

        <div className="p-6 border border-gray-800 rounded-xl bg-black/40">
          <div className="flex items-center gap-2 mb-3">
            <Store className="w-5 h-5 text-emerald-400" />
            <h3 className="text-xl font-bold text-white">卖家 / 服务方：如何提供接口并赚收益</h3>
          </div>
          <ol className="space-y-2 text-sm leading-6 text-gray-300 list-decimal list-inside">
            <li>注册 Agent 与 Service（配置 `endpoint + unit_price`）</li>
            <li>平台 Gateway 接入并转发买家调用</li>
            <li>调用成功后自动分账，累计 `seller_net`</li>
            <li>在结算页面发起提现（链上 claim）</li>
            <li>在控制台查看调用量、收益与流水</li>
          </ol>
          <div className="flex flex-wrap gap-2 mt-4">
            <Link href="/dashboard/agents" className="px-3 py-2 text-xs font-semibold text-black bg-green-500 rounded-lg hover:bg-green-400">去注册 Agent</Link>
            <Link href="/dashboard/services" className="px-3 py-2 text-xs font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">去注册服务</Link>
            <Link href="/dashboard" className="px-3 py-2 text-xs font-semibold text-white border border-gray-700 rounded-lg hover:bg-gray-900">查看收益看板</Link>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
          <Wallet className="w-5 h-5 mb-3 text-yellow-400" />
          <h4 className="font-semibold text-white">充值与担保</h4>
          <p className="mt-2 text-sm leading-6 text-gray-400">买家充值先进入智能合约金库，形成可消费额度；未确认的充值不进入可消费余额。</p>
        </div>
        <div className="p-5 border border-gray-800 rounded-xl bg-black/40">
          <h4 className="font-semibold text-white">扣费机制</h4>
          <p className="mt-2 font-mono text-xs text-gray-300">platform_fee = unit_price × fee_rate</p>
          <p className="mt-1 font-mono text-xs text-gray-300">seller_net = unit_price - platform_fee</p>
          <p className="mt-2 text-sm leading-6 text-gray-400">调用失败按策略回滚，调用成功固化账务，保证扣费可追踪。</p>
        </div>
          <Link href="/dashboard/console" className="block p-5 transition-colors border border-green-900/50 rounded-xl bg-black/40 hover:bg-green-900/20">
          <TerminalSquare className="w-8 h-8 mb-3 text-green-500" />
          <h4 className="text-lg font-bold text-white">Developer Console</h4>
          <p className="mt-2 text-sm leading-6 text-gray-400">统一管理服务、凭据、调用、收益与结算，作为买卖双方的操作中枢。</p>
        </Link>
      </section>
    </div>
  );
}
