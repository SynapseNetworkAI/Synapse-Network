"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, KeyRound, WalletCards, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { CodeBlock } from "../../components/CodeBlock";
import { StepItem, StepTip } from "../../components/StepItem";
import { useActiveSection } from "../../use-active-section";
import { useDocsPageNav } from "../../use-docs-page-nav";

const ACCENT = "#6eb6f6";

const PAGE_SECTIONS = [
  "step-auth",
  "step-secret",
  "step-register",
  "step-status",
  "step-earnings",
  "step-withdraw",
];

type ProviderSdk = "typescript" | "python";

const SDK_SNIPPETS: Record<
  ProviderSdk,
  {
    auth: string;
    secret: string;
    register: string;
    status: string;
    earnings: string;
    withdraw: string;
  }
> = {
  typescript: {
    auth: `
import { Wallet } from "ethers";
import { SynapseAuth } from "@synapse-network/sdk";

const wallet = new Wallet(process.env.PROVIDER_PRIVATE_KEY!);

const auth = SynapseAuth.fromWallet(wallet, {
  gatewayUrl: "http://127.0.0.1:8000",
});

const jwt = await auth.getToken();
console.log(jwt);
    `,
    secret: `
const issued = await auth.issueProviderSecret({
  name: "provider-secret-prod",
  rpm: 180,
  creditLimit: 25,
  resetInterval: "monthly",
});

console.log(issued.secret.id, issued.secret.maskedKey);
    `,
    register: `
const registered = await auth.registerProviderService({
  serviceName: "SEA Invoice OCR",
  endpointUrl: "https://provider.example.com/invoke",
  basePriceUsdc: "0.008",
  descriptionForModel:
    "Extract structured invoice fields from invoice images.",
});

console.log(registered.serviceId);
    `,
    status: `
const services = await auth.listProviderServices();
const service = services.find((item) => item.serviceId === registered.serviceId);

const status = await auth.getProviderServiceStatus(registered.serviceId);

console.log(service?.serviceName);
console.log(status.lifecycleStatus);
console.log(status.health.overallStatus);
console.log(status.runtimeAvailable);
    `,
    earnings: `
const balance = await auth.getBalance();

console.log("providerReceivable:", balance.providerReceivable);
console.log("availableBalance:", balance.availableBalance);
    `,
    withdraw: `
// Withdrawal is still a control-plane API call today.
const jwt = await auth.getToken();

const intent = await fetch("http://127.0.0.1:8000/api/v1/providers/withdrawals/intent", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${jwt}\`,
    "Content-Type": "application/json",
    "X-Idempotency-Key": crypto.randomUUID(),
  },
  body: JSON.stringify({
    amountUsdc: "5.00",
  }),
}).then((res) => res.json());

console.log(intent.withdrawalId, intent.status);
    `,
  },
  python: {
    auth: `
from synapse_client import SynapseAuth

auth = SynapseAuth.from_private_key(
    "0xYOUR_PROVIDER_PRIVATE_KEY",
    gateway_url="http://127.0.0.1:8000",
)

jwt = auth.get_token()
print(jwt)
    `,
    secret: `
issued = auth.issue_provider_secret(
    name="provider-secret-prod",
    rpm=180,
    creditLimit=25.0,
)

print(issued.secret.id, issued.secret.masked_key)
    `,
    register: `
registered = auth.register_provider_service(
    service_name="SEA Invoice OCR",
    endpoint_url="https://provider.example.com/invoke",
    base_price_usdc="0.008",
    description_for_model="Extract structured invoice fields from invoice images.",
)

print(registered.service_id)
    `,
    status: `
services = auth.list_provider_services()
status = auth.get_provider_service_status(registered.service_id)

print([service.service_id for service in services])
print(status.lifecycle_status)
print(status.health.overall_status)
print(status.runtime_available)
    `,
    earnings: `
balance = auth.get_balance()

print("provider_receivable:", balance.provider_receivable)
print("available_balance:", balance.available_balance)
    `,
    withdraw: `
import requests
import uuid

jwt = auth.get_token()

intent = requests.post(
    "http://127.0.0.1:8000/api/v1/providers/withdrawals/intent",
    headers={
        "Authorization": f"Bearer {jwt}",
        "Content-Type": "application/json",
        "X-Idempotency-Key": str(uuid.uuid4()),
    },
    json={"amountUsdc": "5.00"},
    timeout=30,
).json()

print(intent["withdrawalId"], intent["status"])
    `,
  },
};

