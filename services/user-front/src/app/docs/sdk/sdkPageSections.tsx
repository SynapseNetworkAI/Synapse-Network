import { useState } from "react";
import { Braces, ExternalLink } from "lucide-react";
import { CodeBlock } from "../components/CodeBlock";
import { StatusBadge } from "../components/StatusBadge";
import { buildSdkSnippets, SDK_GITHUB_ROOT } from "./sdkSnippetExamples";

const STAGING_DOC_LINKS = [
  "https://staging.synapse-network.ai/docs/sdk",
  "https://staging.synapse-network.ai/docs/sdk/python",
  "https://staging.synapse-network.ai/docs/sdk/typescript",
];

type Translate = (key: string) => string;

type CompareColumn = {
  label: string;
  values: string[];
};

const SNIPPET_LABELS = ["TypeScript", "Python", "Go", "Java/JVM", ".NET"];
const COMPARE_ROWS = [
  "Agent discovery / search",
  "Fixed-price API invoke",
  "Token-metered LLM invoke",
  "Invocation receipt lookup",
  "Owner auth + Agent Keys",
  "Balance / deposit helpers",
  "Usage / finance reads",
  "Provider publishing lifecycle",
  "Provider earnings / withdrawals",
];

export function OverviewSection({ t }: Readonly<{ t: Translate }>) {
  return (
    <section
      id="sdk-overview"
      className="space-y-5 border-b border-white/[0.06] pb-8"
    >
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
          {t("docsPage.sdkEyebrow")}
        </span>
        <StatusBadge status="PREVIEW" />
      </div>
      <h1 className="x-page-title text-white">{t("docsPage.sdkTitle")}</h1>
      <p className="x-body-copy max-w-[640px]">
        {t("docsPage.sdkDescription")}
      </p>
    </section>
  );
}

