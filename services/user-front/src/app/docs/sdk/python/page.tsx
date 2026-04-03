"use client";

import {
  ArrowRight,
  BadgeCheck,
  Binary,
  Coins,
  KeyRound,
  Radar,
  ReceiptText,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { CodeBlock } from "../../components/CodeBlock";
import { StatusBadge } from "../../components/StatusBadge";
import { useActiveSection } from "../../use-active-section";
import { useDocsPageNav } from "../../use-docs-page-nav";

const PAGE_SECTIONS = ["sdk-py"];

const FLOW_ICONS = [
  WalletCards,
  Coins,
  KeyRound,
  Radar,
  ReceiptText,
] as const;

export default function PythonSdkPage() {
  const { t, tList } = useLanguage();
  useActiveSection(PAGE_SECTIONS, "sdk-py");
  useDocsPageNav([
    { id: "sdk-py", label: t("docsPage.sdkPyTitle") },
    { id: "py-runbook", label: t("docsPage.sdkPyRunbookTitle") },
    { id: "py-verify", label: t("docsPage.sdkPyVerifyTitle") },
  ]);

  const signalTitles = tList("docsPage.sdkPySignalTitles");
  const signalValues = tList("docsPage.sdkPySignalValues");
  const capabilityTitles = tList("docsPage.sdkPyCapabilityTitles");
  const capabilityDescriptions = tList("docsPage.sdkPyCapabilityDescriptions");
  const flowTags = tList("docsPage.sdkPyFlowStepTags");
  const flowTitles = tList("docsPage.sdkPyFlowStepTitles");
  const flowDescriptions = tList("docsPage.sdkPyFlowStepDescriptions");
  const verificationChecks = tList("docsPage.sdkPyVerificationChecks");

  return (
    <div className="space-y-16">
      <section
        id="sdk-py"
        className="relative overflow-hidden rounded-[28px] border border-white/[0.06] bg-[radial-gradient(circle_at_top_left,rgba(127,247,190,0.14),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(110,182,246,0.10),transparent_24%),linear-gradient(180deg,#0d1012_0%,#07080a_100%)] px-6 py-7 md:px-8 md:py-8"
      >
        <div className="pointer-events-none absolute inset-y-0 right-[18%] w-px bg-gradient-to-b from-white/0 via-white/[0.1] to-white/0" />
        <div className="pointer-events-none absolute inset-x-[12%] top-0 h-px bg-gradient-to-r from-white/0 via-white/[0.08] to-white/0" />

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.15fr)_360px]">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4e535a]">
                {t("docsPage.sdkEyebrow")}
              </span>
              <StatusBadge status="GA" />
              <span className="inline-flex items-center gap-1 rounded-full border border-[#7ff7be]/20 bg-[#7ff7be]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7ff7be]">
                <ShieldCheck size={12} />
                {t("docsPage.sdkPyHeroSignal")}
              </span>
            </div>

            <div className="space-y-4">
              <h1 className="max-w-[12ch] text-[46px] font-semibold tracking-[-0.045em] text-white sm:text-[56px] sm:leading-[1.02]">
                {t("docsPage.sdkPyHeroTitle")}
              </h1>
              <p className="max-w-[680px] text-[16px] leading-8 text-[#9aa4af]">
                {t("docsPage.sdkPyHeroDescription")}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href="#py-runbook"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-[14px] font-semibold text-[#0f1419] transition-colors hover:bg-[#e7e9ea]"
              >
                {t("docsPage.sdkPyHeroPrimaryCta")}
                <ArrowRight size={15} />
              </a>
              <a
                href="#py-verify"
                className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 py-3 text-[14px] font-semibold text-[#d7dbdf] transition-colors hover:border-white/[0.14] hover:bg-white/[0.05]"
              >
                {t("docsPage.sdkPyHeroSecondaryCta")}
              </a>
            </div>
          </div>

          <div className="relative">
            <div className="rounded-[24px] border border-white/[0.08] bg-[#0a0c0e]/90 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4e535a]">
                    {t("docsPage.sdkPySignalLabel")}
                  </div>
                  <div className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-white">
                    {t("docsPage.sdkPySignalTitle")}
                  </div>
                </div>
                <div className="rounded-full border border-[#7ff7be]/20 bg-[#7ff7be]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7ff7be]">
                  Live
                </div>
              </div>

              <div className="space-y-3">
                {signalTitles.map((title, index) => (
                  <div
                    key={title}
                    className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">
                      {title}
                    </div>
                    <div className="mt-1 text-[15px] font-semibold tracking-[-0.02em] text-[#e7e9ea]">
                      {signalValues[index] ?? ""}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-[#6eb6f6]/16 bg-[#6eb6f6]/[0.05] px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6eb6f6]">
                  <Binary size={13} />
                  {t("docsPage.sdkPySignalFootnoteLabel")}
                </div>
                <p className="mt-2 text-[13px] leading-6 text-[#9aa4af]">
                  {t("docsPage.sdkPySignalFootnote")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {capabilityTitles.map((title, index) => (
          <div
            key={title}
            className="rounded-[22px] border border-white/[0.06] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-6 transition-colors hover:border-white/[0.1]"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#7ff7be]/20 bg-[#7ff7be]/10">
                <BadgeCheck size={16} className="text-[#7ff7be]" />
              </div>
              <div className="text-[17px] font-semibold tracking-[-0.02em] text-white">
                {title}
              </div>
            </div>
            <p className="mt-4 text-[14px] leading-7 text-[#8b98a5]">
              {capabilityDescriptions[index] ?? ""}
            </p>
          </div>
        ))}
      </section>

      <section id="py-runbook" className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <div className="space-y-5">
          <div className="space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4e535a]">
              {t("docsPage.sdkPyRunbookEyebrow")}
            </div>
            <h2 className="x-section-title text-white">{t("docsPage.sdkPyRunbookTitle")}</h2>
            <p className="x-body-copy max-w-[560px]">{t("docsPage.sdkPyRunbookDescription")}</p>
          </div>

          <div className="space-y-4">
            {flowTitles.map((title, index) => {
              const Icon = FLOW_ICONS[index] ?? BadgeCheck;
              return (
                <div key={title} className="relative pl-16">
                  {index < flowTitles.length - 1 && (
                    <span className="absolute left-[23px] top-[42px] h-[calc(100%-4px)] w-px bg-gradient-to-b from-[#7ff7be]/35 via-white/[0.08] to-white/0" />
                  )}
                  <div className="absolute left-0 top-0 flex h-[46px] w-[46px] items-center justify-center rounded-2xl border border-white/[0.08] bg-[#0b0d10]">
                    <Icon size={16} className="text-[#7ff7be]" />
                  </div>
                  <div className="rounded-[20px] border border-white/[0.06] bg-white/[0.02] px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">
                        {flowTags[index] ?? ""}
                      </span>
                      <span className="text-[15px] font-semibold tracking-[-0.02em] text-white">
                        {title}
                      </span>
                    </div>
                    <p className="mt-2 text-[14px] leading-7 text-[#8b98a5]">
                      {flowDescriptions[index] ?? ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          <CodeBlock
            lang="bash"
            code={`cd /home/alex/Documents/cliff/Synapse-Network-Sdk/python
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"`}
          />

          <CodeBlock
            lang="python"
            code={`from synapse_client import SynapseAuth, SynapseClient

auth = SynapseAuth.from_private_key(
    "0xYOUR_PRIVATE_KEY",
    gateway_url="http://127.0.0.1:8000",
)

balance = auth.get_balance()
intent = auth.register_deposit_intent(tx_hash, 10)
auth.confirm_deposit(
    intent.intent.resolved_id,
    intent.intent.resolved_event_key or tx_hash,
)

issued = auth.issue_credential(
    name="consumer-agent-01",
    maxCalls=100,
    creditLimit=5.0,
    rpm=60,
)

client = SynapseClient(
    api_key=issued.token,
    gateway_url="http://127.0.0.1:8000",
)

service_id = client.discover(limit=20)[0].service_id
quote = client.quote(service_id)
invocation = client.invoke(
    service_id,
    {"prompt": "hello"},
    idempotency_key="job-001",
    poll_timeout_sec=60,
)

receipt = client.get_invocation(invocation.invocation_id)
print(balance.consumer_available_balance)
print(quote.quote_id, receipt.status)`}
          />
        </div>
      </section>

      <section
        id="py-verify"
        className="rounded-[28px] border border-white/[0.06] bg-[linear-gradient(180deg,#0c0e11_0%,#090a0c_100%)] px-6 py-7 md:px-8 md:py-8"
      >
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,0.94fr)_minmax(0,1.06fr)]">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#7ff7be]/18 bg-[#7ff7be]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7ff7be]">
              <ShieldCheck size={12} />
              {t("docsPage.sdkPyVerifyEyebrow")}
            </div>
            <h2 className="x-section-title text-white">{t("docsPage.sdkPyVerifyTitle")}</h2>
            <p className="x-body-copy max-w-[560px]">{t("docsPage.sdkPyVerifyDescription")}</p>

            <div className="space-y-3 pt-2">
              {verificationChecks.map((item) => (
                <div key={item} className="flex items-start gap-3 text-[14px] leading-7 text-[#c7cdd4]">
                  <span className="mt-[6px] h-[7px] w-[7px] rounded-full bg-[#7ff7be]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <CodeBlock
              lang="bash"
              code={`cd /home/alex/Documents/cliff/Synapse-Network-Sdk/python
PYTHONPATH="$PWD" .venv/bin/python -m pytest \\
  synapse_client/test/test_auth_unit.py \\
  synapse_client/test/test_client_unit.py \\
  synapse_client/test/test_consumer_e2e.py -q -s`}
            />

            <div className="rounded-[22px] border border-white/[0.06] bg-white/[0.02] p-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">
                {t("docsPage.sdkPyVerifyResultLabel")}
              </div>
              <div className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-white">
                16 passed
              </div>
              <div className="mt-1 text-[13px] text-[#7ff7be]">4.44s</div>
              <p className="mt-4 text-[14px] leading-7 text-[#8b98a5]">
                {t("docsPage.sdkPyVerifyResultDescription")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="h-16" />
    </div>
  );
}
