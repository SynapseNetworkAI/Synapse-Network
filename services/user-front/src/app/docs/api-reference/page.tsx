"use client";

import { useActiveSection } from "../use-active-section";
import { StatusBadge } from "../components/StatusBadge";

const PAGE_SECTIONS = ["api-auth", "api-balance", "api-services", "api-invocations", "api-credentials"];

const METHOD_COLOR: Record<string, string> = {
  GET:    "text-[#7ff7be] bg-[#7ff7be]/10 border-[#7ff7be]/20",
  POST:   "text-[#6eb6f6] bg-[#6eb6f6]/10 border-[#6eb6f6]/20",
  PUT:    "text-[#f9c74f] bg-[#f9c74f]/10 border-[#f9c74f]/20",
  DELETE: "text-red-400 bg-red-400/10 border-red-400/20",
};

interface Route {
  method: string;
  path: string;
  desc: string;
  auth?: boolean;
}

const ROUTE_GROUPS: { id: string; title: string; routes: Route[] }[] = [
  {
    id: "api-auth",
    title: "Auth",
    routes: [
      { method: "GET",  path: "/api/v1/auth/challenge",  desc: "获取 EIP-191 签名挑战串",       auth: false },
      { method: "POST", path: "/api/v1/auth/verify",     desc: "验证签名，返回 JWT",             auth: false },
      { method: "POST", path: "/api/v1/auth/logout",     desc: "吊销当前 JWT",                  auth: true  },
    ],
  },
  {
    id: "api-balance",
    title: "Balance",
    routes: [
      { method: "GET",  path: "/api/v1/balance",                               desc: "查询当前账户余额摘要",                auth: true },
      { method: "POST", path: "/api/v1/balance/deposit/intent",                desc: "登记充值意图（需 X-Idempotency-Key）", auth: true },
      { method: "POST", path: "/api/v1/balance/deposit/intents/:id/confirm",   desc: "确认链上充值事件",                   auth: true },
      { method: "POST", path: "/api/v1/balance/withdraw",                      desc: "Provider 发起链上提现申请",          auth: true },
    ],
  },
  {
    id: "api-services",
    title: "Services",
    routes: [
      { method: "POST", path: "/api/v1/services",           desc: "Provider 注册服务",          auth: true },
      { method: "GET",  path: "/api/v1/services",           desc: "列出当前账号注册的服务",      auth: true },
      { method: "GET",  path: "/api/v1/services/discover",  desc: "Consumer 发现可用服务列表",  auth: true },
      { method: "PUT",  path: "/api/v1/services/:id",       desc: "更新服务配置与定价",         auth: true },
      { method: "DELETE", path: "/api/v1/services/:id",     desc: "下线并删除服务",             auth: true },
    ],
  },
  {
    id: "api-invocations",
    title: "Agent Invocations",
    routes: [
      { method: "POST", path: "/api/v1/agent/quotes",       desc: "获取服务调用报价",              auth: true },
      { method: "POST", path: "/api/v1/agent/invocations",  desc: "执行服务调用并即时结算",        auth: true },
      { method: "GET",  path: "/api/v1/agent/invocations",  desc: "查询历史调用记录",              auth: true },
    ],
  },
  {
    id: "api-credentials",
    title: "Credentials",
    routes: [
      { method: "POST",   path: "/api/v1/credentials/agent/issue",     desc: "颁发 Agent Credential",    auth: true },
      { method: "GET",    path: "/api/v1/credentials/agent",           desc: "列出所有 Credential",      auth: true },
      { method: "DELETE", path: "/api/v1/credentials/agent/:id",       desc: "撤销 Credential",          auth: true },
    ],
  },
];

function RouteTable({ routes }: Readonly<{ routes: Route[] }>) {
  return (
    <div className="rounded-2xl border border-white/[0.06] overflow-hidden mt-4">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-white/[0.06] bg-white/[0.02]">
            <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3 w-[80px]">Method</th>
            <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3">Path</th>
            <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3 hidden md:table-cell">Description</th>
            <th className="text-[10px] font-semibold tracking-widest text-[#4e535a] uppercase px-4 py-3 hidden md:table-cell w-[60px]">Auth</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => (
            <tr
              key={`${r.method}-${r.path}`}
              className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
            >
              <td className="px-4 py-3">
                <span className={`inline-block text-[10px] font-semibold tracking-widest px-2 py-0.5 rounded border font-mono ${METHOD_COLOR[r.method] ?? ""}`}>
                  {r.method}
                </span>
              </td>
              <td className="px-4 py-3">
                <code className="text-[12px] font-mono text-[#c0c5cc]">{r.path}</code>
              </td>
              <td className="px-4 py-3 hidden md:table-cell">
                <span className="text-[12px] text-[#71767b]">{r.desc}</span>
              </td>
              <td className="px-4 py-3 hidden md:table-cell">
                {r.auth && (
                  <span className="text-[10px] text-[#4e535a] border border-white/10 px-1.5 py-0.5 rounded font-mono">
                    JWT
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ApiReferencePage() {
  useActiveSection(PAGE_SECTIONS, "api-auth");

  return (
    <div className="space-y-16">

      {/* Page header */}
      <div className="space-y-2 border-b border-white/[0.06] pb-8">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
            API Reference
          </span>
          <StatusBadge status="GA" />
        </div>
        <h1 className="x-page-title text-white">REST API</h1>
        <p className="x-body-copy max-w-[560px]">
          所有路由挂载在{" "}
          <code className="text-[#7ff7be] font-mono text-[13px] bg-[#7ff7be]/8 px-1.5 py-0.5 rounded">/api</code>{" "}
          前缀下。Base URL：
          <code className="text-[#c0c5cc] font-mono text-[13px] ml-1">https://gateway.synapse.network</code>
        </p>
        <div className="flex gap-6 pt-2">
          <div className="flex items-center gap-2">
            <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border font-mono ${METHOD_COLOR.GET}`}>GET</span>
            <span className="text-[12px] text-[#71767b]">读取</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border font-mono ${METHOD_COLOR.POST}`}>POST</span>
            <span className="text-[12px] text-[#71767b]">创建 / 执行</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border font-mono ${METHOD_COLOR.PUT}`}>PUT</span>
            <span className="text-[12px] text-[#71767b]">更新</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border font-mono ${METHOD_COLOR.DELETE}`}>DELETE</span>
            <span className="text-[12px] text-[#71767b]">删除</span>
          </div>
        </div>
      </div>

      {/* Route groups */}
      {ROUTE_GROUPS.map((group) => (
        <section key={group.id} id={group.id} className="space-y-2">
          <h2 className="x-section-title text-white">{group.title}</h2>
          <RouteTable routes={group.routes} />
        </section>
      ))}

      {/* Auth note */}
      <div className="x-panel-muted rounded-xl p-5 flex gap-3">
        <span className="text-[#7ff7be] mt-0.5 shrink-0">🔐</span>
        <div className="space-y-1">
          <p className="text-[13px] font-semibold text-[#c0c5cc]">认证方式</p>
          <p className="text-[13px] text-[#71767b] leading-relaxed">
            标注 <code className="text-[#c0c5cc] font-mono text-[12px]">JWT</code> 的接口需在请求头加入{" "}
            <code className="text-[#7ff7be] font-mono text-[12px]">Authorization: Bearer &lt;token&gt;</code>。
            Token 通过 <code className="text-[#c0c5cc] font-mono text-[12px]">POST /api/v1/auth/verify</code> 获取，有效期 24 小时。
          </p>
        </div>
      </div>

      <div className="h-16" />
    </div>
  );
}
