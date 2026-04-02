"use client";

import React from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Terminal, BookOpen, ExternalLink, Copy, Check, Zap, Cpu, Layers } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";

export default function DeveloperPage() {
  const { t, tList } = useLanguage();
  const [copied, setCopied] = React.useState<string | null>(null);
  const docSections = tList("developerPage.docSections");

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    toast.success(id === "code" ? t("developerPage.quickstartCodeCopied") : t("developerPage.installCommandCopied"));
    setTimeout(() => setCopied(null), 2000);
  };

  const quickstartCode = `import { SynapseClient } from "@synapse/sdk";

const client = new SynapseClient({
  credential: "your_agent_credential_here"
});

// 1. Discover Service
const services = await client.discovery.search("text-generation");

// 2. Get Quote
const quote = await client.quote.get(services[0].id);

// 3. Invoke Service
const result = await client.invoke.call(quote.id, {
  prompt: "Hello, Synapse!"
});

console.log(result.data);`;

  return (
    <div className="p-8 space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Terminal className="w-6 h-6 text-blue-400" />
            {t("developerPage.title")}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t("developerPage.description")}</p>
        </div>
        
        <div className="flex items-center gap-3">
          <Link href="/dashboard/credentials" className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border border-white/10 text-white hover:border-blue-400/40 hover:bg-white/[0.04] transition-colors">
            {t("developerPage.agentCredentials")}
          </Link>
          <Link href="/dashboard/billing" className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border border-white/10 text-white hover:border-amber-400/40 hover:bg-white/[0.04] transition-colors">
            {t("developerPage.ownerTreasury")}
          </Link>
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-400 transition-colors">
            <BookOpen className="w-3.5 h-3.5" />
            {t("developerPage.fullDocumentation")}
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* QUICKSTART */}
        <div className="lg:col-span-8 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              {t("developerPage.quickstartGuide")}
            </h2>
            <div className="flex p-1 rounded-lg bg-white/[0.03] border border-white/5">
              <button className="px-3 py-1 rounded-md text-[10px] font-bold bg-white text-black">{t("developerPage.quickstartTypeScript")}</button>
              <button className="px-3 py-1 rounded-md text-[10px] font-bold text-gray-500 hover:text-gray-300">{t("developerPage.quickstartPython")}</button>
            </div>
          </div>
          
          <div className="relative group">
            <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={() => copyToClipboard(quickstartCode, "code")}
                aria-label={t("developerPage.quickstartCopyCode")}
                title={t("developerPage.quickstartCopyCode")}
                className="p-2 rounded-lg bg-white/10 border border-white/10 hover:bg-white/20 transition-colors"
              >
                {copied === "code" ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-gray-400" />}
              </button>
            </div>
            <pre className="p-6 rounded-2xl bg-[#0a0a0c] border border-white/5 overflow-x-auto font-mono text-sm leading-relaxed text-blue-300/80">
              <code>{quickstartCode}</code>
            </pre>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all">
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 w-fit mb-4">
                <Cpu className="w-5 h-5 text-blue-400" />
              </div>
              <h4 className="text-sm font-bold text-white mb-2">{t("developerPage.sdkInstallationTitle")}</h4>
              <p className="text-xs text-gray-500 leading-relaxed mb-4">{t("developerPage.sdkInstallationDescription")}</p>
              <div className="flex items-center justify-between p-3 rounded-lg bg-black border border-white/5">
                <code className="text-[11px] font-mono text-gray-400">{t("developerPage.sdkInstallCommand")}</code>
                <button
                  onClick={() => copyToClipboard(t("developerPage.sdkInstallCommand"), "npm")}
                  aria-label={t("developerPage.copyInstallCommand")}
                  title={t("developerPage.copyInstallCommand")}
                  className="text-gray-600 hover:text-white transition-colors"
                >
                  {copied === "npm" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all">
              <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 w-fit mb-4">
                <Layers className="w-5 h-5 text-purple-400" />
              </div>
              <h4 className="text-sm font-bold text-white mb-2">{t("developerPage.mcpIntegrationTitle")}</h4>
              <p className="text-xs text-gray-500 leading-relaxed mb-4">{t("developerPage.mcpIntegrationDescription")}</p>
              <button className="flex items-center gap-2 text-[11px] font-bold text-purple-400 hover:text-purple-300 transition-colors uppercase tracking-widest">
                {t("developerPage.viewMcpGuide")}
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* SIDEBAR RESOURCES */}
        <div className="lg:col-span-4 space-y-8">
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-blue-400" />
              {t("developerPage.documentationTitle")}
            </h2>
            <div className="space-y-2">
              {docSections.map((item) => (
                <button key={item} className="w-full flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all group">
                  <span className="text-xs font-medium text-gray-400 group-hover:text-white transition-colors">{item}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-600 group-hover:text-blue-400 transition-all" />
                </button>
              ))}
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-gradient-to-br from-blue-500/10 to-transparent border border-blue-500/20">
            <h3 className="text-sm font-bold text-white mb-2">{t("developerPage.needHelpTitle")}</h3>
            <p className="text-xs text-gray-500 leading-relaxed mb-4">{t("developerPage.needHelpDescription")}</p>
            <button className="w-full py-2.5 bg-white text-black rounded-lg text-[11px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors">
              {t("developerPage.joinDiscord")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ArrowRight({ className }: Readonly<{ className?: string }>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
    </svg>
  );
}
