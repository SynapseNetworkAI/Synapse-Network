"use client";

import { GitBranch, FileText } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import { useActiveSection } from "../use-active-section";

const PAGE_SECTIONS = ["contract-core", "contract-usdc"];

export default function ContractsPage() {
  useActiveSection(PAGE_SECTIONS, "contract-core");

  return (
    <div className="space-y-16">

      {/* Page header */}
      <div className="space-y-2 border-b border-white/[0.06] pb-8">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
          Smart Contracts
        </span>
        <h1 className="x-page-title text-white">Smart Contracts</h1>
        <p className="x-body-copy max-w-[560px]">
          Synapse 合约部署于 Hardhat Localhost（开发）与 Arbitrum Sepolia（测试网），
          主网将迁移至 Arbitrum One。
        </p>
      </div>

      {/* Network badges */}
      <div className="flex gap-3 flex-wrap">
        {[
          { net: "Hardhat Localhost", chainId: "31337", color: "#7ff7be" },
          { net: "Arbitrum Sepolia",  chainId: "421614", color: "#6eb6f6" },
        ].map((n) => (
          <div
            key={n.net}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[12px] font-mono"
            style={{ borderColor: `${n.color}28`, background: `${n.color}10`, color: n.color }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: n.color }} />
            {n.net}
            <span className="text-[#4e535a]">chainId: {n.chainId}</span>
          </div>
        ))}
      </div>

      {/* ── SynapseCore ─────────────────────────────────────────── */}
      <section id="contract-core" className="space-y-6">
        <div className="flex items-center gap-3">
          <GitBranch size={18} className="text-[#7ff7be]" />
          <h2 className="x-section-title text-white">SynapseCore</h2>
          <StatusBadge status="GA" />
        </div>
        <p className="x-body-copy">
          主结算合约，负责 USDC 的存款托管与提现分发。由 Gateway 链下账本驱动，
          链上仅在 deposit / withdraw 时交互。
        </p>

        <div className="x-panel-muted rounded-2xl p-5 space-y-3">
          <div className="text-[12px] font-semibold text-[#4e535a] uppercase tracking-widest">Hardhat Localhost</div>
          <code className="block text-[13px] font-mono text-[#7ff7be] break-all">
            0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82
          </code>
        </div>

        <h3 className="text-[15px] font-semibold text-white">Key Functions</h3>
        <div className="rounded-2xl border border-white/[0.06] overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3">Function</th>
                <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3 hidden md:table-cell">Description</th>
              </tr>
            </thead>
            <tbody>
              {[
                { fn: "deposit(uint256 amount)",               desc: "锁入 USDC，触发 Deposited 事件" },
                { fn: "withdraw(address to, uint256 amount)",  desc: "向 Provider 钱包转账 USDC（仅 Gateway 可用）" },
                { fn: "getBalance(address user)",              desc: "查询用户在合约内的存款余额" },
              ].map((row) => (
                <tr
                  key={row.fn}
                  className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-4 py-3">
                    <code className="text-[12px] font-mono text-[#c0c5cc]">{row.fn}</code>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-[12px] text-[#71767b]">{row.desc}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-[15px] font-semibold text-white mt-6">Events</h3>
        <div className="rounded-2xl border border-white/[0.06] overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3">Event</th>
                <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3 hidden md:table-cell">Fields</th>
              </tr>
            </thead>
            <tbody>
              {[
                { ev: "Deposited(address user, uint256 amount)",         fields: "充值确认，Gateway 监听此事件" },
                { ev: "Withdrawn(address to, uint256 amount)",           fields: "提现执行，链上转账完成" },
              ].map((row) => (
                <tr
                  key={row.ev}
                  className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-4 py-3">
                    <code className="text-[12px] font-mono text-[#7ff7be]">{row.ev}</code>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-[12px] text-[#71767b]">{row.fields}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── MockUSDC ────────────────────────────────────────────── */}
      <section id="contract-usdc" className="space-y-6">
        <div className="flex items-center gap-3">
          <FileText size={18} className="text-[#6eb6f6]" />
          <h2 className="x-section-title text-white">MockUSDC</h2>
          <StatusBadge status="BETA" />
        </div>
        <p className="x-body-copy">
          测试用 ERC-20 Token，18 decimals，任意地址可调用 <code className="text-[#c0c5cc] font-mono text-[12px]">mint()</code> 获取测试资金。
          生产环境使用真实 USDC（6 decimals）。
        </p>

        <div className="x-panel-muted rounded-2xl p-5 space-y-3">
          <div className="text-[12px] font-semibold text-[#4e535a] uppercase tracking-widest">Hardhat Localhost</div>
          <code className="block text-[13px] font-mono text-[#6eb6f6] break-all">
            0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0
          </code>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { title: "Symbol",    value: "USDC (Mock)" },
            { title: "Decimals",  value: "18 (testnet) / 6 (mainnet)" },
            { title: "Mint",      value: "Public — 任意地址可 mint" },
            { title: "Burn",      value: "Owner only" },
          ].map((row) => (
            <div key={row.title} className="x-panel-muted rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-[12px] text-[#4e535a]">{row.title}</span>
              <span className="text-[13px] font-mono text-[#c0c5cc]">{row.value}</span>
            </div>
          ))}
        </div>

        <div className="x-panel-muted rounded-xl p-4 flex gap-3">
          <span className="text-yellow-400 mt-0.5 shrink-0">⚠️</span>
          <p className="text-[13px] text-[#71767b] leading-relaxed">
            MockUSDC 仅用于开发测试。主网集成请使用 Circle 官方 USDC 合约地址，
            并注意切换 decimals（6）。
          </p>
        </div>
      </section>

      {/* ABI source */}
      <section className="space-y-3 border-t border-white/[0.06] pt-10">
        <h3 className="x-card-title text-white">获取 ABI</h3>
        <p className="x-body-copy">
          编译后的 ABI 位于仓库 <code className="text-[#c0c5cc] font-mono text-[12px]">artifacts/contracts/</code> 目录，
          可直接 import 或通过 npm 包引用。
        </p>
        <div className="flex gap-3">
          <a
            href="https://github.com/synapse-network"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-[13px] text-[#7ff7be] hover:underline"
          >
            GitHub — contracts/
          </a>
        </div>
      </section>

      <div className="h-16" />
    </div>
  );
}
