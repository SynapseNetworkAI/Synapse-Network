"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Check,
  CircleDollarSign,
  FileText,
  KeyRound,
  Network,
  ShieldCheck,
} from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { getDocsUrl } from "@/utils/docsUrl";

type PageMode = "overview" | "api";

type SplitPair = [string, string];
type ComparisonRow = [string, string, string, string];

function splitPair(value: string): SplitPair {
  const [title, body = ""] = value.split("|");
  return [title, body];
}

function splitComparison(value: string): ComparisonRow {
  const [name, best = "", limit = "", difference = ""] = value.split("|");
  return [name, best, limit, difference];
}

export function AiAgentPaymentsLanding({ mode }: Readonly<{ mode: PageMode }>) {
  const { t, tList } = useLanguage();
  const isApi = mode === "api";
  const title = isApi
    ? t("aiAgentPaymentsPage.apiTitle")
    : t("aiAgentPaymentsPage.overviewTitle");
  const description = isApi
    ? t("aiAgentPaymentsPage.apiDescription")
    : t("aiAgentPaymentsPage.overviewDescription");
  const docsUrl = getDocsUrl(
    isApi ? "/ai-agent-payments/agent-payment-api" : "/ai-agent-payments",
  );
  const flowSteps = tList("aiAgentPaymentsPage.flowSteps").map(splitPair);
  const facts = tList("aiAgentPaymentsPage.facts").map(splitPair);
  const paths = tList("aiAgentPaymentsPage.paths").map(splitPair);
  const apiRows = tList("aiAgentPaymentsPage.apiRows").map(splitPair);
  const apiRules = tList("aiAgentPaymentsPage.apiRules");
  const comparisons = tList("aiAgentPaymentsPage.comparisonRows").map(
    splitComparison,
  );
  const faqItems = tList("aiAgentPaymentsPage.faqItems").map(splitPair);

  return (
    <main className="min-h-screen overflow-hidden bg-[#020403] text-white">
      <PaymentRailAnimations />
      <HeroSection
        description={description}
        docsUrl={docsUrl}
        eyebrow={t("aiAgentPaymentsPage.heroEyebrow")}
        flowBody={t("aiAgentPaymentsPage.flowBody")}
        flowSteps={flowSteps}
        primaryCta={t("aiAgentPaymentsPage.primaryCta")}
        secondaryCta={t("aiAgentPaymentsPage.secondaryCta")}
        title={title}
      />
      <DefinitionSection
        body={t("aiAgentPaymentsPage.definitionBody")}
        title={t("aiAgentPaymentsPage.definitionTitle")}
      />
      <FactsSection facts={facts} title={t("aiAgentPaymentsPage.factsTitle")} />
      <FlowSection steps={flowSteps} />
      <UseCaseSection
        rows={isApi ? apiRows : paths}
        title={
          isApi
            ? t("aiAgentPaymentsPage.apiSectionTitle")
            : t("aiAgentPaymentsPage.pathsTitle")
        }
      />
      {isApi ? (
        <ApiRulesSection
          rules={apiRules}
          title={t("aiAgentPaymentsPage.apiRulesTitle")}
        />
      ) : (
        <ComparisonTable
          title={t("aiAgentPaymentsPage.comparisonTitle")}
          rows={comparisons}
        />
      )}
      <FaqSection items={faqItems} title={t("aiAgentPaymentsPage.faqTitle")} />
      <FinalCtaSection
        description={t("aiAgentPaymentsPage.finalDescription")}
        title={t("aiAgentPaymentsPage.finalTitle")}
      />
    </main>
  );
}

function PaymentRailAnimations() {
  return (
    <style jsx global>{`
      @keyframes paymentRailMove {
        0% {
          transform: translateX(-18%);
          opacity: 0;
        }
        16%,
        78% {
          opacity: 0.9;
        }
        100% {
          transform: translateX(118%);
          opacity: 0;
        }
      }
      @keyframes paymentNodePulse {
        0%,
        100% {
          transform: scale(1);
          opacity: 0.56;
        }
        50% {
          transform: scale(1.06);
          opacity: 1;
        }
      }
    `}</style>
  );
}

