"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { CodeBlock } from "../components/CodeBlock";
import { useActiveSection } from "../use-active-section";
import { useDocsPageNav } from "../use-docs-page-nav";

const PAGE_SECTIONS = [
  "settlement",
  "service-registry",
  "llm-billing",
  "credentials",
  "idempotency",
];

export default function ConceptsPage() {
  const router = useRouter();
  const { t, tList } = useLanguage();
  useActiveSection(PAGE_SECTIONS, "settlement");
  const settlementLabels = tList("docsPage.conceptsSettlementLabels");
  const settlementDescriptions = tList(
    "docsPage.conceptsSettlementDescriptions"
  );
  const registryLabels = tList("docsPage.conceptsRegistryLabels");
  const registryDescriptions = tList("docsPage.conceptsRegistryDescriptions");
  const llmRules = tList("docsPage.conceptsLlmRules");
  const credentialLabels = tList("docsPage.conceptsCredentialsLabels");
  const credentialDescriptions = tList(
    "docsPage.conceptsCredentialsDescriptions"
  );
  const idempotencyCardTitles = tList("docsPage.conceptsIdempotencyCardTitles");
  const idempotencyCardDescriptions = tList(
    "docsPage.conceptsIdempotencyCardDescriptions"
  );
  const nextLabels = tList("docsPage.conceptsNextLabels");
  const nextDescriptions = tList("docsPage.conceptsNextDescriptions");
  useDocsPageNav([
    { id: "settlement", label: t("docsPage.conceptsSettlementTitle") },
    { id: "service-registry", label: t("docsPage.conceptsRegistryTitle") },
    { id: "llm-billing", label: t("docsPage.conceptsLlmTitle") },
    { id: "credentials", label: t("docsPage.conceptsCredentialsTitle") },
    { id: "idempotency", label: t("docsPage.conceptsIdempotencyTitle") },
  ]);

  return (
    <div className="space-y-20">
      {/* Page header */}
      <div className="space-y-2 border-b border-white/[0.06] pb-8">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
          {t("docsPage.conceptsEyebrow")}
        </span>
        <h1 className="x-page-title text-white">
          {t("docsPage.conceptsTitle")}
        </h1>
        <p className="x-body-copy max-w-[560px]">
          {t("docsPage.conceptsDescription")}
        </p>
      </div>

      {/* ── How Settlement Works ────────────────────────────────── */}
      <section id="settlement" className="space-y-6">
        <h2 className="x-section-title text-white">
          {t("docsPage.conceptsSettlementTitle")}
        </h2>
        <p className="x-body-copy">
          {t("docsPage.conceptsSettlementDescription")}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {settlementLabels.map((label, index) => (
            <div key={label} className="x-panel-muted rounded-xl p-5">
              <div className="x-card-title text-[#c0c5cc] mb-2">{label}</div>
              <p className="text-[13px] text-[#71767b] leading-relaxed">
                {settlementDescriptions[index] ?? ""}
              </p>
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
            {`                    ↳ ${t("docsPage.conceptsFlowAtomic")}`}
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
        <h2 className="x-section-title text-white">
          {t("docsPage.conceptsRegistryTitle")}
        </h2>
        <p className="x-body-copy">
          {t("docsPage.conceptsRegistryDescription")}{" "}
          <code className="text-[#7ff7be] font-mono text-[12px] bg-[#7ff7be]/8 px-1.5 py-0.5 rounded">
            /discover
          </code>{" "}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {registryLabels.map((title, index) => (
            <div key={title} className="x-panel-muted rounded-xl p-4">
              <div className="text-[13px] font-semibold text-[#c0c5cc] mb-1">
                {title}
              </div>
              <p className="text-[13px] text-[#71767b]">
                {registryDescriptions[index] ?? ""}
              </p>
            </div>
          ))}
        </div>

        <CodeBlock
          lang="bash"
          code={`
# 发现可用服务
GET /api/v1/services/discover?tag=llm&limit=20

# 响应
{
  "services": [
    {
      "serviceId": "svc_deepseek_chat",
      "name": "DeepSeek Chat",
      "serviceKind": "llm",
      "priceModel": "token_metered",
      "inputPricePer1MTokensUsdc": "0.140000",
      "outputPricePer1MTokensUsdc": "0.280000",
      "defaultMaxOutputTokens": 2048,
      "maxAutoHoldUsdc": "0.050000",
      "status": "healthy",
      "tags": ["llm", "inference"]
    }
  ]
}
        `}
        />
      </section>

      <section id="llm-billing" className="space-y-4">
        <h2 className="x-section-title text-white">
          {t("docsPage.conceptsLlmTitle")}
        </h2>
        <p className="x-body-copy">{t("docsPage.conceptsLlmDescription")}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {llmRules.map((rule) => (
            <div
              key={rule}
              className="x-panel-muted rounded-xl p-4 text-[13px] leading-6 text-[#9aa4af]"
            >
              {rule}
            </div>
          ))}
        </div>
        <CodeBlock
          lang="typescript"
          code={`
await client.invokeLlm("svc_deepseek_chat", {
  model: "deepseek-chat",
  messages: [{ role: "user", content: "Summarize this document." }],
  max_tokens: 512,
}, {
  // Optional. If omitted, Gateway computes an automatic pre-auth hold.
  maxCostUsdc: "0.010000",
});
        `}
        />
      </section>

      {/* ── Agent Credentials ───────────────────────────────────── */}
      <section id="credentials" className="space-y-4">
        <h2 className="x-section-title text-white">
          {t("docsPage.conceptsCredentialsTitle")}
        </h2>
        <p className="x-body-copy">
          {t("docsPage.conceptsCredentialsDescription")}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {credentialLabels.map((title, index) => (
            <div key={title} className="x-panel-muted rounded-xl p-4">
              <div className="text-[13px] font-semibold text-[#c0c5cc] mb-1">
                {title}
              </div>
              <p className="text-[13px] text-[#71767b]">
                {credentialDescriptions[index] ?? ""}
              </p>
            </div>
          ))}
        </div>

        <CodeBlock
          lang="http"
          code={`
POST /api/v1/credentials/agent/issue
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "name": "my-agent-bot",
  "creditLimit": 5.00,
  "resetInterval": "daily",
  "maxCalls": 200
}

→ 200
{
  "agentToken": "agt_xxxxx...",
  "credentialId": "cred_uuid",
  "creditLimit": "5.00",
  "resetInterval": "daily"
}
        `}
        />
      </section>

      {/* ── Idempotency ─────────────────────────────────────────── */}
      <section id="idempotency" className="space-y-4">
        <h2 className="x-section-title text-white">
          {t("docsPage.conceptsIdempotencyTitle")}
        </h2>
        <p className="x-body-copy">
          {t("docsPage.conceptsIdempotencyDescription")}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="x-panel-muted rounded-xl p-5 space-y-2">
            <div className="text-[13px] font-semibold text-[#c0c5cc]">
              {idempotencyCardTitles[0]}
            </div>
            <p className="text-[13px] text-[#71767b]">
              {idempotencyCardDescriptions[0]}{" "}
              <code className="text-[#c0c5cc] font-mono text-[12px]">
                X-Idempotency-Key
              </code>
            </p>
          </div>
          <div className="x-panel-muted rounded-xl p-5 space-y-2">
            <div className="text-[13px] font-semibold text-[#c0c5cc]">
              {idempotencyCardTitles[1]}
            </div>
            <p className="text-[13px] text-[#71767b]">
              {idempotencyCardDescriptions[1]}{" "}
              <code className="text-[#c0c5cc] font-mono text-[12px]">
                idempotencyKey
              </code>{" "}
            </p>
          </div>
        </div>

        <div className="x-panel-muted rounded-xl p-4 flex gap-3">
          <span className="text-[#7ff7be] mt-0.5 shrink-0">💡</span>
          <p className="text-[13px] text-[#71767b] leading-relaxed">
            {t("docsPage.conceptsIdempotencyTip")}
          </p>
        </div>
      </section>

      {/* Next */}
      <section className="border-t border-white/[0.06] pt-10">
        <h3 className="x-card-title text-white mb-4">
          {t("docsPage.conceptsNextTitle")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            {
              label: nextLabels[0],
              desc: nextDescriptions[0],
              href: "/docs/api-reference",
            },
            {
              label: nextLabels[1],
              desc: nextDescriptions[1],
              href: "/docs/contracts",
            },
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
