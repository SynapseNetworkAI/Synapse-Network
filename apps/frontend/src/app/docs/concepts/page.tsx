"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { CodeBlock } from "../components/CodeBlock";
import { useActiveSection } from "../use-active-section";

const PAGE_SECTIONS = ["settlement", "service-registry", "credentials", "idempotency"];

export default function ConceptsPage() {
  const router = useRouter();
  useActiveSection(PAGE_SECTIONS, "settlement");

  return (
    <div className="space-y-20">

      {/* Page header */}
      <div className="space-y-2 border-b border-white/[0.06] pb-8">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
          Core Concepts
        </span>
        <h1 className="x-page-title text-white">How Synapse Works</h1>
        <p className="x-body-copy max-w-[560px]">
          深入理解链上担保、链下结算、凭证系统与幂等性设计。
        </p>
      </div>

      {/* ── How Settlement Works ────────────────────────────────── */}
      <section id="settlement" className="space-y-6">
        <h2 className="x-section-title text-white">How Settlement Works</h2>
        <p className="x-body-copy">
          Synapse 的结算流程分四个阶段，所有扣费操作在链下完成原子性分账，Provider 随时可凭余额提现至链上。
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            {
              label: "充值 (Deposit)",
              desc: "USDC 锁入 SynapseCore 合约，Gateway 记录 consumer 可用余额。资金由合约托管，平台无法挪用。",
            },
            {
              label: "报价 (Quote)",
              desc: "Consumer 请求报价，Gateway 返回本次调用预计花费 USDC。报价在调用前锁定，防止价格波动。",
            },
            {
              label: "调用 (Invoke)",
              desc: "原子扣费：consumer余额↓ · provider receivable↑ · platform fee↑。三步写入单事务，不可部分失败。",
            },
            {
              label: "提现 (Withdraw)",
              desc: "Provider 发起提现申请，合约验证 receivable 余额后向 Provider 钱包地址转账 USDC。",
            },
          ].map((step) => (
            <div key={step.label} className="x-panel-muted rounded-xl p-5">
              <div className="x-card-title text-[#c0c5cc] mb-2">{step.label}</div>
              <p className="text-[13px] text-[#71767b] leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>

        {/* Flow diagram */}
        <div className="p-5 rounded-2xl border border-white/[0.06] bg-[#0a0b0d] font-mono text-[12px] text-[#71767b] leading-loose">
          <div>
            <span className="text-[#7ff7be]">Consumer</span>{" "}
            <span className="text-[#4e535a]">──deposit──▶</span>{" "}
            <span className="text-[#6eb6f6]">SynapseCore</span>{" "}
            <span className="text-[#4e535a]">◀──locked USDC</span>
          </div>
          <div className="mt-1">
            <span className="text-[#7ff7be]">Consumer</span>{" "}
            <span className="text-[#4e535a]">──invoke──▶</span>{" "}
            <span className="text-[#6eb6f6]">Gateway</span>{" "}
            <span className="text-[#4e535a]">──route──▶</span>{" "}
            <span className="text-[#f9c74f]">Provider API</span>
          </div>
          <div className="mt-1 text-[#3a3f45]">
            {"                    ↳ atomic: balance↓ · receivable↑ · fee↑"}
          </div>
          <div className="mt-1">
            <span className="text-[#f9c74f]">Provider</span>{" "}
            <span className="text-[#4e535a]">──withdraw──▶</span>{" "}
            <span className="text-[#6eb6f6]">SynapseCore</span>{" "}
            <span className="text-[#4e535a]">──USDC──▶ wallet</span>
          </div>
        </div>
      </section>

      {/* ── Service Registry ────────────────────────────────────── */}
      <section id="service-registry" className="space-y-4">
        <h2 className="x-section-title text-white">Service Registry</h2>
        <p className="x-body-copy">
          Service Registry 是 Synapse 的服务发现层。Provider 注册服务后，Consumer 可通过{" "}
          <code className="text-[#7ff7be] font-mono text-[12px] bg-[#7ff7be]/8 px-1.5 py-0.5 rounded">
            /discover
          </code>{" "}
          接口发现并订阅所需服务。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { title: "注册",    desc: "Provider 提交服务名称、端点、标签与定价，获得全局唯一 serviceId" },
            { title: "健康检测", desc: "Gateway 定期 ping Provider 端点，不健康的服务自动下线" },
            { title: "发现",    desc: "Consumer 通过 tag / name 过滤搜索可用服务列表" },
            { title: "定价",    desc: "pricePerCallUsdc 字段控制每次调用扣费，Provider 可随时更新" },
          ].map((item) => (
            <div key={item.title} className="x-panel-muted rounded-xl p-4">
              <div className="text-[13px] font-semibold text-[#c0c5cc] mb-1">{item.title}</div>
              <p className="text-[13px] text-[#71767b]">{item.desc}</p>
            </div>
          ))}
        </div>

        <CodeBlock lang="bash" code={`
# 发现可用服务
GET /api/v1/services/discover?tag=llm&limit=20

# 响应
{
  "services": [
    {
      "serviceId": "svc_abc123",
      "name": "fast-llm",
      "pricePerCallUsdc": "0.001",
      "status": "healthy",
      "tags": ["llm", "inference"]
    }
  ]
}
        `} />
      </section>

      {/* ── Agent Credentials ───────────────────────────────────── */}
      <section id="credentials" className="space-y-4">
        <h2 className="x-section-title text-white">Agent Credentials</h2>
        <p className="x-body-copy">
          Credential 是消费方用于调用 Provider 服务的<strong className="text-[#c0c5cc]">访问令牌</strong>。
          每个 Credential 绑定一个服务 + 一个消费额度上限，可随时撤销，适合多 Agent 并发调用场景。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { title: "颁发",    desc: "绑定 serviceId + 消费上限，生成 agentToken（Bearer）" },
            { title: "额度控制", desc: "每次调用扣减 Credential 额度，耗尽后自动失效" },
            { title: "撤销",    desc: "任意时刻可撤销 Credential，已扣费不退款" },
          ].map((item) => (
            <div key={item.title} className="x-panel-muted rounded-xl p-4">
              <div className="text-[13px] font-semibold text-[#c0c5cc] mb-1">{item.title}</div>
              <p className="text-[13px] text-[#71767b]">{item.desc}</p>
            </div>
          ))}
        </div>

        <CodeBlock lang="http" code={`
POST /api/v1/credentials/agent/issue
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "serviceId": "svc_abc123",
  "label": "my-agent-bot",
  "spendingLimitUsdc": 5.00
}

→ 200
{
  "agentToken": "agt_xxxxx...",
  "credentialId": "cred_uuid",
  "spendingLimitUsdc": "5.00",
  "remainingUsdc": "5.00"
}
        `} />
      </section>

      {/* ── Idempotency ─────────────────────────────────────────── */}
      <section id="idempotency" className="space-y-4">
        <h2 className="x-section-title text-white">Idempotency</h2>
        <p className="x-body-copy">
          所有写操作均支持幂等性 key。网络重试时传入相同 key，Gateway 自动返回缓存结果，不重复扣费。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="x-panel-muted rounded-xl p-5 space-y-2">
            <div className="text-[13px] font-semibold text-[#c0c5cc]">充值意图</div>
            <p className="text-[13px] text-[#71767b]">
              {"使用请求头 "}
              <code className="text-[#c0c5cc] font-mono text-[12px]">X-Idempotency-Key</code>
              {"，最短 16 字符，建议 UUID v4。"}
            </p>
          </div>
          <div className="x-panel-muted rounded-xl p-5 space-y-2">
            <div className="text-[13px] font-semibold text-[#c0c5cc]">Agent 调用</div>
            <p className="text-[13px] text-[#71767b]">
              请求体中传入{" "}
              <code className="text-[#c0c5cc] font-mono text-[12px]">idempotencyKey</code>{" "}
              字段，同一 key 60 秒内重复请求返回缓存响应。
            </p>
          </div>
        </div>

        <div className="x-panel-muted rounded-xl p-4 flex gap-3">
          <span className="text-[#7ff7be] mt-0.5 shrink-0">💡</span>
          <p className="text-[13px] text-[#71767b] leading-relaxed">
            在高频调用或网络不稳定场景下，始终传入幂等 key 是最佳实践。
            Gateway 的幂等窗口为 <strong className="text-[#c0c5cc]">60 秒</strong>，窗口外相同 key 视为新请求。
          </p>
        </div>
      </section>

      {/* Next */}
      <section className="border-t border-white/[0.06] pt-10">
        <h3 className="x-card-title text-white mb-4">下一步</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { label: "API Reference", desc: "完整 REST 端点列表", href: "/docs/api-reference" },
            { label: "Smart Contracts", desc: "合约地址与 ABI", href: "/docs/contracts" },
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