function HeroSection({
  description,
  docsUrl,
  eyebrow,
  flowBody,
  flowSteps,
  primaryCta,
  secondaryCta,
  title,
}: Readonly<{
  description: string;
  docsUrl: string;
  eyebrow: string;
  flowBody: string;
  flowSteps: SplitPair[];
  primaryCta: string;
  secondaryCta: string;
  title: string;
}>) {
  return (
    <section className="relative border-b border-white/10">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#07100c_0%,#020403_82%)]" />
      <div className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(127,247,190,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(127,247,190,0.16)_1px,transparent_1px)] [background-size:72px_72px]" />
      <div className="relative mx-auto grid min-h-[calc(100svh-76px)] max-w-[1480px] gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[0.52fr_0.48fr] lg:px-16">
        <div className="flex flex-col justify-center">
          <p className="text-xs font-bold uppercase tracking-[0.34em] text-[#7ff7be]">
            {eyebrow}
          </p>
          <h1 className="mt-5 max-w-4xl text-[clamp(2.45rem,6vw,5.8rem)] font-black leading-[0.95] tracking-[-0.07em] text-white">
            {title}
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-white/66 md:text-xl">
            {description}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/marketplace"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#7ff7be] px-5 text-sm font-bold text-[#03100a] shadow-[0_18px_50px_rgba(127,247,190,0.2)] transition hover:bg-[#a7ffd1]"
            >
              {primaryCta}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/14 bg-black/28 px-5 text-sm font-semibold text-white/86 backdrop-blur transition hover:bg-white/[0.06] hover:text-white"
            >
              <BookOpen className="h-4 w-4" />
              {secondaryCta}
            </a>
          </div>
        </div>
        <PaymentRail flowBody={flowBody} flowSteps={flowSteps} />
      </div>
    </section>
  );
}

