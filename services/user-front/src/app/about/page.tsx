"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  BadgeDollarSign,
  Bot,
  BookOpen,
  Check,
  CircleDollarSign,
  Database,
  ExternalLink,
  FileCheck2,
  Globe2,
  Network,
  ShieldCheck,
  Wrench,
  Zap,
} from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { getDocsUrl } from "@/utils/docsUrl";

const X_URL = "https://x.com/SynapseNetworkA";

const providerIcons = [Bot, Database, Wrench];
const valueIcons = [ShieldCheck, Zap, Globe2, Network];

function splitTitleBody(value: string): [string, string] {
  const [title, body = ""] = value.split("|");
  return [title, body];
}

export default function AboutPage() {
  const { lang, t, tList } = useLanguage();
  const heroFeatureCards = tList("aboutPage.heroFeatureCards");
  const protocolSteps = tList("aboutPage.protocolSteps");
  const auditChecks = tList("aboutPage.auditChecks");
  const providerTypes = tList("aboutPage.providerTypes");
  const values = tList("aboutPage.values");
  const docsUrl = getDocsUrl();
  const apiReferenceUrl = getDocsUrl("/api-reference");

  return (
    <main className="min-h-[calc(100vh-60px)] overflow-hidden bg-[#020403] text-white">
      <style jsx global>{`
        @keyframes synapseRail {
          0% {
            transform: translateX(0);
            opacity: 0;
          }
          12% {
            opacity: 0.85;
          }
          72% {
            opacity: 0.85;
          }
          100% {
            transform: translateX(620px);
            opacity: 0;
          }
        }
        @keyframes aboutFlowDash {
          0% {
            stroke-dashoffset: 0;
          }
          100% {
            stroke-dashoffset: -88;
          }
        }
        @keyframes aboutGlowPulse {
          0%,
          100% {
            opacity: 0.48;
            transform: scale(0.98);
          }
          50% {
            opacity: 0.9;
            transform: scale(1.02);
          }
        }
      `}</style>
      <section className="relative border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(127,247,190,0.20),transparent_24%),radial-gradient(circle_at_84%_34%,rgba(36,138,255,0.22),transparent_28%),linear-gradient(180deg,#050908_0%,#020403_74%)]" />
        <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(127,247,190,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(127,247,190,0.16)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#020403] to-transparent" />

        <div className="relative mx-auto grid min-h-[500px] max-w-[1536px] gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[0.43fr_0.57fr] lg:px-16 lg:py-8">
          <div className="flex flex-col justify-center">
            <p className="text-xs font-bold uppercase tracking-[0.32em] text-[#7ff7be]">
              {t("aboutPage.eyebrow")}
            </p>
            <HeroTitle lang={lang} title={t("aboutPage.title")} />
            <p className="mt-5 max-w-2xl text-lg leading-8 text-white/62 md:text-xl">
              {t("aboutPage.description")}
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/marketplace"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#7ff7be] px-5 text-sm font-bold text-[#03100a] shadow-[0_18px_50px_rgba(127,247,190,0.24)] transition hover:bg-[#a7ffd1]"
              >
                {t("aboutPage.primaryCta")}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href={docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/14 bg-black/24 px-5 text-sm font-semibold text-white/84 backdrop-blur transition hover:bg-white/[0.06] hover:text-white"
              >
                <BookOpen className="h-4 w-4" />
                {t("aboutPage.secondaryCta")}
              </a>
              <a
                href={X_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#7ff7be]/30 px-5 text-sm font-semibold text-[#dfffee] transition hover:bg-[#7ff7be]/10"
              >
                {t("aboutPage.xCta")}
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>

            <div className="mt-8 grid gap-4 border-t border-white/10 pt-7 md:grid-cols-3">
              {heroFeatureCards.map((item, index) => {
                const [title, body] = splitTitleBody(item);
                const icons = [Zap, CircleDollarSign, Network];
                const Icon = icons[index] ?? Zap;
                return (
                  <div
                    key={item}
                    className="grid grid-cols-[42px_minmax(0,1fr)] gap-3 border-white/10 md:border-r md:pr-4 last:md:border-r-0"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#7ff7be]/22 bg-[#7ff7be]/10 text-[#7ff7be]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold leading-5 text-white">
                        {title}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-white/48">
                        {body}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <HeroNetworkDiagram
            agentLabel={t("aboutPage.agentRailLabel")}
            providerLabel={t("aboutPage.providerRailLabel")}
            collateralLabel={t("aboutPage.collateralLabel")}
            collateralDescription={t("aboutPage.collateralDescription")}
            auditLabel={t("aboutPage.auditLabel")}
            auditChecks={auditChecks}
            providerTypes={providerTypes}
          />
        </div>
      </section>

      <section className="mx-auto max-w-[1536px] px-5 py-7 sm:px-8 lg:px-16">
        <div className="rounded-[10px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.065),rgba(255,255,255,0.018))] p-6 shadow-[0_24px_90px_rgba(0,0,0,0.36)] backdrop-blur md:p-8 lg:grid lg:min-h-[198px] lg:grid-cols-[150px_minmax(0,1fr)] lg:items-center lg:gap-8">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#7ff7be]">
            {t("aboutPage.protocolLabel")}
          </p>
          <div className="mt-8 grid gap-7 lg:mt-0 lg:grid-cols-3">
            {protocolSteps.slice(0, 3).map((step, index) => {
              const labels = ["Collateral", "Gateway", "Settlement"];
              const icons = [ShieldCheck, Zap, FileCheck2];
              const Icon = icons[index] ?? ShieldCheck;
              return (
                <div
                  key={step}
                  className="relative grid grid-cols-[84px_minmax(0,1fr)] gap-5 lg:grid-cols-[96px_minmax(0,1fr)] lg:items-center"
                >
                  {index < 2 ? (
                    <div className="absolute left-[118px] top-1/2 hidden h-px w-[calc(100%-92px)] -translate-y-1/2 bg-gradient-to-r from-[#7ff7be]/50 to-transparent lg:block" />
                  ) : null}
                  <div className="flex h-20 w-20 items-center justify-center rounded-full border border-[#7ff7be]/24 bg-[#7ff7be]/8 text-[#7ff7be] shadow-[0_0_45px_rgba(127,247,190,0.13)] lg:h-24 lg:w-24">
                    <Icon className="h-9 w-9 lg:h-10 lg:w-10" />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#7ff7be]">
                      0{index + 1}
                    </p>
                    <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">
                      {labels[index]}
                    </h2>
                    <p className="mt-3 max-w-sm text-sm leading-6 text-white/56">
                      {step}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1536px] gap-12 px-5 py-14 sm:px-8 lg:grid-cols-[0.32fr_0.36fr_0.32fr] lg:px-16 lg:py-16">
        <div>
          <h2 className="text-3xl font-semibold tracking-[-0.05em] md:text-4xl">
            {t("aboutPage.missionLabel")}
          </h2>
          <div className="mt-5 h-0.5 w-12 bg-[#7ff7be]" />
        </div>
        <p className="text-xl leading-9 text-white/68">
          {t("aboutPage.missionBody")}
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          {values.map((item, index) => {
            const [title, body] = splitTitleBody(item);
            const Icon = valueIcons[index] ?? ShieldCheck;
            return (
              <div key={item}>
                <Icon className="h-8 w-8 text-[#7ff7be]" />
                <p className="mt-4 text-sm font-bold text-white">{title}</p>
                <p className="mt-1 text-sm leading-6 text-white/48">{body}</p>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="border-t border-white/10 px-5 py-8 text-sm text-white/44 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-[1536px] flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Network className="h-6 w-6 text-[#7ff7be]" />
            <span className="font-semibold text-white">SynapseNetwork</span>
            <span className="hidden text-white/30 md:inline">
              © 2026 SynapseNetwork. All rights reserved.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-white"
            >
              Docs
            </a>
            <a
              href={apiReferenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-white"
            >
              API Reference
            </a>
            <a
              href="/forum"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-white"
            >
              Forum
            </a>
            <a
              href={X_URL}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-white"
            >
              X
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

function HeroTitle({ lang, title }: { lang: string; title: string }) {
  if (lang !== "en") {
    return (
      <h1 className="mt-5 max-w-[680px] text-[clamp(2.45rem,2.72vw,2.92rem)] font-semibold leading-[1.18] tracking-[-0.055em]">
        {title}
      </h1>
    );
  }

  return (
    <h1 className="mt-5 max-w-[680px] text-[clamp(2.45rem,2.72vw,2.92rem)] font-semibold leading-[1.18] tracking-[-0.055em]">
      <span className="block">The settlement layer</span>
      <span className="block whitespace-nowrap">
        for the <span className="text-[#7ff7be]">agent economy.</span>
      </span>
    </h1>
  );
}

function HeroNetworkDiagram({
  agentLabel,
  providerLabel,
  collateralLabel,
  collateralDescription,
  auditLabel,
  auditChecks,
  providerTypes,
}: {
  agentLabel: string;
  providerLabel: string;
  collateralLabel: string;
  collateralDescription: string;
  auditLabel: string;
  auditChecks: string[];
  providerTypes: string[];
}) {
  const providerRows = providerTypes.slice(0, 3);
  const leftPaths = [
    "M254 112 C308 112 336 184 398 198",
    "M254 188 C310 188 338 212 398 214",
    "M254 252 C310 252 338 234 398 230",
  ];
  const rightPaths = [
    "M482 198 C544 184 572 112 626 112",
    "M482 214 C542 212 570 188 626 188",
    "M482 230 C542 234 570 252 626 252",
  ];

  return (
    <div className="relative hidden min-h-[500px] origin-top items-center justify-center lg:flex">
      <div className="absolute inset-0 rounded-[42px] bg-[radial-gradient(circle_at_48%_48%,rgba(127,247,190,0.20),transparent_26%),radial-gradient(circle_at_78%_44%,rgba(36,138,255,0.22),transparent_30%),linear-gradient(90deg,rgba(2,12,8,0.94),rgba(3,20,34,0.84))]" />
      <div className="absolute inset-x-5 bottom-7 h-72 skew-y-[-8deg] border-t border-[#7ff7be]/10 bg-[linear-gradient(90deg,rgba(127,247,190,0.10)_1px,transparent_1px),linear-gradient(rgba(36,138,255,0.10)_1px,transparent_1px)] bg-[size:42px_42px] opacity-80 [mask-image:linear-gradient(to_top,black,transparent)]" />
      <div className="absolute left-[34%] top-[31%] h-60 w-60 rounded-full bg-[#7ff7be]/10 blur-3xl motion-safe:animate-[aboutGlowPulse_4.8s_ease-in-out_infinite]" />
      <div className="absolute right-[18%] top-[25%] h-64 w-64 rounded-full bg-[#248cff]/12 blur-3xl motion-safe:animate-[aboutGlowPulse_5.4s_ease-in-out_infinite]" />

      <svg
        className="pointer-events-none absolute inset-0 z-[2] h-full w-full"
        viewBox="0 0 880 430"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="about-left-rail" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#7ff7be" stopOpacity="0.9" />
            <stop offset="0.62" stopColor="#7ff7be" stopOpacity="0.68" />
            <stop offset="1" stopColor="#7ff7be" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="about-right-rail" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#45a4ff" stopOpacity="0.1" />
            <stop offset="0.38" stopColor="#45a4ff" stopOpacity="0.74" />
            <stop offset="1" stopColor="#45a4ff" stopOpacity="0.92" />
          </linearGradient>
          <filter
            id="about-rail-glow"
            x="-20%"
            y="-220%"
            width="140%"
            height="540%"
          >
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {leftPaths.map((path, index) => (
          <g key={`left-${path}`} filter="url(#about-rail-glow)">
            <path
              d={path}
              fill="none"
              stroke="url(#about-left-rail)"
              strokeWidth="2.6"
              strokeLinecap="round"
              opacity="0.82"
            />
            <path
              d={path}
              fill="none"
              stroke="rgba(255,255,255,0.68)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray="18 70"
              style={{
                animation: `aboutFlowDash ${
                  2.8 + index * 0.18
                }s linear infinite`,
              }}
            />
            <circle
              cx={398}
              cy={index === 0 ? 198 : index === 1 ? 214 : 230}
              r="4"
              fill="#7ff7be"
            />
          </g>
        ))}
        {rightPaths.map((path, index) => (
          <g key={`right-${path}`} filter="url(#about-rail-glow)">
            <path
              d={path}
              fill="none"
              stroke="url(#about-right-rail)"
              strokeWidth="2.6"
              strokeLinecap="round"
              opacity="0.86"
            />
            <path
              d={path}
              fill="none"
              stroke="rgba(255,255,255,0.72)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray="18 70"
              style={{
                animation: `aboutFlowDash ${
                  2.65 + index * 0.2
                }s linear infinite reverse`,
              }}
            />
            <circle
              cx={482}
              cy={index === 0 ? 198 : index === 1 ? 214 : 230}
              r="4"
              fill="#45a4ff"
            />
          </g>
        ))}
      </svg>

      <div className="absolute left-0 top-16 z-[3] w-[250px]">
        <p className="mb-4 text-xs font-bold uppercase tracking-[0.24em] text-[#7ff7be]">
          {agentLabel}
        </p>
        {["Agent A", "Agent B", "Agent C"].map((agent) => (
          <RailBox key={agent} className="mb-4" tone="green">
            <Bot className="h-5 w-5" />
            <span>{agent}</span>
          </RailBox>
        ))}
      </div>

      <div className="absolute right-0 top-16 z-[3] w-[250px]">
        <p className="mb-4 text-xs font-bold uppercase tracking-[0.24em] text-[#45a4ff]">
          {providerLabel}
        </p>
        {providerRows.map((item, index) => {
          const [title, body] = splitTitleBody(item);
          const Icon = providerIcons[index] ?? Network;
          return (
            <RailBox key={`${item}-${index}`} className="mb-4" tone="blue">
              <Icon className="h-5 w-5" />
              <span>
                <strong className="block text-white">{title}</strong>
                {body ? (
                  <span className="text-xs text-white/44">{body}</span>
                ) : null}
              </span>
            </RailBox>
          );
        })}
      </div>

      <div className="absolute left-1/2 top-4 z-[4] w-[220px] -translate-x-1/2 rounded-[22px] border border-[#45a4ff]/28 bg-[#09131e]/88 p-4 text-center shadow-[0_0_60px_rgba(69,164,255,0.18)]">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#7ff7be]">
          {collateralLabel}
        </p>
        <p className="mt-1 text-xs text-white/58">{collateralDescription}</p>
        <div className="mt-4 flex justify-center gap-3">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-[#247cff] text-white shadow-[0_0_24px_rgba(36,124,255,0.45)]"
            >
              <BadgeDollarSign className="h-6 w-6" />
            </div>
          ))}
        </div>
      </div>

      <div className="relative z-10 flex h-[170px] w-[230px] items-center justify-center">
        <svg
          viewBox="0 0 240 178"
          className="h-[178px] w-[240px] drop-shadow-[0_0_55px_rgba(127,247,190,0.28)]"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id="stack-top"
              x1="42"
              y1="32"
              x2="198"
              y2="128"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#164a34" stopOpacity="0.98" />
              <stop offset="1" stopColor="#0a2742" stopOpacity="0.98" />
            </linearGradient>
            <linearGradient
              id="stack-side"
              x1="42"
              y1="72"
              x2="198"
              y2="152"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#0d3f2a" stopOpacity="0.72" />
              <stop offset="1" stopColor="#08243d" stopOpacity="0.66" />
            </linearGradient>
            <filter
              id="stack-soft-glow"
              x="-30%"
              y="-40%"
              width="160%"
              height="190%"
            >
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g filter="url(#stack-soft-glow)">
            <path
              d="M120 28 204 66 120 105 36 66Z"
              fill="url(#stack-top)"
              stroke="#96f9c7"
              strokeOpacity="0.7"
              strokeWidth="1.5"
            />
            <path
              d="M36 66 120 105 120 137 36 98Z"
              fill="#0b3d28"
              fillOpacity="0.56"
              stroke="#7ff7be"
              strokeOpacity="0.38"
              strokeWidth="1.2"
            />
            <path
              d="M204 66 120 105 120 137 204 98Z"
              fill="#082840"
              fillOpacity="0.62"
              stroke="#45a4ff"
              strokeOpacity="0.36"
              strokeWidth="1.2"
            />
            <path
              d="M36 98 120 137 204 98"
              fill="none"
              stroke="#7ff7be"
              strokeOpacity="0.45"
              strokeWidth="1.4"
            />
            <path
              d="M36 118 120 157 204 118"
              fill="none"
              stroke="#7ff7be"
              strokeOpacity="0.34"
              strokeWidth="1.4"
            />
            <path
              d="M36 138 120 177 204 138"
              fill="none"
              stroke="#45a4ff"
              strokeOpacity="0.32"
              strokeWidth="1.4"
            />
            <path
              d="M36 98 36 138M120 137 120 177M204 98 204 138"
              stroke="#7ff7be"
              strokeOpacity="0.23"
              strokeWidth="1.1"
            />
            <g
              strokeLinecap="round"
              strokeLinejoin="round"
              transform="translate(72 41) scale(1.5)"
            >
              <path
                d="M32 32 18.5 22.4M31.5 31 18.2 39.4M34 29.5l1.8-14M36 31l12-7.4M36.6 34l13.3 3M33.8 36.4l1.8 14.2"
                stroke="#7ff7be"
                strokeWidth="3.8"
              />
              <path
                d="M30.5 35.4 17.9 49.6M36 29l10-17"
                stroke="#7ff7be"
                strokeOpacity="0.62"
                strokeWidth="3.2"
                strokeDasharray="7 5"
              />
              <path
                d="M18.5 22.4 9.8 13M35.8 15.5l-.2-6.8M35.6 50.6v7.2"
                stroke="#7ff7be"
                strokeWidth="3.2"
              />
              <path
                d="M18.2 39.4 8.9 40.2M48 23.6l7.8-5.8M49.9 37l8.6.8M17.9 49.6l-8.6 5.5"
                stroke="#7ff7be"
                strokeOpacity="0.62"
                strokeWidth="3.2"
              />
              <circle
                cx="32"
                cy="32"
                r="6.2"
                fill="#071c13"
                stroke="#7ff7be"
                strokeWidth="3.8"
              />
              <circle cx="32" cy="32" r="2.1" fill="#7ff7be" />
              <circle
                cx="9.8"
                cy="13"
                r="3.4"
                fill="#071c13"
                stroke="#7ff7be"
                strokeWidth="2.8"
              />
              <circle
                cx="8.9"
                cy="40.2"
                r="3.2"
                fill="#071c13"
                stroke="#7ff7be"
                strokeOpacity="0.66"
                strokeWidth="2.8"
              />
              <circle
                cx="35.6"
                cy="8.7"
                r="3.2"
                fill="#071c13"
                stroke="#7ff7be"
                strokeWidth="2.8"
              />
              <circle
                cx="55.8"
                cy="17.8"
                r="3.2"
                fill="#071c13"
                stroke="#7ff7be"
                strokeOpacity="0.66"
                strokeWidth="2.8"
              />
              <circle
                cx="58.5"
                cy="37.8"
                r="3.2"
                fill="#071c13"
                stroke="#7ff7be"
                strokeOpacity="0.66"
                strokeWidth="2.8"
              />
              <circle
                cx="35.6"
                cy="57.8"
                r="3.2"
                fill="#071c13"
                stroke="#7ff7be"
                strokeWidth="2.8"
              />
              <circle
                cx="9.3"
                cy="55.1"
                r="3.2"
                fill="#071c13"
                stroke="#7ff7be"
                strokeOpacity="0.66"
                strokeWidth="2.8"
              />
              <circle
                cx="46"
                cy="12"
                r="3.2"
                fill="#071c13"
                stroke="#7ff7be"
                strokeOpacity="0.66"
                strokeWidth="2.8"
              />
            </g>
          </g>
        </svg>
      </div>

      <div className="absolute bottom-0 left-1/2 z-[3] w-[300px] -translate-x-1/2 rounded-[22px] border border-[#7ff7be]/30 bg-[#07130e]/94 p-5 shadow-[0_0_70px_rgba(127,247,190,0.18),inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-md">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#7ff7be]">
          {auditLabel}
        </p>
        <div className="mt-3 space-y-2">
          {auditChecks.map((check) => (
            <p
              key={check}
              className="flex items-center gap-2 text-xs text-white/70"
            >
              <Check className="h-3.5 w-3.5 text-[#7ff7be]" />
              {check}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function RailBox({
  children,
  className = "",
  tone,
  style,
}: {
  children: ReactNode;
  className?: string;
  tone: "green" | "blue";
  style?: CSSProperties;
}) {
  const toneClass =
    tone === "green"
      ? "border-[#7ff7be]/22 bg-[#07140f]/86 shadow-[0_0_28px_rgba(127,247,190,0.08)]"
      : "border-[#45a4ff]/24 bg-[#07101a]/86 shadow-[0_0_28px_rgba(69,164,255,0.08)]";

  return (
    <div
      className={`flex min-h-14 items-center gap-3 rounded-xl border px-4 text-sm font-semibold text-white/86 backdrop-blur ${toneClass} ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
