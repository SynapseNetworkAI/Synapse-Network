"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { CodeBlock } from "../../components/CodeBlock";
import { StepItem, StepTip } from "../../components/StepItem";
import { useActiveSection } from "../../use-active-section";
import { useDocsPageNav } from "../../use-docs-page-nav";

const ACCENT = "#7ff7be";

const PAGE_SECTIONS = [
  "step-auth",
  "step-deposit",
  "step-discover",
  "step-credential",
  "step-invoke",
  "step-verify",
  "step-withdraw",
];

export default function ConsumerGuidePage() {
  const router = useRouter();
  const { t, tList } = useLanguage();
  useActiveSection(PAGE_SECTIONS, "step-auth");
  const progressLabels = tList("docsPage.consumerProgress");
  const stepTitles = tList("docsPage.consumerStepTitles");
  const stepBodies = tList("docsPage.consumerStepBodies");
  const stepTips = tList("docsPage.consumerStepTips");
  const cAuth = tList("docsPage.consumerCodeAuth");
  const cDeposit = tList("docsPage.consumerCodeDeposit");
  const cDiscover = tList("docsPage.consumerCodeDiscover");
  const cCred = tList("docsPage.consumerCodeCredential");
  const cInvoke = tList("docsPage.consumerCodeInvoke");
  const cVerify = tList("docsPage.consumerCodeVerify");
  const cWithdraw = tList("docsPage.consumerCodeWithdraw");
  useDocsPageNav(PAGE_SECTIONS.map((id, index) => ({
    id,
    label: stepTitles[index] ?? id,
  })));

  return (
    <div className="space-y-4">

      {/* Page header */}
      <div className="space-y-3 border-b border-white/[0.06] pb-8 mb-12">
        <div className="flex items-center gap-3">
          <span
            className="text-[10px] font-semibold tracking-[0.14em] uppercase px-2 py-1 rounded"
            style={{ color: ACCENT, background: `${ACCENT}12`, border: `1px solid ${ACCENT}25` }}
          >
            {t("docsPage.consumerEyebrow")}
          </span>
          <span className="text-[10px] font-semibold tracking-[0.14em] text-[#4e535a] uppercase">
            {t("docsPage.consumerPageEyebrow")}
          </span>
        </div>
        <h1 className="x-page-title text-white">{t("docsPage.consumerTitle")}</h1>
        <p className="x-body-copy max-w-[560px]">
          {t("docsPage.consumerDescription")}
        </p>

        {/* Step progress */}
        <div className="flex items-center gap-0 mt-4 flex-wrap gap-y-2">
          {progressLabels.map((s, i) => (
            <div key={s} className="flex items-center">
              <a
                href={`#step-${PAGE_SECTIONS[i].split("-")[1]}`}
                className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={{ color: ACCENT, background: `${ACCENT}10` }}
              >
                <span
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                  style={{ background: `${ACCENT}20`, color: ACCENT }}
                >
                  {i + 1}
                </span>
                {s}
              </a>
              {i < progressLabels.length - 1 && <span className="text-[#3a3f45] text-[12px] px-1">→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Step 01: Auth ───────────────────────────────────────── */}
      <StepItem num="01" title={stepTitles[0] ?? ""} accent={ACCENT} id="step-auth">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[0]}
        </p>
        <CodeBlock lang="typescript" code={[
          `// ${cAuth[0]}`,
          `const { challenge } = await fetch(`,
          `  \`/api/v1/auth/challenge?address=\${walletAddress}\``,
          `).then(r => r.json())`,
          ``,
          `// ${cAuth[1]}`,
          `const signature = await signer.signMessage(challenge)`,
          ``,
          `// ${cAuth[2]}`,
          `const { token } = await fetch('/api/v1/auth/verify', {`,
          `  method: 'POST',`,
          `  headers: { 'Content-Type': 'application/json' },`,
          `  body: JSON.stringify({ wallet_address: walletAddress, message: challenge, signature }),`,
          `}).then(r => r.json())`,
          ``,
          `// ${cAuth[3]}`,
          `// ${cAuth[4]}`,
        ].join('\n')} />
        <StepTip accent={ACCENT}>
          {stepTips[0]}{" "}
          <code className="text-[#c0c5cc] font-mono text-[12px]">await client.auth.connectWallet(signer)</code>{" "}
        </StepTip>
      </StepItem>

      {/* ── Step 02: Deposit ────────────────────────────────────── */}
      <StepItem num="02" title={stepTitles[1] ?? ""} accent={ACCENT} id="step-deposit">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[1]}
        </p>
        <CodeBlock lang="typescript" code={[
          `import { ethers } from 'ethers'`,
          ``,
          `const depositAmount = ethers.parseUnits('10', 6)   // ${cDeposit[0]}`,
          ``,
          `// ${cDeposit[1]}`,
          `await usdcContract.approve(SYNAPSE_CORE_ADDRESS, depositAmount)`,
          ``,
          `// ${cDeposit[2]}`,
          `const tx = await synapseCore.deposit(depositAmount)`,
          `await tx.wait()`,
          ``,
          `// ${cDeposit[3]}`,
          `const idempotencyKey = crypto.randomUUID()`,
          `const { intentId } = await fetch('/api/v1/balance/deposit/intent', {`,
          `  method: 'POST',`,
          `  headers: {`,
          `    'Authorization': \`Bearer \${token}\`,`,
          `    'X-Idempotency-Key': idempotencyKey,`,
          `    'Content-Type': 'application/json',`,
          `  },`,
          `  body: JSON.stringify({ txHash: tx.hash, amountUsdc: 10 }),`,
          `}).then(r => r.json())`,
          ``,
          `// ${cDeposit[4]}`,
          `await fetch(\`/api/v1/balance/deposit/intents/\${intentId}/confirm\`, {`,
          `  method: 'POST',`,
          `  headers: { 'Authorization': \`Bearer \${token}\` },`,
          `})`,
          ``,
          `console.log('${cDeposit[5]}')`,
        ].join('\n')} />
        <StepTip accent={ACCENT}>
          {stepTips[1]}{" "}
          <code className="text-[#c0c5cc] font-mono text-[12px]">X-Idempotency-Key</code>.
        </StepTip>
      </StepItem>

      {/* ── Step 03: Discover ───────────────────────────────────── */}
      <StepItem num="03" title={stepTitles[2] ?? ""} accent={ACCENT} id="step-discover">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[2]}
        </p>
        <CodeBlock lang="typescript" code={[
          `// ${cDiscover[0]}`,
          `const { services } = await fetch(`,
          `  '/api/v1/services/discover?tag=llm&limit=20',`,
          `  { headers: { 'Authorization': \`Bearer \${token}\` } }`,
          `).then(r => r.json())`,
          ``,
          `// ${cDiscover[1]}`,
          `// [`,
          `//   {`,
          `//     serviceId: "svc_abc123",`,
          `//     name: "fast-llm-inference",`,
          `//     pricePerCallUsdc: "0.001",`,
          `//     status: "healthy",`,
          `//     tags: ["llm", "inference"],`,
          `//     provider: "0xProviderWallet..."`,
          `//   }`,
          `// ]`,
          ``,
          `const targetServiceId = services[0].serviceId`,
          `const pricePerCall = services[0].pricePerCallUsdc`,
          `console.log(\`${cDiscover[2].replace(":", ": \${targetServiceId},").replace(":",": \${pricePerCall}")}\`)`,
        ].join('\n')} />
      </StepItem>

      {/* ── Step 04: Credential ─────────────────────────────────── */}
      <StepItem num="04" title={stepTitles[3] ?? ""} accent={ACCENT} id="step-credential">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[3]}
        </p>
        <CodeBlock lang="typescript" code={[
          `// ${cCred[0]}`,
          `const { credentials } = await fetch(`,
          `  '/api/v1/credentials/agent/list?active_only=true',`,
          `  { headers: { 'Authorization': \`Bearer \${token}\` } }`,
          `).then(r => r.json())`,
          ``,
          `let agentToken: string`,
          `let credentialId: string`,
          ``,
          `if (credentials.length > 0) {`,
          `  // ${cCred[1]}`,
          `  credentialId = credentials[0].id`,
          `  console.log('${cCred[7]}', credentialId)`,
          `} else {`,
          `  // ${cCred[2]}`,
          `  const resp = await fetch('/api/v1/credentials/agent/issue', {`,
          `    method: 'POST',`,
          `    headers: {`,
          `      'Authorization': \`Bearer \${token}\`,`,
          `      'Content-Type': 'application/json',`,
          `    },`,
          `    body: JSON.stringify({`,
          `      name: 'my-agent-bot',`,
          `      creditLimit: 1.00,       // ${cCred[3]}`,
          `      maxCalls: 200,           // ${cCred[4]}`,
          `      resetInterval: 'daily',`,
          `    }),`,
          `  }).then(r => r.json())`,
          `  agentToken = resp.credential.token   // ${cCred[5]}`,
          `  credentialId = resp.credential.id`,
          `  console.log('${cCred[6]}', credentialId)`,
          `}`,
          ``,
          `// ${cCred[8]}`,
          `const { valid } = await fetch(`,
          `  \`/api/v1/credentials/agent/\${credentialId}/status\`,`,
          `  { headers: { 'Authorization': \`Bearer \${token}\` } }`,
          `).then(r => r.json())`,
          `if (!valid) console.warn('${cCred[9]}')`,
        ].join('\n')} />
        <StepTip accent={ACCENT}>
          {stepTips[3]}
        </StepTip>
      </StepItem>

      {/* ── Step 05: Invoke ─────────────────────────────────────── */}
      <StepItem num="05" title={stepTitles[4] ?? ""} accent={ACCENT} id="step-invoke">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[4]}
        </p>
        <CodeBlock lang="typescript" code={[
          `// ${cInvoke[0]}`,
          `const invocationKey = crypto.randomUUID()  // ${cInvoke[1]}`,
          ``,
          `const result = await fetch('/api/v1/agent/invoke', {`,
          `  method: 'POST',`,
          `  headers: {`,
          `    'Authorization': \`Bearer \${agentToken}\`,   // ${cInvoke[2]}`,
          `    'Content-Type': 'application/json',`,
          `  },`,
          `  body: JSON.stringify({`,
          `    serviceId: targetServiceId,`,
          `    costUsdc: parseFloat(pricePerCall),  // ${cInvoke[3]}`,
          `    idempotencyKey: invocationKey,`,
          `    payload: { body: { prompt: 'Summarize this document...' } },`,
          `  }),`,
          `}).then(r => r.json())`,
          ``,
          `console.log('Result:', result.result)`,
          `console.log('Charged:', result.chargedUsdc, 'USDC')`,
          `console.log('Invocation ID:', result.invocationId)`,
          `// ${cInvoke[4]}`,
        ].join('\n')} />
        <StepTip accent={ACCENT}>
          {stepTips[4]}
        </StepTip>
      </StepItem>

      {/* ── Step 06: Verify ─────────────────────────────────────── */}
      <StepItem num="06" title={stepTitles[5] ?? ""} accent={ACCENT} id="step-verify">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[5]}
        </p>
        <CodeBlock lang="typescript" code={[
          `// ${cVerify[0]}`,
          `const balance = await fetch('/api/v1/balance', {`,
          `  headers: { 'Authorization': \`Bearer \${token}\` },`,
          `}).then(r => r.json())`,
          ``,
          `console.log('Consumer balance:', balance.consumerBalanceUsdc)`,
          `// ${cVerify[1]}`,
          ``,
          `// ${cVerify[2]}`,
          `const { invocations } = await fetch(`,
          `  '/api/v1/agent/invocations?limit=5',`,
          `  { headers: { 'Authorization': \`Bearer \${token}\` } },`,
          `).then(r => r.json())`,
          ``,
          `const latest = invocations[0]`,
          `console.log('Status:', latest.status)        // ${cVerify[3]}`,
          `console.log('Charged:', latest.chargedUsdc)   // ${cVerify[4]}`,
          `console.log('Settled at:', latest.settledAt)`,
        ].join('\n')} />
        <StepTip accent={ACCENT}>
          {stepTips[5]}
        </StepTip>
      </StepItem>

      {/* ── Step 07: Withdraw ───────────────────────────────────── */}
      <StepItem num="07" title={stepTitles[6] ?? ""} accent={ACCENT} last id="step-withdraw">
        <p className="text-[13px] text-[#71767b] leading-relaxed">
          {stepBodies[6]}
        </p>
        <CodeBlock lang="typescript" code={[
          `// ${cWithdraw[0]}`,
          `const withdrawKey = crypto.randomUUID()  // ${cWithdraw[1]}`,
          ``,
          `const withdraw = await fetch('/api/v1/balance/consumer/withdraw', {`,
          `  method: 'POST',`,
          `  headers: {`,
          `    'Authorization': \`Bearer \${token}\`,`,
          `    'X-Idempotency-Key': withdrawKey,`,
          `    'Content-Type': 'application/json',`,
          `  },`,
          `  body: JSON.stringify({`,
          `    amountUsdc: 5.0,    // Amount to withdraw`,
          `    reason: 'unused balance refund',`,
          `  }),`,
          `}).then(r => r.json())`,
          ``,
          `console.log('Withdraw intent:', withdraw.intentId)`,
          `console.log('Status:', withdraw.status)  // "APPROVED" or "PENDING_MANUAL_REVIEW"`,
          ``,
          `// ${cWithdraw[2]}`,
          `const { withdrawals } = await fetch(`,
          `  '/api/v1/balance/consumer/withdrawals?limit=10',`,
          `  { headers: { 'Authorization': \`Bearer \${token}\` } },`,
          `).then(r => r.json())`,
          ``,
          `// ${cWithdraw[3]}`,
          `withdrawals.forEach(w =>`,
          `  console.log(\`  \${w.intentId}: \${w.amountUsdc} USDC — \${w.status}\`)`,
          `)`,
        ].join('\n')} />
        <StepTip accent={ACCENT}>
          {stepTips[6]}
        </StepTip>

        {/* Completion badge */}
        <div
          className="mt-6 rounded-2xl p-5 flex items-center gap-4"
          style={{ background: `${ACCENT}08`, border: `1px solid ${ACCENT}20` }}
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-[18px] shrink-0"
            style={{ background: `${ACCENT}18` }}
          >
            ✓
          </div>
          <div>
            <div className="text-[14px] font-semibold text-white mb-1">{t("docsPage.consumerCompletionTitle")}</div>
            <p className="text-[13px] text-[#71767b]">
              {t("docsPage.consumerCompletionDescription")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <button
            onClick={() => router.push("/docs/concepts")}
            className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
            style={{ color: ACCENT, background: `${ACCENT}10`, border: `1px solid ${ACCENT}20` }}
          >
            {t("docsPage.consumerDeepDiveCta")} <ArrowRight size={13} />
          </button>
          <button
            onClick={() => router.push("/docs/sdk/typescript")}
            className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg text-[#71767b] hover:text-white transition-colors border border-white/[0.06] hover:border-white/10"
          >
            {t("docsPage.consumerSdkCta")} <ArrowRight size={13} />
          </button>
        </div>
      </StepItem>

      <div className="h-16" />
    </div>
  );
}
