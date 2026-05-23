"use client";

import React from "react";
import Link from "next/link";
import {
  Terminal,
  BookOpen,
  ExternalLink,
  Copy,
  Check,
  Zap,
  Cpu,
  Layers,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { getDocsUrl } from "@/utils/docsUrl";
import { getRuntimeEnvironmentConfig } from "@/utils/runtimeEnv";

// ── Real consumer quickstart codes ──────────────────────────────────────────

function buildTsCode(baseUrl: string) {
  return `// Step 1 — Auth: get challenge + sign → JWT
const BASE = "${baseUrl}"

const { challenge } = await fetch(
  \`\${BASE}/api/v1/auth/challenge?address=\${walletAddress}\`
).then(r => r.json())

const signature = await signer.signMessage(challenge)

const { token } = await fetch(\`\${BASE}/api/v1/auth/verify\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ wallet_address: walletAddress, message: challenge, signature }),
}).then(r => r.json())

// Step 2 — Discover: find a service
const { services } = await fetch(
  \`\${BASE}/api/v1/services/discover?tag=llm&limit=20\`,
  { headers: { 'Authorization': \`Bearer \${token}\` } }
).then(r => r.json())

const { serviceId } = services[0]

// Step 3 — Issue Agent Credential (with spend limits)
const { agentToken, credentialId } = await fetch(
  \`\${BASE}/api/v1/credentials/agent/issue\`,
  {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${token}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'my-agent-bot',
      creditLimit: 1.00,      // daily USDC cap
      maxCalls: 200,
      resetInterval: 'daily',
    }),
  }
).then(r => r.json())

// Step 4 — Invoke service (agent pays, no manual auth needed)
const result = await fetch(\`\${BASE}/api/v1/agent/invocations\`, {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${agentToken}\`,   // ← use agentToken here
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    serviceId,
    payload: { prompt: 'Summarize this document...' },
    idempotencyKey: crypto.randomUUID(),
  }),
}).then(r => r.json())

console.log('Result:', result.data)
console.log('Charged:', result.chargedUsdc, 'USDC')`.trim();
}

function buildPyCode(baseUrl: string) {
  return `import httpx, uuid

BASE = "${baseUrl}"

# Step 1 — Auth: get challenge + sign → JWT
r = httpx.get(f"{BASE}/api/v1/auth/challenge", params={"address": wallet_address})
challenge = r.json()["challenge"]

signature = account.sign_message(encode_defunct(text=challenge)).signature.hex()

token = httpx.post(f"{BASE}/api/v1/auth/verify", json={
    "wallet_address": wallet_address,
    "message": challenge,
    "signature": signature,
}).json()["token"]

headers = {"Authorization": f"Bearer {token}"}

# Step 2 — Discover: find a service
services = httpx.get(
    f"{BASE}/api/v1/services/discover",
    params={"tag": "llm", "limit": 20},
    headers=headers,
).json()["services"]

service_id = services[0]["serviceId"]

# Step 3 — Issue Agent Credential
cred = httpx.post(
    f"{BASE}/api/v1/credentials/agent/issue",
    headers=headers,
    json={
        "name": "my-agent-bot",
        "creditLimit": 1.00,   # daily USDC cap
        "maxCalls": 200,
        "resetInterval": "daily",
    },
).json()

agent_token = cred["agentToken"]   # agt_xxxxx...

# Step 4 — Invoke service (agent pays)
result = httpx.post(
    f"{BASE}/api/v1/agent/invocations",
    headers={"Authorization": f"Bearer {agent_token}",
             "Content-Type": "application/json"},
    json={
        "serviceId": service_id,
        "payload": {"prompt": "Summarize this document..."},
        "idempotencyKey": str(uuid.uuid4()),
    },
).json()

print("Result:", result["data"])
print("Charged:", result["chargedUsdc"], "USDC")`.trim();
}

const SDK_SOURCE_REPO =
  "https://github.com/SynapseNetworkAI/Synapse-Network-Sdk";
const SDK_INSTALL_OPTIONS = [
  {
    key: "typescript",
    label: "TypeScript",
    install: "npm install @synapse-network-ai/sdk@1.0.0",
    registry: "https://www.npmjs.com/package/@synapse-network-ai/sdk/v/1.0.0",
  },
  {
    key: "python",
    label: "Python",
    install: "pip install synapse-network-ai-sdk==1.0.0",
    registry: "https://pypi.org/project/synapse-network-ai-sdk/1.0.0/",
  },
  {
    key: "go",
    label: "Go",
    install: "go get github.com/SynapseNetworkAI/Synapse-Network-Sdk/go@v1.0.0",
    registry:
      "https://pkg.go.dev/github.com/SynapseNetworkAI/Synapse-Network-Sdk/go@v1.0.0",
  },
  {
    key: "java",
    label: "Java",
    install:
      "mvn dependency:get -Dartifact=ai.synapse-network:synapse-network-sdk:1.0.0",
    registry:
      "https://repo1.maven.org/maven2/ai/synapse-network/synapse-network-sdk/1.0.0/",
  },
  {
    key: "dotnet",
    label: ".NET",
    install: "dotnet add package SynapseNetwork.Sdk --version 1.0.0",
    registry: "https://www.nuget.org/packages/SynapseNetwork.Sdk/1.0.0",
  },
];

// ── Docs sidebar links — pointing to the dedicated docs project ─────────────

const DOC_LINKS = [
  {
    label: "Agent Builder Quick Start",
    href: getDocsUrl("/get-started/agent-builders"),
  },
  {
    label: "Authentication & Auth",
    href: getDocsUrl("/api-reference#authentication"),
  },
  { label: "Discover Services", href: getDocsUrl("/api-reference#services") },
  {
    label: "Agent Credentials",
    href: getDocsUrl("/concepts/budget-isolation"),
  },
  {
    label: "Invoke & Settle",
    href: getDocsUrl("/get-started/first-paid-invocation"),
  },
  {
    label: "Quote & Settlement",
    href: getDocsUrl("/concepts/agent-settlement"),
  },
  { label: "API Reference", href: getDocsUrl("/api-reference") },
  { label: "Python SDK", href: getDocsUrl("/sdks/python") },
  { label: "TypeScript SDK", href: getDocsUrl("/sdks/typescript") },
  { label: "Go SDK", href: getDocsUrl("/sdks/go") },
  { label: "Java/JVM SDK", href: getDocsUrl("/sdks/java") },
  { label: ".NET SDK", href: getDocsUrl("/sdks/dotnet") },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function DeveloperPage() {
  const { t } = useLanguage();
  const [sdk, setSdk] = React.useState<"ts" | "py">("ts");
  const [copied, setCopied] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const envConfig = getRuntimeEnvironmentConfig();

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const code =
    sdk === "ts"
      ? buildTsCode(envConfig.gatewayBaseUrl)
      : buildPyCode(envConfig.gatewayBaseUrl);
  return (
    <div className="p-8 space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Terminal className="w-5 h-5 text-blue-400" />
            {t("developerPage.title")}
          </h1>
          <p className="text-sm text-[#6b7280] mt-1">
            {t("developerPage.description")}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/dashboard/credentials"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/10 text-white hover:border-blue-400/40 hover:bg-white/[0.04] transition-colors"
          >
            {t("developerPage.agentCredentials")}
          </Link>
          <Link
            href="/dashboard/billing"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/10 text-white hover:border-amber-400/40 hover:bg-white/[0.04] transition-colors"
          >
            {t("developerPage.ownerTreasury")}
          </Link>
          <a
            href={getDocsUrl("/get-started/agent-builders")}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-400 transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5" />
            {t("developerPage.fullDocumentation")}
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* ── Left: Quickstart ── */}
        <div className="lg:col-span-8 space-y-4">
          {/* Title + SDK tabs */}
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              {t("developerPage.quickstartGuide")}
            </h2>
            <div className="flex p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <button
                onClick={() => setSdk("ts")}
                className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                  sdk === "ts"
                    ? "bg-white text-black"
                    : "text-[#6b7280] hover:text-gray-300"
                }`}
              >
                TypeScript
              </button>
              <button
                onClick={() => setSdk("py")}
                className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                  sdk === "py"
                    ? "bg-white text-black"
                    : "text-[#6b7280] hover:text-gray-300"
                }`}
              >
                Python
              </button>
            </div>
          </div>

          {/* Code block — collapsible */}
          <div className="rounded-2xl border border-white/[0.06] bg-[#0a0b0d] overflow-hidden">
            {/* Header bar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-[#4e535a] font-mono">
                {sdk === "ts" ? "typescript" : "python"}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => copy(code, "code")}
                  className="p-1.5 rounded-md text-[#71767b] hover:text-white hover:bg-white/[0.08] transition-colors"
                  aria-label="Copy code"
                >
                  {copied === "code" ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Code area with collapse */}
            <div
              className="relative transition-all duration-300 ease-in-out"
              style={{
                maxHeight: expanded ? "1200px" : "380px",
                overflow: "hidden",
              }}
            >
              <pre className="p-5 font-mono text-[12.5px] leading-relaxed text-[#c9d1d9] whitespace-pre overflow-x-auto">
                <code>{code}</code>
              </pre>

              {/* Fade mask when collapsed */}
              {!expanded && (
                <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#0a0b0d] to-transparent pointer-events-none" />
              )}
            </div>

            {/* Expand / Collapse toggle */}
            <button
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 py-2 border-t border-white/[0.06] text-[11px] font-semibold text-[#6b7280] hover:text-white hover:bg-white/[0.03] transition-colors"
            >
              {expanded ? "Collapse" : "Expand full code"}
              <ChevronDown
                className="w-3.5 h-3.5 transition-transform duration-200"
                style={{
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                }}
              />
            </button>
          </div>

          {/* Install + MCP cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] transition-all">
              <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 w-fit mb-3">
                <Cpu className="w-4 h-4 text-blue-400" />
              </div>
              <h4 className="text-sm font-bold text-white mb-1">
                {t("developerPage.sdkInstallationTitle")}
              </h4>
              <p className="text-xs text-[#6b7280] leading-relaxed mb-3">
                {t("developerPage.sdkInstallationDescription")}
              </p>
              <div className="space-y-2">
                {SDK_INSTALL_OPTIONS.map((item) => (
                  <div
                    key={item.key}
                    className="rounded-lg bg-black border border-white/[0.06] p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#6b7280]">
                        {item.label}
                      </span>
                      <a
                        href={item.registry}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-400 hover:text-blue-300"
                      >
                        Open registry
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <code className="break-all text-[11px] font-mono text-[#9ca3af]">
                        {item.install}
                      </code>
                      <button
                        onClick={() =>
                          copy(item.install, `install-${item.key}`)
                        }
                        className="shrink-0 text-[#4b5563] hover:text-white transition-colors ml-2"
                        aria-label={`Copy ${item.label} install command`}
                      >
                        {copied === `install-${item.key}` ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
                <a
                  href={SDK_SOURCE_REPO}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-widest"
                >
                  Source repository
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] transition-all">
              <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 w-fit mb-3">
                <Layers className="w-4 h-4 text-purple-400" />
              </div>
              <h4 className="text-sm font-bold text-white mb-1">
                {t("developerPage.mcpIntegrationTitle")}
              </h4>
              <p className="text-xs text-[#6b7280] leading-relaxed mb-3">
                {t("developerPage.mcpIntegrationDescription")}
              </p>
              <a
                href={getDocsUrl("/sdks/mcp-agent-tooling")}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-purple-400 hover:text-purple-300 transition-colors uppercase tracking-widest"
              >
                {t("developerPage.viewMcpGuide")}
                <ArrowRight className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* ── Right: Documentation sidebar ── */}
        <div className="lg:col-span-4 space-y-6">
          <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-base font-bold text-white">
                Runtime environment
              </h2>
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
                {envConfig.appEnv}
              </span>
            </div>
            <dl className="space-y-3 text-xs">
              {[
                ["Gateway Base", envConfig.gatewayBaseUrl],
                ["Docs Base", envConfig.docsBaseUrl],
                ["Explorer Base", envConfig.txExplorerBaseUrl],
                ["Chain", `${envConfig.chainName} (${envConfig.chainId})`],
              ].map(([label, value]) => (
                <div key={label} className="space-y-1">
                  <dt className="text-[#6b7280]">{label}</dt>
                  <dd className="break-all font-mono text-[#d1d5db]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="space-y-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-400" />
              {t("developerPage.documentationTitle")}
            </h2>
            <div className="space-y-1.5">
              {DOC_LINKS.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.05] hover:border-white/10 transition-all group"
                >
                  <span className="text-xs font-medium text-[#9ca3af] group-hover:text-white transition-colors">
                    {item.label}
                  </span>
                  <ExternalLink className="w-3 h-3 text-[#4b5563] group-hover:text-blue-400 transition-colors shrink-0" />
                </a>
              ))}
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-500/8 to-transparent border border-blue-500/20">
            <h3 className="text-sm font-bold text-white mb-1">
              {t("developerPage.needHelpTitle")}
            </h3>
            <p className="text-xs text-[#6b7280] leading-relaxed mb-4">
              {t("developerPage.needHelpDescription")}
            </p>
            <button className="w-full py-2.5 bg-white text-black rounded-lg text-[11px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors">
              {t("developerPage.joinDiscord")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
