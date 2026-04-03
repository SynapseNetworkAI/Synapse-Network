"use client";

import { useLanguage } from "@/components/i18n/LanguageProvider";
import { CodeBlock } from "../../components/CodeBlock";
import { StatusBadge } from "../../components/StatusBadge";
import { useActiveSection } from "../../use-active-section";

const PAGE_SECTIONS = ["sdk-ts"];

export default function TypeScriptSdkPage() {
  const { t, tList } = useLanguage();
  useActiveSection(PAGE_SECTIONS, "sdk-ts");

  const authMethods = tList("docsPage.sdkAuthMethods");
  const authReturns = tList("docsPage.sdkAuthReturns");
  const authDescriptions = tList("docsPage.sdkAuthDescriptions");
  const clientMethods = tList("docsPage.sdkClientMethods");
  const clientReturns = tList("docsPage.sdkClientReturns");
  const clientDescriptions = tList("docsPage.sdkClientDescriptions");

  return (
    <div className="space-y-16">
      <section className="space-y-5 border-b border-white/[0.06] pb-8">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
            {t("docsPage.sdkEyebrow")}
          </span>
          <StatusBadge status="GA" />
        </div>
        <h1 className="x-page-title text-white">{t("docsPage.sdkTsTitle")}</h1>
        <p className="x-body-copy max-w-[640px]">{t("docsPage.sdkTsDescription")}</p>
      </section>

      <section id="sdk-ts" className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.sdkInstallTitle")}</h2>
        <p className="x-body-copy max-w-[660px]">{t("docsPage.sdkTsInstallDescription")}</p>
        <CodeBlock
          lang="bash"
          code={`npm install @synapse-network/sdk ethers
# or
yarn add @synapse-network/sdk ethers`}
        />
      </section>

      <section className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.sdkTsAuthTitle")}</h2>
        <p className="x-body-copy max-w-[680px]">{t("docsPage.sdkTsAuthDescription")}</p>
        <CodeBlock
          lang="typescript"
          code={`import { Wallet } from "ethers";
import { SynapseAuth } from "@synapse-network/sdk";

const wallet = new Wallet(process.env.OWNER_PRIVATE_KEY!);
const auth = SynapseAuth.fromWallet(wallet, {
  gatewayUrl: "http://127.0.0.1:8000",
});

const jwt = await auth.getToken();
const balance = await auth.getBalance();

console.log(jwt);
console.log(balance.consumerAvailableBalance);`}
        />
      </section>

      <section className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.sdkDepositTitle")}</h2>
        <p className="x-body-copy max-w-[680px]">{t("docsPage.sdkTsDepositDescription")}</p>
        <CodeBlock
          lang="typescript"
          code={`const intent = await auth.registerDepositIntent(txHash, 10);
const intentId =
  intent.intent.id ??
  intent.intent.intentId ??
  intent.intent.depositIntentId!;
const eventKey =
  intent.intent.eventKey ??
  intent.intent.event_key ??
  txHash;

await auth.confirmDeposit(intentId, eventKey);`}
        />
      </section>

      <section className="space-y-4">
        <h2 className="x-section-title text-white">{t("docsPage.sdkTsInvokeTitle")}</h2>
        <p className="x-body-copy max-w-[700px]">{t("docsPage.sdkTsInvokeDescription")}</p>
        <CodeBlock
          lang="typescript"
          code={`import { SynapseClient } from "@synapse-network/sdk";

const issued = await auth.issueCredential({
  name: "consumer-agent-01",
  maxCalls: 100,
  creditLimit: 5,
  rpm: 60,
});

const client = new SynapseClient({
  credential: issued.token,
  gatewayUrl: "http://127.0.0.1:8000",
});

const services = await client.discover({ limit: 20 });
const serviceId = services[0]?.serviceId!;

const quote = await client.quote(serviceId);
const result = await client.invoke(
  serviceId,
  { prompt: "hello" },
  {
    idempotencyKey: "job-001",
    pollTimeoutMs: 60_000,
  }
);

console.log(quote.quoteId);
console.log(result.invocationId, result.status, result.chargedUsdc);`}
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
