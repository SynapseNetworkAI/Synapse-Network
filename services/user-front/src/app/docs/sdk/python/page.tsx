"use client";

import { useLanguage } from "@/components/i18n/LanguageProvider";
import { CodeBlock } from "../../components/CodeBlock";
import { StatusBadge } from "../../components/StatusBadge";
import { useActiveSection } from "../../use-active-section";

const PAGE_SECTIONS = ["sdk-py"];

export default function PythonSdkPage() {
  const { t, tList } = useLanguage();
  useActiveSection(PAGE_SECTIONS, "sdk-py");

  const authMethods = tList("docsPage.sdkPyAuthMethods");
  const authReturns = tList("docsPage.sdkPyAuthReturns");
  const authDescriptions = tList("docsPage.sdkPyAuthDescriptions");
  const clientMethods = tList("docsPage.sdkPyClientMethods");
  const clientReturns = tList("docsPage.sdkPyClientReturns");
  const clientDescriptions = tList("docsPage.sdkPyClientDescriptions");

  return (
    <div className="space-y-16">
      <section className="space-y-5 border-b border-white/[0.06] pb-8">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
            {t("docsPage.sdkEyebrow")}
          </span>
          <StatusBadge status="PREVIEW" />
        </div>
        <h1 className="x-page-title text-white">{t("docsPage.sdkPyTitle")}</h1>
        <p className="x-body-copy max-w-[640px]">{t("docsPage.sdkPyDescription")}</p>
      </section>

      <section id="sdk-py" className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.sdkInstallTitle")}</h2>
        <p className="x-body-copy max-w-[660px]">{t("docsPage.sdkPyInstallDescription")}</p>
        <CodeBlock
          lang="bash"
          code={`cd /path/to/Synapse-Network-Sdk/python
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"`}
        />
      </section>

      <section className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.sdkPyAuthTitle")}</h2>
        <p className="x-body-copy max-w-[680px]">{t("docsPage.sdkPyAuthDescription")}</p>
        <CodeBlock
          lang="python"
          code={`from synapse_client import SynapseAuth

auth = SynapseAuth.from_private_key(
    "0xYOUR_PRIVATE_KEY",
    environment="staging",
)

token = auth.get_token()
balance = auth.get_balance()

print(token)
print(balance.consumer_available_balance)`}
        />
      </section>

      <section className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.sdkDepositTitle")}</h2>
        <p className="x-body-copy max-w-[680px]">{t("docsPage.sdkPyDepositDescription")}</p>
        <CodeBlock
          lang="python"
          code={`intent = auth.register_deposit_intent(tx_hash, 10)
auth.confirm_deposit(
    intent.intent.resolved_id,
    intent.intent.resolved_event_key or tx_hash,
)`}
        />
      </section>

      <section className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.sdkPyInvokeTitle")}</h2>
        <p className="x-body-copy max-w-[700px]">{t("docsPage.sdkPyInvokeDescription")}</p>
        <CodeBlock
          lang="python"
          code={`from decimal import Decimal
from synapse_client import SynapseClient, PriceMismatchError

issued = auth.issue_credential(
    name="consumer-agent-01",
    maxCalls=100,
    creditLimit=5.0,
    rpm=60,
)

client = SynapseClient(
    api_key=issued.token,
    environment="staging",
)

services = client.discover(limit=20)
service = services[0]
service_id = service.service_id
price_usdc = Decimal(service.price_usdc)

try:
    # One call — cost_usdc locks the price the agent saw
    result = client.invoke(
        service_id,
        {"prompt": "hello"},
        cost_usdc=price_usdc,
        idempotency_key="job-001",
    )
    print(result.invocation_id, result.status, result.charged_usdc)
except PriceMismatchError as err:
    # Price changed — re-discover and retry
    print(f"Price changed: expected {err.expected_price_usdc}, now {err.current_price_usdc}")`}
        />
      </section>

      <section className="space-y-5">
        <h2 className="x-section-title text-white">{t("docsPage.sdkApiCheatsheetTitle")}</h2>

        <div className="text-[11px] font-semibold tracking-widest text-[#4e535a] uppercase">SynapseAuth</div>
        <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">{t("docsPage.sdkMethod")}</th>
                <th className="hidden px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a] md:table-cell">{t("docsPage.sdkReturns")}</th>
                <th className="hidden px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a] md:table-cell">{t("docsPage.sdkDescriptionLabel")}</th>
              </tr>
            </thead>
            <tbody>
              {authMethods.map((method, index) => (
                <tr key={method} className="border-b border-white/[0.04] last:border-b-0">
                  <td className="px-4 py-3"><code className="font-mono text-[12px] text-[#7ff7be]">{method}</code></td>
                  <td className="hidden px-4 py-3 md:table-cell"><code className="font-mono text-[11px] text-[#6eb6f6]">{authReturns[index] ?? ""}</code></td>
                  <td className="hidden px-4 py-3 text-[12px] text-[#8b98a5] md:table-cell">{authDescriptions[index] ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pt-2 text-[11px] font-semibold tracking-widest text-[#4e535a] uppercase">SynapseClient</div>
        <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">{t("docsPage.sdkMethod")}</th>
                <th className="hidden px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a] md:table-cell">{t("docsPage.sdkReturns")}</th>
                <th className="hidden px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a] md:table-cell">{t("docsPage.sdkDescriptionLabel")}</th>
              </tr>
            </thead>
            <tbody>
              {clientMethods.map((method, index) => (
                <tr key={method} className="border-b border-white/[0.04] last:border-b-0">
                  <td className="px-4 py-3"><code className="font-mono text-[12px] text-[#7ff7be]">{method}</code></td>
                  <td className="hidden px-4 py-3 md:table-cell"><code className="font-mono text-[11px] text-[#6eb6f6]">{clientReturns[index] ?? ""}</code></td>
                  <td className="hidden px-4 py-3 text-[12px] text-[#8b98a5] md:table-cell">{clientDescriptions[index] ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="h-16" />
    </div>
  );
}
