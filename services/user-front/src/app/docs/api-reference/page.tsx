"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useActiveSection } from "../use-active-section";
import { StatusBadge } from "../components/StatusBadge";
import { useDocsPageNav } from "../use-docs-page-nav";
import {
  ROUTE_GROUPS,
  METHOD_BG,
  ROLE_BADGE,
  type RouteGroup,
  type RouteEndpoint,
} from "./endpoint-data";

const PAGE_SECTIONS = [
  "api-auth",
  "api-balance",
  "api-services",
  "api-provider",
  "api-invocations",
  "api-credentials",
  "api-community",
];

// ─── Role filter ──────────────────────────────────────────────────────────────

function roleBtnCls(active: boolean, role: "consumer" | "provider"): string {
  if (!active) return "text-[#4e535a] hover:text-[#71767b]";
  if (role === "consumer") return "bg-[#6eb6f6]/15 text-[#6eb6f6] border border-[#6eb6f6]/20";
  return "bg-[#c084fc]/15 text-[#c084fc] border border-[#c084fc]/20";
}

function getGroupsForRole(groups: RouteGroup[], role: "consumer" | "provider"): RouteGroup[] {
  if (role === "consumer") {
    return groups
      .filter((g) => g.id !== "api-provider")
      .map((g) => {
        if (g.id === "api-services") {
          return {
            ...g,
            description: "Discover available API services for agent invocation.",
            routes: g.routes.filter((r) => ["get-discover", "get-marketplace-registry"].includes(r.id)),
          };
        }
        return g;
      })
      .filter((g) => g.routes.length > 0);
  }
  return groups
    .filter((g) => ["api-auth", "api-balance", "api-services", "api-provider", "api-community"].includes(g.id))
    .map((g) => {
      if (g.id === "api-services") {
        return {
          ...g,
          routes: g.routes.filter((r) => [
            "post-service",
            "get-services",
            "put-service",
            "delete-service",
            "get-service-health-history",
          ].includes(r.id)),
        };
      }
      return g;
    });
}

// ─── Endpoint link row ────────────────────────────────────────────────────────

function EndpointRow({ route }: { route: RouteEndpoint }) {
  const roleBadge = ROLE_BADGE[route.agentMeta.role];
  const methodBg = METHOD_BG[route.method] ?? "bg-white/10 text-white";

  return (
    <Link
      href={`/docs/api-reference/${route.id}`}
      className="group flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.012] px-4 py-3.5 transition-all hover:border-white/[0.12] hover:bg-white/[0.03]"
    >
      <span
        className={`inline-block min-w-[52px] text-center text-[11px] font-bold tracking-wide rounded-md px-2 py-1 font-mono shrink-0 ${methodBg}`}
      >
        {route.method}
      </span>
      <code className="text-[13px] font-mono text-[#c0c5cc] truncate flex-[1.2]">{route.path}</code>
      <span className="hidden text-[13px] text-[#71767b] md:block flex-1 truncate leading-snug">
        {route.summary}
      </span>
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {route.auth !== "none" && (
          <span className="hidden sm:block text-[10px] text-[#4e535a] border border-white/[0.08] px-1.5 py-0.5 rounded font-mono">
            {route.auth === "credential" ? "CRED" : "JWT"}
          </span>
        )}
        {roleBadge && (
          <span
            className={`hidden sm:inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${roleBadge.cls}`}
          >
            {roleBadge.label}
          </span>
        )}
        <ArrowRight
          size={13}
          className="text-[#3a3f46] group-hover:text-[#71767b] transition-colors shrink-0"
        />
      </div>
    </Link>
  );
}

// ─── Quickstart flow ──────────────────────────────────────────────────────────

const FLOW_STEPS = [
  { n: 1, label: "GET /challenge", phase: "auth", hint: "owner" },
  { n: 2, label: "POST /verify", phase: "auth", hint: "→ JWT" },
  { n: 3, label: "POST /credentials", phase: "manage", hint: "→ token" },
  { n: 4, label: "GET /discover", phase: "discover", hint: "→ serviceId" },
  { n: 5, label: "POST /agent/invoke", phase: "invoke", hint: "→ result" },
];

