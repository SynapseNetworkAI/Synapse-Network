"use client";

import { useLanguage } from "@/components/i18n/LanguageProvider";
import { CodeBlock } from "../../components/CodeBlock";
import { StatusBadge } from "../../components/StatusBadge";
import { useActiveSection } from "../../use-active-section";
import { SdkApiCheatsheet } from "../SdkApiCheatsheet";

const PAGE_SECTIONS = [
  "sdk-ts-install",
  "sdk-ts-auth",
  "sdk-ts-discover",
  "sdk-ts-invoke",
  "sdk-ts-llm",
  "sdk-ts-direct",
  "sdk-ts-starter",
  "sdk-ts-verify",
  "sdk-ts-cheatsheet",
];

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
          <StatusBadge status="PREVIEW" />
        </div>
        <h1 className="x-page-title text-white">{t("docsPage.sdkTsTitle")}</h1>
        <p className="x-body-copy max-w-[640px]">
          {t("docsPage.sdkTsDescription")}
        </p>
      </section>

      <section className="rounded-2xl border border-[#6eb6f6]/20 bg-[#6eb6f6]/[0.05] p-5">
        <p className="x-body-copy max-w-[760px]">
          {t("docsPage.sdkRunbookBridgeDescription")}
        </p>
        <a
          href="https://staging.synapse-network.ai/docs/sdk/typescript"
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex text-[13px] font-semibold text-[#6eb6f6]"
        >
          {t("docsPage.sdkRunbookBridgeTypeScriptCta")}
        </a>
      </section>

      <section className="rounded-2xl border border-[#6eb6f6]/20 bg-[#6eb6f6]/[0.05] p-5">
        <h2 className="x-section-title text-white">
          {t("docsPage.sdkAgentQuickstartTitle")}
        </h2>
        <p className="mt-2 text-[14px] leading-7 text-[#8b98a5]">
          {t("docsPage.sdkAgentQuickstartDescription")}
        </p>
        <CodeBlock
          lang="typescript"
          code={`import { SynapseClient } from "@synapse-network/sdk";

const client = new SynapseClient({
  credential: "agt_xxx",
  environment: "staging",
});

const services = await client.search("free", { limit: 10 });
const service = services[0];

const result = await client.invoke(
  service.serviceId ?? service.id!,
  { prompt: "hello" },
  {
    costUsdc: Number(service.pricing?.amount ?? 0),
    idempotencyKey: "agent-job-001",
  }
);

const receipt = await client.getInvocation(result.invocationId);
console.log(receipt.status, receipt.chargedUsdc);`}
        />
      </section>

      <section id="sdk-ts-install" className="space-y-4">
        <h2 className="x-section-title text-white">
          {t("docsPage.sdkInstallTitle")}
        </h2>
        <p className="x-body-copy max-w-[660px]">
          {t("docsPage.sdkTsInstallDescription")}
        </p>
        <CodeBlock
          lang="bash"
          code={`npm install @synapse-network/sdk ethers
# or
yarn add @synapse-network/sdk ethers`}
        />
      </section>

      <section id="sdk-ts-auth" className="space-y-4">
        <h2 className="x-section-title text-white">
          {t("docsPage.sdkTsAuthTitle")}
        </h2>
        <p className="x-body-copy max-w-[680px]">
          {t("docsPage.sdkTsAuthDescription")}
        </p>
        <CodeBlock
          lang="typescript"
          code={`import { Wallet } from "ethers";
import { SynapseAuth } from "@synapse-network/sdk";

const wallet = new Wallet(process.env.OWNER_PRIVATE_KEY!);
const auth = SynapseAuth.fromWallet(wallet, {
  environment: "staging",
});

const jwt = await auth.getToken();
const balance = await auth.getBalance();

console.log(jwt);
console.log(balance.consumerAvailableBalance);`}
        />
      </section>

      <section id="sdk-ts-deposit" className="space-y-4">
        <h2 className="x-section-title text-white">
          {t("docsPage.sdkDepositTitle")}
        </h2>
        <p className="x-body-copy max-w-[680px]">
          {t("docsPage.sdkTsDepositDescription")}
        </p>
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

      <section id="sdk-ts-discover" className="space-y-4">
        <h2 className="x-section-title text-white">
          {t("docsPage.sdkTsDiscoverTitle")}
        </h2>
        <p className="x-body-copy max-w-[700px]">
          {t("docsPage.sdkTsDiscoverDescription")}
        </p>
        <CodeBlock
          lang="typescript"
          code={`const services = await client.discover({ limit: 20 });
const service = services.find((item) => (item.serviceId ?? item.id));

if (!service) {
  throw new Error("No discoverable services are available yet.");
}

const serviceId = service.serviceId ?? service.id!;
console.log(serviceId, service.serviceName, service.summary);`}
        />
      </section>

      <section id="sdk-ts-invoke" className="space-y-4">
        <h2 className="x-section-title text-white">
          {t("docsPage.sdkTsInvokeTitle")}
        </h2>
        <p className="x-body-copy max-w-[700px]">
          {t("docsPage.sdkTsInvokeDescription")}
        </p>
        <CodeBlock
          lang="typescript"
          code={`import { SynapseClient, PriceMismatchError } from "@synapse-network/sdk";

const issued = await auth.issueCredential({
  name: "consumer-agent-01",
  maxCalls: 100,
  creditLimit: 5,
  rpm: 60,
});

const client = new SynapseClient({
  credential: issued.token,
  environment: "staging",
});

const services = await client.discover({ limit: 20 });
const service = services.find((item) => (item.serviceId ?? item.id));

if (!service) {
  throw new Error("No discoverable services are available yet.");
}

const serviceId = service.serviceId ?? service.id!;
const priceUsdc = Number((service as any).priceUsdc ?? (service.pricing as any)?.amount ?? 0);

try {
  // One call — costUsdc locks the price the agent saw from discovery
  const result = await client.invoke(
    serviceId,
    { prompt: "hello" },
    { idempotencyKey: "job-001", costUsdc: priceUsdc }
  );
  console.log(result.invocationId, result.status, result.chargedUsdc);
} catch (err) {
  if (err instanceof PriceMismatchError) {
    // Price changed — re-discover and retry
    console.warn(\`Price changed: expected \${err.expectedPriceUsdc}, now \${err.currentPriceUsdc}\`);
  }
  throw err;
}`}
        />
      </section>

      <section id="sdk-ts-llm" className="space-y-4">
        <h2 className="x-section-title text-white">
          {t("docsPage.sdkLlmInvokeTitle")}
        </h2>
        <p className="x-body-copy max-w-[700px]">
          {t("docsPage.sdkTsLlmInvokeDescription")}
        </p>
        <CodeBlock
          lang="typescript"
          code={`const result = await client.invokeLlm(
  "svc_deepseek_chat",
  {
    model: "deepseek-chat",
    messages: [{ role: "user", content: "Summarize this document." }],
    max_tokens: 512,
    // stream: true is rejected in Synapse V1
  },
  {
    idempotencyKey: "llm-job-001",
    maxCostUsdc: "0.010000", // optional
  }
);

console.log(result.usage?.inputTokens, result.usage?.outputTokens);
console.log(result.synapse?.chargedUsdc, result.synapse?.releasedUsdc);`}
        />
      </section>

      <section id="sdk-ts-direct" className="space-y-4">
        <h2 className="x-section-title text-white">
          {t("docsPage.sdkTsDirectTitle")}
        </h2>
        <p className="x-body-copy max-w-[700px]">
          {t("docsPage.sdkTsDirectDescription")}
        </p>
        <CodeBlock
          lang="typescript"
          code={`const knownServiceId = process.env.SYNAPSE_SERVICE_ID!;
const knownPrice = Number(process.env.SYNAPSE_SERVICE_PRICE_USDC!);

// Pass the price you saw in discovery — gateway rejects with PRICE_MISMATCH if it changed
const result = await client.invoke(
  knownServiceId,
  { prompt: "hello" },
  { idempotencyKey: "job-known-service-001", costUsdc: knownPrice }
);

console.log(result.invocationId, result.status, result.chargedUsdc);`}
        />
      </section>

      <section id="sdk-ts-starter" className="space-y-4">
        <h2 className="x-section-title text-white">
          {t("docsPage.sdkTsStarterTitle")}
        </h2>
        <p className="x-body-copy max-w-[700px]">
          {t("docsPage.sdkTsStarterDescription")}
        </p>
        <ul className="space-y-3 text-[14px] leading-6 text-[#8b98a5]">
          {tList("docsPage.sdkTsStarterBullets").map((item) => (
            <li key={item} className="flex gap-3">
              <span className="mt-[8px] h-[5px] w-[5px] shrink-0 rounded-full bg-[#7ff7be]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="sdk-ts-verify" className="space-y-4">
        <h2 className="x-section-title text-white">
          {t("docsPage.sdkTsVerificationTitle")}
        </h2>
        <p className="x-body-copy max-w-[700px]">
          {t("docsPage.sdkTsVerificationDescription")}
        </p>
        <CodeBlock
          lang="bash"
          code={`cd /home/alex/Documents/cliff/Synapse-Network-Sdk/typescript
npm run test:e2e
npm run test:new-consumer`}
        />
      </section>

      <div id="sdk-ts-cheatsheet">
        <SdkApiCheatsheet
          title={t("docsPage.sdkApiCheatsheetTitle")}
          methodLabel={t("docsPage.sdkMethod")}
          returnsLabel={t("docsPage.sdkReturns")}
          descriptionLabel={t("docsPage.sdkDescriptionLabel")}
          authRows={{
            methods: authMethods,
            returns: authReturns,
            descriptions: authDescriptions,
          }}
          clientRows={{
            methods: clientMethods,
            returns: clientReturns,
            descriptions: clientDescriptions,
          }}
        />
      </div>

      <div className="h-16" />
    </div>
  );
}