export default function ProviderGuidePage() {
  const router = useRouter();
  const { t, tList } = useLanguage();
  const [sdk, setSdk] = useState<ProviderSdk>("typescript");

  useActiveSection(PAGE_SECTIONS, "step-auth");

  const progressLabels = tList("docsPage.providerProgress");
  const stepTitles = tList("docsPage.providerStepTitles");
  const stepBodies = tList("docsPage.providerStepBodies");
  const stepTips = tList("docsPage.providerStepTips");
  const sdkTabs = tList("docsPage.providerSdkTabs");
  const registrationInputs = tList("docsPage.providerRegistrationInputs");
  const registrationDefaults = tList("docsPage.providerRegistrationDefaults");
  const statusSignals = tList("docsPage.providerStatusSignals");
  const settlementRows = tList("docsPage.providerSettlementModelRows");
  const settlementValues = tList("docsPage.providerSettlementModelValues");

  useDocsPageNav(
    PAGE_SECTIONS.map((id, index) => ({
      id,
      label: stepTitles[index] ?? id,
    })),
  );

  const currentSnippets = SDK_SNIPPETS[sdk];

  return (
    <div className="space-y-4">
      <div className="mb-12 space-y-3 border-b border-white/[0.06] pb-8">
        <div className="flex items-center gap-3">
          <span
            className="rounded text-[10px] font-semibold uppercase tracking-[0.14em] px-2 py-1"
            style={{ color: ACCENT, background: `${ACCENT}12`, border: `1px solid ${ACCENT}25` }}
          >
            {t("docsPage.providerEyebrow")}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">
            {t("docsPage.providerPageEyebrow")}
          </span>
        </div>
        <h1 className="x-page-title text-white">{t("docsPage.providerTitle")}</h1>
        <p className="x-body-copy max-w-[680px]">
          {t("docsPage.providerDescription")}
        </p>

        <div className="mt-5 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">
            {t("docsPage.providerSdkSwitcherLabel")}
          </div>
          <div className="inline-flex rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1" role="tablist" aria-label={t("docsPage.providerSdkSwitcherLabel")}>
            {(["typescript", "python"] as ProviderSdk[]).map((item, index) => {
              const isActive = sdk === item;
              return (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setSdk(item)}
                  className="rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors"
                  style={{
                    color: isActive ? "#0f1419" : "#9aa4af",
                    background: isActive ? "#f7f9f9" : "transparent",
                  }}
                >
                  {sdkTabs[index] ?? item}
                </button>
              );
            })}
          </div>
          <p className="max-w-[620px] text-[13px] leading-6 text-[#71767b]">
            {t("docsPage.providerSdkSwitcherDescription")}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-0 gap-y-2">
          {progressLabels.map((step, index) => (
            <div key={step} className="flex items-center">
              <a
                href={`#${PAGE_SECTIONS[index]}`}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors"
                style={{ color: ACCENT, background: `${ACCENT}10` }}
              >
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                  style={{ background: `${ACCENT}20`, color: ACCENT }}
                >
                  {index + 1}
                </span>
                {step}
              </a>
              {index < progressLabels.length - 1 && <span className="px-1 text-[12px] text-[#3a3f45]">→</span>}
            </div>
          ))}
        </div>
      </div>

      <StepItem num="01" title={stepTitles[0] ?? ""} accent={ACCENT} id="step-auth">
        <p className="text-[13px] leading-relaxed text-[#71767b]">{stepBodies[0]}</p>
        <CodeBlock lang={sdk === "typescript" ? "typescript" : "python"} code={currentSnippets.auth} />
        <StepTip accent={ACCENT}>{stepTips[0]}</StepTip>
      </StepItem>

      <StepItem num="02" title={stepTitles[1] ?? ""} accent={ACCENT} id="step-secret">
        <p className="text-[13px] leading-relaxed text-[#71767b]">{stepBodies[1]}</p>
        <CodeBlock lang={sdk === "typescript" ? "typescript" : "python"} code={currentSnippets.secret} />
        <StepTip accent={ACCENT}>{stepTips[1]}</StepTip>
      </StepItem>

      <StepItem num="03" title={stepTitles[2] ?? ""} accent={ACCENT} id="step-register">
        <p className="text-[13px] leading-relaxed text-[#71767b]">{stepBodies[2]}</p>

        <div className="mt-2 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-white">
              <WalletCards size={15} style={{ color: ACCENT }} />
              {t("docsPage.providerRegistrationInputsTitle")}
            </div>
            <div className="space-y-2">
              {registrationInputs.map((item) => (
                <div key={item} className="flex gap-2 text-[13px] text-[#9aa4af]">
                  <CheckCircle2 size={14} className="mt-[3px] shrink-0 text-[#7ff7be]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-white">
              <Zap size={15} style={{ color: ACCENT }} />
              {t("docsPage.providerRegistrationDefaultsTitle")}
            </div>
            <div className="space-y-2">
              {registrationDefaults.map((item) => (
                <div key={item} className="flex gap-2 text-[13px] text-[#9aa4af]">
                  <KeyRound size={14} className="mt-[3px] shrink-0 text-[#6eb6f6]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <CodeBlock lang={sdk === "typescript" ? "typescript" : "python"} code={currentSnippets.register} />
        <StepTip accent={ACCENT}>{stepTips[2]}</StepTip>
      </StepItem>

      <StepItem num="04" title={stepTitles[3] ?? ""} accent={ACCENT} id="step-status">
        <p className="text-[13px] leading-relaxed text-[#71767b]">{stepBodies[3]}</p>

        <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">
            {t("docsPage.providerStatusSignalsTitle")}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {statusSignals.map((signal) => (
              <div key={signal} className="rounded-xl border border-white/[0.06] bg-[#0b0d10] px-3 py-3 text-[12px] leading-6 text-[#9aa4af]">
                {signal}
              </div>
            ))}
          </div>
        </div>

        <CodeBlock lang={sdk === "typescript" ? "typescript" : "python"} code={currentSnippets.status} />
        <StepTip accent={ACCENT}>{stepTips[3]}</StepTip>
      </StepItem>

      <StepItem num="05" title={stepTitles[4] ?? ""} accent={ACCENT} id="step-earnings">
        <p className="text-[13px] leading-relaxed text-[#71767b]">{stepBodies[4]}</p>
        <CodeBlock lang={sdk === "typescript" ? "typescript" : "python"} code={currentSnippets.earnings} />
        <div
          className="mt-2 rounded-xl p-4"
          style={{ background: `${ACCENT}06`, border: `1px solid ${ACCENT}14` }}
        >
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-[#4e535a]">
            {t("docsPage.providerSettlementModelLabel")}
          </div>
          <div className="space-y-1.5 text-[12px]">
            {settlementRows.map((label, index) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <span className="text-[#71767b]">{label}</span>
                <code
                  className="font-mono text-[11px]"
                  style={{ color: index === 0 ? "#ff6b6b" : index === 1 ? ACCENT : "#f9c74f" }}
                >
                  {settlementValues[index] ?? ""}
                </code>
              </div>
            ))}
          </div>
        </div>
        <StepTip accent={ACCENT}>{stepTips[4]}</StepTip>
      </StepItem>

      <StepItem num="06" title={stepTitles[5] ?? ""} accent={ACCENT} last id="step-withdraw">
        <p className="text-[13px] leading-relaxed text-[#71767b]">{stepBodies[5]}</p>
        <CodeBlock lang={sdk === "typescript" ? "typescript" : "python"} code={currentSnippets.withdraw} />
        <StepTip accent={ACCENT}>{stepTips[5]}</StepTip>

        <div
          className="mt-6 flex items-center gap-4 rounded-2xl p-5"
          style={{ background: `${ACCENT}08`, border: `1px solid ${ACCENT}20` }}
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[18px]"
            style={{ background: `${ACCENT}18` }}
          >
            ✓
          </div>
          <div>
            <div className="mb-1 text-[14px] font-semibold text-white">{t("docsPage.providerCompletionTitle")}</div>
            <p className="text-[13px] text-[#71767b]">{t("docsPage.providerCompletionDescription")}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => router.push("/docs/api-reference#api-services")}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors"
            style={{ color: ACCENT, background: `${ACCENT}10`, border: `1px solid ${ACCENT}20` }}
          >
            {t("docsPage.providerServicesApiCta")} <ArrowRight size={13} />
          </button>
          <button
            onClick={() => router.push("/docs/sdk/python")}
            className="inline-flex items-center gap-2 rounded-lg border border-white/[0.06] px-4 py-2 text-[13px] font-medium text-[#71767b] transition-colors hover:border-white/10 hover:text-white"
          >
            {t("docsPage.providerDeepDiveCta")} <ArrowRight size={13} />
          </button>
        </div>
      </StepItem>

      <div className="h-16" />
    </div>
  );
}