export function SnippetSection({ t }: Readonly<{ t: Translate }>) {
  const snippets = buildSdkSnippets(SNIPPET_LABELS);
  const [activeSnippet, setActiveSnippet] = useState("typescript");
  const selectedSnippet =
    snippets.find((snippet) => snippet.id === activeSnippet) ?? snippets[0];

  return (
    <section
      id="sdk-snippets"
      className="space-y-4 rounded-3xl border border-[#7ff7be]/15 bg-[#7ff7be]/[0.03] p-5"
    >
      <SnippetHeader
        t={t}
        snippets={snippets}
        active={activeSnippet}
        onSelect={setActiveSnippet}
      />
      <CodeBlock lang={selectedSnippet.lang} code={selectedSnippet.code} />
      {selectedSnippet.guideUrl ? (
        <a
          href={selectedSnippet.guideUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#7ff7be]"
        >
          Need more details? Explore the {selectedSnippet.guideLabel}
          <ExternalLink size={14} />
        </a>
      ) : null}
    </section>
  );
}

export function QuickstartSection({
  t,
  steps,
}: Readonly<{ t: Translate; steps: string[] }>) {
  return (
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <div className="rounded-2xl border border-[#6eb6f6]/20 bg-[#6eb6f6]/[0.05] p-6">
        <h2 className="x-section-title text-white">
          {t("docsPage.sdkAgentQuickstartTitle")}
        </h2>
        <p className="mt-2 text-[14px] leading-7 text-[#8b98a5]">
          {t("docsPage.sdkAgentQuickstartDescription")}
        </p>
        <ol className="mt-5 space-y-3">
          {steps.map((step, index) => (
            <li
              key={step}
              className="flex gap-3 text-[13px] leading-6 text-[#c8d0d8]"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#6eb6f6]/15 text-[11px] font-semibold text-[#6eb6f6]">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="rounded-2xl border border-white/[0.06] bg-[#0a0b0d] p-6">
        <h2 className="x-section-title text-white">
          {t("docsPage.sdkAdvancedOwnerTitle")}
        </h2>
        <p className="mt-2 text-[14px] leading-7 text-[#8b98a5]">
          {t("docsPage.sdkAdvancedOwnerDescription")}
        </p>
      </div>
    </section>
  );
}

export function StagingDocsSection({
  t,
  labels,
}: Readonly<{ t: Translate; labels: string[] }>) {
  return (
    <section
      id="sdk-staging-docs"
      className="space-y-5 rounded-2xl border border-[#7ff7be]/20 bg-[#7ff7be]/[0.05] p-6"
    >
      <div className="space-y-2">
        <h2 className="x-section-title text-white">
          {t("docsPage.sdkStagingDocsTitle")}
        </h2>
        <p className="x-body-copy max-w-[760px]">
          {t("docsPage.sdkStagingDocsDescription")}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {STAGING_DOC_LINKS.map((href, index) => (
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-white/[0.08] bg-[#0a0b0d] px-4 py-3 text-[13px] font-semibold text-[#7ff7be] transition hover:border-[#7ff7be]/50"
          >
            {labels[index] ?? href}
          </a>
        ))}
      </div>
      <p className="text-[12px] leading-6 text-[#8b98a5]">
        {t("docsPage.sdkStagingDocsProdReserved")}
      </p>
    </section>
  );
}

export function CapabilityCoverageSection({
  t,
  sdkLabels,
}: Readonly<{ t: Translate; sdkLabels: string[] }>) {
  const columns = buildCompareColumns(sdkLabels);

  return (
    <section id="sdk-compare" className="space-y-5">
      <CoverageHeader t={t} />
      <div className="overflow-x-auto rounded-2xl border border-white/[0.06] bg-[#0a0b0d]">
        <table className="w-full min-w-[780px] text-left">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02]">
              <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">
                Capability
              </th>
              {columns.map((column) => (
                <th
                  key={column.label}
                  className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map((row, index) => (
              <tr
                key={row}
                className="border-b border-white/[0.04] last:border-b-0"
              >
                <td className="px-4 py-3 text-[13px] text-white">{row}</td>
                {columns.map((column) => (
                  <td
                    key={column.label}
                    className="px-4 py-3 text-[13px] text-[#8b98a5]"
                  >
                    {column.values[index] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SnippetHeader({
  t,
  snippets,
  active,
  onSelect,
}: Readonly<{
  t: Translate;
  snippets: ReturnType<typeof buildSdkSnippets>;
  active: string;
  onSelect: (id: string) => void;
}>) {
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#7ff7be]/20 bg-[#7ff7be]/10">
          <Braces size={18} className="text-[#7ff7be]" />
        </div>
        <div>
          <h2 className="x-section-title text-white">
            {t("docsPage.sdkSnippetTitle")}
          </h2>
          <p className="mt-1 max-w-[680px] text-[14px] leading-6 text-[#8b98a5]">
            {t("docsPage.sdkSnippetDescription")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {snippets.map((snippet) => (
          <SnippetTab
            key={snippet.id}
            label={snippet.label}
            active={snippet.id === active}
            onClick={() => onSelect(snippet.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SnippetTab({
  label,
  active,
  onClick,
}: Readonly<{ label: string; active: boolean; onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold transition ${
        active
          ? "border-[#7ff7be]/60 bg-[#7ff7be]/15 text-[#7ff7be]"
          : "border-white/[0.08] bg-[#0a0b0d] text-[#8b98a5] hover:border-white/20 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function CoverageHeader({ t }: Readonly<{ t: Translate }>) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        <h2 className="x-section-title text-white">
          {t("docsPage.sdkCompareTitle")}
        </h2>
        <p className="x-body-copy max-w-[680px]">
          {t("docsPage.sdkCompareDescription")}
        </p>
      </div>
      <a
        href={`${SDK_GITHUB_ROOT}/docs/sdk/api-parity-matrix.md`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#7ff7be]"
      >
        {t("docsPage.sdkCompareParityCta")}
        <ExternalLink size={14} aria-hidden="true" />
      </a>
    </div>
  );
}

function buildCompareColumns(labels: string[]): CompareColumn[] {
  const values = COMPARE_ROWS.map(() => "supported");
  return labels.map((label) => ({ label, values }));
}