function PaymentRail({
  flowBody,
  flowSteps,
}: Readonly<{ flowBody: string; flowSteps: SplitPair[] }>) {
  const icons = [CircleDollarSign, KeyRound, Network, FileText];
  return (
    <div className="relative flex items-center">
      <div className="relative w-full overflow-hidden rounded-[8px] border border-white/10 bg-black/40 p-5 shadow-[0_28px_100px_rgba(0,0,0,0.42)]">
        <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#7ff7be]">
              settlement rail
            </p>
            <p className="mt-2 text-sm text-white/54">
              USDC budget {"->"} credential {"->"} paid service {"->"} receipt
            </p>
          </div>
          <CircleDollarSign className="h-8 w-8 text-[#7ff7be]" />
        </div>
        <div className="relative py-8">
          <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-white/14" />
          <div className="absolute left-0 top-1/2 h-[3px] w-28 -translate-y-1/2 bg-[#7ff7be] shadow-[0_0_32px_rgba(127,247,190,0.8)] [animation:paymentRailMove_3.8s_ease-in-out_infinite]" />
          <div className="relative grid grid-cols-4 gap-4">
            {flowSteps.map(([stepTitle], index) => {
              const Icon = icons[index] ?? Check;
              return (
                <div
                  key={stepTitle}
                  className="flex flex-col items-center gap-3"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[#7ff7be]/30 bg-[#07150f] text-[#7ff7be] [animation:paymentNodePulse_3.4s_ease-in-out_infinite]">
                    <Icon className="h-6 w-6" />
                  </div>
                  <p className="text-center text-xs font-bold uppercase tracking-[0.18em] text-white/70">
                    {stepTitle}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
        <p className="border-t border-white/10 pt-4 text-sm leading-6 text-white/54">
          {flowBody}
        </p>
      </div>
    </div>
  );
}

function DefinitionSection({
  body,
  title,
}: Readonly<{ body: string; title: string }>) {
  return (
    <section className="mx-auto grid max-w-[1480px] gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[0.36fr_0.64fr] lg:px-16">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#7ff7be]">
          definition
        </p>
        <h2 className="mt-4 text-3xl font-bold tracking-[-0.05em] md:text-5xl">
          {title}
        </h2>
      </div>
      <p className="text-xl leading-9 text-white/70">{body}</p>
    </section>
  );
}

function FactsSection({
  facts,
  title,
}: Readonly<{ facts: SplitPair[]; title: string }>) {
  return (
    <section className="mx-auto max-w-[1480px] px-5 py-10 sm:px-8 lg:px-16">
      <h2 className="text-3xl font-bold tracking-[-0.05em] text-white md:text-4xl">
        {title}
      </h2>
      <div className="mt-7 overflow-hidden rounded-[8px] border border-white/10">
        {facts.map(([label, body]) => (
          <div
            key={label}
            className="grid gap-3 border-b border-white/10 bg-white/[0.025] px-5 py-4 last:border-b-0 md:grid-cols-[240px_minmax(0,1fr)]"
          >
            <p className="font-semibold text-white">{label}</p>
            <p className="leading-7 text-white/62">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FlowSection({ steps }: Readonly<{ steps: SplitPair[] }>) {
  return (
    <section className="mx-auto grid max-w-[1480px] gap-8 px-5 py-12 sm:px-8 lg:grid-cols-4 lg:px-16">
      {steps.map(([stepTitle, stepBody], index) => (
        <div key={stepTitle} className="border-l border-[#7ff7be]/28 pl-5">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#7ff7be]">
            0{index + 1}
          </p>
          <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">
            {stepTitle}
          </h3>
          <p className="mt-3 leading-7 text-white/58">{stepBody}</p>
        </div>
      ))}
    </section>
  );
}

function UseCaseSection({
  rows,
  title,
}: Readonly<{ rows: SplitPair[]; title: string }>) {
  return (
    <section className="mx-auto max-w-[1480px] px-5 py-12 sm:px-8 lg:px-16">
      <div className="grid gap-10 lg:grid-cols-[0.35fr_0.65fr]">
        <h2 className="text-3xl font-bold tracking-[-0.05em] md:text-4xl">
          {title}
        </h2>
        <div className="grid gap-5">
          {rows.map(([itemTitle, itemBody]) => (
            <div key={itemTitle} className="border-b border-white/10 pb-5">
              <h3 className="text-xl font-semibold text-white">{itemTitle}</h3>
              <p className="mt-2 leading-7 text-white/58">{itemBody}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ApiRulesSection({
  rules,
  title,
}: Readonly<{ rules: string[]; title: string }>) {
  return (
    <section className="mx-auto max-w-[1480px] px-5 py-12 sm:px-8 lg:px-16">
      <div className="rounded-[8px] border border-[#7ff7be]/20 bg-[#07100c] p-6 md:p-8">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-7 w-7 text-[#7ff7be]" />
          <h2 className="text-2xl font-bold tracking-[-0.04em]">{title}</h2>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {rules.map((rule) => (
            <div
              key={rule}
              className="flex gap-3 text-sm leading-6 text-white/68"
            >
              <Check className="mt-1 h-4 w-4 shrink-0 text-[#7ff7be]" />
              <span>{rule}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqSection({
  items,
  title,
}: Readonly<{ items: SplitPair[]; title: string }>) {
  return (
    <section className="mx-auto max-w-[1480px] px-5 py-16 sm:px-8 lg:px-16">
      <h2 className="text-3xl font-bold tracking-[-0.05em] md:text-4xl">
        {title}
      </h2>
      <div className="mt-8 grid gap-8 md:grid-cols-2">
        {items.map(([question, answer]) => (
          <div key={question}>
            <h3 className="text-xl font-semibold text-[#7ff7be]">{question}</h3>
            <p className="mt-3 leading-7 text-white/62">{answer}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalCtaSection({
  description,
  title,
}: Readonly<{ description: string; title: string }>) {
  return (
    <section className="border-t border-white/10 px-5 py-16 sm:px-8 lg:px-16">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="max-w-3xl text-4xl font-black tracking-[-0.06em] md:text-6xl">
            {title}
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-white/60">
            {description}
          </p>
        </div>
        <Link
          href="/dashboard/discovery"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-bold text-black transition hover:bg-[#7ff7be]"
        >
          Discovery
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function ComparisonTable({
  title,
  rows,
}: Readonly<{ title: string; rows: ComparisonRow[] }>) {
  return (
    <section className="mx-auto max-w-[1480px] px-5 py-12 sm:px-8 lg:px-16">
      <h2 className="text-3xl font-bold tracking-[-0.05em] md:text-4xl">
        {title}
      </h2>
      <div className="mt-7 overflow-x-auto rounded-[8px] border border-white/10">
        <table className="min-w-[920px] w-full border-collapse text-left">
          <thead>
            <tr className="bg-white/[0.06] text-sm uppercase tracking-[0.16em] text-white/70">
              <th className="px-4 py-4">Option</th>
              <th className="px-4 py-4">Best fit</th>
              <th className="px-4 py-4">Limitation</th>
              <th className="px-4 py-4">Synapse difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, best, limit, difference]) => (
              <tr key={name} className="border-t border-white/10 align-top">
                <td className="px-4 py-5 font-semibold text-white">{name}</td>
                <td className="px-4 py-5 leading-7 text-white/62">{best}</td>
                <td className="px-4 py-5 leading-7 text-white/62">{limit}</td>
                <td className="px-4 py-5 leading-7 text-white/62">
                  {difference}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