const FLOW_CLR: Record<string, string> = {
  auth: "border-[#7ff7be]/30 text-[#7ff7be] bg-[#7ff7be]/6",
  manage: "border-[#f9c74f]/30 text-[#f9c74f] bg-[#f9c74f]/6",
  discover: "border-[#6eb6f6]/30 text-[#6eb6f6] bg-[#6eb6f6]/6",
  invoke: "border-green-400/30 text-green-400 bg-green-400/6",
};

const PROVIDER_HASHES = new Set(["api-provider"]);
const CONSUMER_HASHES = new Set(["api-invocations", "api-credentials"]);

function roleForApiHash(hash: string): "consumer" | "provider" | null {
  if (PROVIDER_HASHES.has(hash)) return "provider";
  if (CONSUMER_HASHES.has(hash)) return "consumer";
  return null;
}

function AgentQuickstart() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[#6eb6f6]">
            Agent Quickstart
          </span>
          <span className="text-[12px] text-[#71767b]">Complete M2M flow — 5 API calls</span>
        </div>
        <span className="text-[#4e535a] text-[11px]">{open ? "▲" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-white/[0.04] px-5 pb-6">
          <div className="mt-4 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">
            Phase 1 — Owner (JWT)
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-5">
            {FLOW_STEPS.slice(0, 3).map((s, i, arr) => (
              <React.Fragment key={s.n}>
                <div
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-mono ${FLOW_CLR[s.phase]}`}
                >
                  <span className="text-[9px] opacity-50">#{s.n}</span>
                  <span className="font-medium">{s.label}</span>
                  {s.hint && <span className="opacity-60 text-[10px]">{s.hint}</span>}
                </div>
                {i < arr.length - 1 && (
                  <ArrowRight size={11} className="text-[#3a3f46] shrink-0" />
                )}
              </React.Fragment>
            ))}
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 bg-white/[0.04]" />
            <span className="text-[10px] text-[#3a3f46]">↓ pass token to agent runtime</span>
            <div className="h-px flex-1 bg-white/[0.04]" />
          </div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#4e535a]">
            Phase 2 — Agent Runtime (Credential token)
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {FLOW_STEPS.slice(3).map((s, i, arr) => (
              <React.Fragment key={s.n}>
                <div
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-mono ${FLOW_CLR[s.phase]}`}
                >
                  <span className="text-[9px] opacity-50">#{s.n}</span>
                  <span className="font-medium">{s.label}</span>
                  {s.hint && <span className="opacity-60 text-[10px]">{s.hint}</span>}
                </div>
                {i < arr.length - 1 && (
                  <ArrowRight size={11} className="text-[#3a3f46] shrink-0" />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ApiReferencePage() {
  const { t, tList } = useLanguage();
  useActiveSection(PAGE_SECTIONS, "api-auth");

  const groupTitles = tList("docsPage.apiGroupTitles");
  const groupDescriptions = tList("docsPage.apiGroupDescriptions");
  const groups = ROUTE_GROUPS.map((g, i) => ({
    ...g,
    title: groupTitles[i] ?? g.title,
    description: groupDescriptions[i] ?? g.description,
  }));

  useDocsPageNav(groups.map((g) => ({ id: g.id, label: g.title })));

  const [viewRole, setViewRole] = useState<"consumer" | "provider">("consumer");
  const boundaryItems = tList("docsPage.apiAgentBoundaryItems");

  useEffect(() => {
    const syncRoleFromHash = () => {
      const hash = globalThis.location.hash.replace(/^#/, "");
      const hashRole = roleForApiHash(hash);
      if (hashRole) {
        setViewRole(hashRole);
      }
    };

    syncRoleFromHash();
    globalThis.addEventListener("hashchange", syncRoleFromHash);
    return () => {
      globalThis.removeEventListener("hashchange", syncRoleFromHash);
    };
  }, []);

  useEffect(() => {
    const hash = globalThis.location.hash.replace(/^#/, "");
    if (!hash) return;
    const scrollToHash = () => {
      document.getElementById(hash)?.scrollIntoView({ block: "start" });
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(scrollToHash);
      return;
    }
    globalThis.setTimeout(scrollToHash, 0);
  }, [viewRole]);

  return (
    <div className="space-y-14">
      {/* Header */}
      <div className="space-y-4 border-b border-white/[0.06] pb-8">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
            {t("docsPage.apiEyebrow")}
          </span>
          <StatusBadge status="GA" />
        </div>
        <h1 className="x-page-title text-white">{t("docsPage.apiTitle")}</h1>
        <p className="x-body-copy">
          {t("docsPage.apiDescription")}{" "}
          <code className="text-[#7ff7be] font-mono text-[13px] bg-[#7ff7be]/8 px-1.5 py-0.5 rounded">
            /api
          </code>{" "}
          <code className="text-[#c0c5cc] font-mono text-[13px] ml-1">
            https://api-staging.synapse-network.ai
          </code>
        </p>
        {/* Method legend */}
        <div className="flex flex-wrap gap-5 pt-2">
          {(["GET", "POST", "PUT", "DELETE"] as const).map((m) => (
            <div key={m} className="flex items-center gap-2">
              <span
                className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-md font-mono ${METHOD_BG[m] ?? ""}`}
              >
                {m}
              </span>
              <span className="text-[13px] text-[#71767b]">
                {{
                    GET: t("docsPage.apiLegendRead"),
                    POST: t("docsPage.apiLegendCreate"),
                    PUT: t("docsPage.apiLegendUpdate"),
                    DELETE: t("docsPage.apiLegendDelete"),
                  }[m]}
              </span>
            </div>
          ))}
        </div>
        {/* Role legend */}
        <div className="flex flex-wrap gap-3">
          {(
            Object.entries(ROLE_BADGE) as [string, { label: string; cls: string }][]
          ).map(([key, val]) => (
            <span
              key={key}
              className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${val.cls}`}
            >
              {val.label}
            </span>
          ))}
          <span className="text-[11px] text-[#4e535a] self-center">
            — identity that calls the endpoint
          </span>
        </div>
      </div>

      {/* Agent Quickstart */}
      <AgentQuickstart />

      <section className="rounded-2xl border border-[#6eb6f6]/15 bg-[#6eb6f6]/[0.04] p-5">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6eb6f6]">
          {t("docsPage.apiAgentBoundaryEyebrow")}
        </div>
        <h2 className="x-card-title mb-2 text-white">{t("docsPage.apiAgentBoundaryTitle")}</h2>
        <p className="max-w-[820px] text-[13px] leading-6 text-[#8b98a5]">
          {t("docsPage.apiAgentBoundaryDescription")}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {boundaryItems.map((item) => (
            <div key={item} className="rounded-xl border border-white/[0.06] bg-[#08090b] px-3 py-3 text-[12px] leading-6 text-[#9aa4af]">
              {item}
            </div>
          ))}
        </div>
      </section>

      {/* Role Tabs */}
      <div className="space-y-2">
        <p className="text-[11px] text-[#4e535a]">{t("docsPage.apiRoleFilterLabel")}</p>
        <div className="flex gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1 w-fit">
          {(["consumer", "provider"] as const).map((role) => (
            <button
              key={role}
              onClick={() => setViewRole(role)}
              className={`rounded-lg px-4 py-1.5 text-[12px] font-semibold transition-all ${roleBtnCls(
                viewRole === role,
                role,
              )}`}
            >
              {role === "consumer" ? t("docsPage.apiConsumerTab") : t("docsPage.apiProviderTab")}
            </button>
          ))}
        </div>
      </div>

      {/* Endpoint groups */}
      {getGroupsForRole(groups, viewRole).map((group) => (
        <section key={group.id} id={group.id} className="space-y-3">
          <div className="space-y-1">
            <h2 className="x-section-title text-white">{group.title}</h2>
            <p className="x-body-copy">{group.description}</p>
          </div>
          <div className="space-y-2">
            {group.routes.map((route) => (
              <EndpointRow key={route.id} route={route} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
