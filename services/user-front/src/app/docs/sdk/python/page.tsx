"use client";

import { useLanguage } from "@/components/i18n/LanguageProvider";
import { CodeBlock } from "../../components/CodeBlock";
import { StatusBadge } from "../../components/StatusBadge";
import { useActiveSection } from "../../use-active-section";

const PAGE_SECTIONS = [
  "sdk-py",
  "py-auth",
  "py-balance",
  "py-deposit",
  "py-credential",
  "py-invoke",
  "py-verify",
];

export default function PythonSdkPage() {
  const { t, tList } = useLanguage();
  useActiveSection(PAGE_SECTIONS, "sdk-py");

  const capabilityTitles = tList("docsPage.sdkPyCapabilityTitles");
  const capabilityDescriptions = tList("docsPage.sdkPyCapabilityDescriptions");

  return (
    <div className="space-y-16">
      <section className="space-y-5 border-b border-white/[0.06] pb-8">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
            {t("docsPage.sdkEyebrow")}
          </span>
          <StatusBadge status="GA" />
        </div>
        <h1 className="x-page-title text-white">{t("docsPage.sdkPyTitle")}</h1>
        <p className="x-body-copy max-w-[660px]">{t("docsPage.sdkPyDescription")}</p>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {capabilityTitles.map((title, index) => (
          <div key={title} className="rounded-2xl border border-white/[0.06] bg-[#0a0b0d] p-5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#4e535a]">
              {String(index + 1).padStart(2, "0")}
            </div>
            <h2 className="mt-3 text-[17px] font-semibold tracking-[-0.02em] text-white">{title}</h2>
            <p className="mt-2 text-[14px] leading-7 text-[#8b98a5]">{capabilityDescriptions[index] ?? ""}</p>
          </div>
        ))}
      </section>

      <section id="sdk-py" className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.sdkInstallTitle")}</h2>
        <p className="x-body-copy max-w-[680px]">{t("docsPage.sdkPyInstallDescription")}</p>
        <CodeBlock
          lang="bash"
          code={`cd /home/alex/Documents/cliff/Synapse-Network-Sdk/python
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"`}
        />
      </section>

      <section id="py-auth" className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.sdkPyAuthTitle")}</h2>
        <p className="x-body-copy max-w-[700px]">{t("docsPage.sdkPyAuthDescription")}</p>
        <CodeBlock
          lang="python"
          code={`from synapse_client import SynapseAuth

auth = SynapseAuth.from_private_key(
    "0xYOUR_PRIVATE_KEY",
    gateway_url="http://127.0.0.1:8000",
)

jwt = auth.get_token()
print(jwt)`}
        />
      </section>

      <section id="py-balance" className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.sdkBalanceTitle")}</h2>
        <p className="x-body-copy max-w-[680px]">{t("docsPage.sdkPyBalanceDescription")}</p>
        <CodeBlock
          lang="python"
          code={`balance = auth.get_balance()

print(balance.consumer_available_balance)
print(balance.provider_receivable)
print(balance.protocol_fee_balance)`}
        />
      </section>

      <section id="py-deposit" className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.sdkDepositTitle")}</h2>
        <p className="x-body-copy max-w-[700px]">{t("docsPage.sdkPyDepositDescription")}</p>
        <CodeBlock
          lang="python"
          code={`intent = auth.register_deposit_intent(tx_hash, 10)
intent_id = intent.intent.resolved_id
event_key = intent.intent.resolved_event_key or tx_hash

auth.confirm_deposit(intent_id, event_key)`}
        />
      </section>

      <section id="py-credential" className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.sdkPyCredentialTitle")}</h2>
        <p className="x-body-copy max-w-[700px]">{t("docsPage.sdkPyCredentialDescription")}</p>
        <CodeBlock
          lang="python"
          code={`issued = auth.issue_credential(
    name="consumer-agent-01",
    maxCalls=100,
    creditLimit=5.0,
    rpm=60,
)

print(issued.credential.id)
print(issued.token)`}
        />
      </section>

      <section id="py-invoke" className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.sdkPyInvokeTitle")}</h2>
        <p className="x-body-copy max-w-[700px]">{t("docsPage.sdkPyInvokeDescription")}</p>
        <CodeBlock
          lang="python"
          code={`from synapse_client import SynapseClient

client = SynapseClient(
    api_key=issued.token,
    gateway_url="http://127.0.0.1:8000",
)

services = client.discover(limit=20)
service_id = services[0].service_id

quote = client.quote(service_id)
invocation = client.invoke(
    service_id,
    {"prompt": "hello"},
    idempotency_key="job-001",
    poll_timeout_sec=60,
)

receipt = client.get_invocation(invocation.invocation_id)
print(quote.quote_id, invocation.status, receipt.status)`}
        />
      </section>

      <section id="py-verify" className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.sdkPyVerifyTitle")}</h2>
        <p className="x-body-copy max-w-[700px]">{t("docsPage.sdkPyVerifyDescription")}</p>
        <CodeBlock
          lang="bash"
          code={`cd /home/alex/Documents/cliff/Synapse-Network-Sdk/python
PYTHONPATH="$PWD" .venv/bin/python -m pytest synapse_client/test/test_auth_unit.py synapse_client/test/test_client_unit.py synapse_client/test/test_consumer_e2e.py -q -s`}
        />
      </section>

      <div className="h-16" />
    </div>
  );
}
