"use client";

import React from "react";
import { Terminal, Code, BookOpen, ExternalLink, Copy, Check, Zap, Cpu, Layers } from "lucide-react";

export default function DeveloperPage() {
  const [copied, setCopied] = React.useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
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
            Developer Resources
          </h1>
          <p className="text-sm text-gray-500 mt-1">Integrate Synapse M2M payments into your autonomous agent workflows.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-400 transition-colors">
            <BookOpen className="w-3.5 h-3.5" />
            Full Documentation
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
              Quickstart Guide
            </h2>
            <div className="flex p-1 rounded-lg bg-white/[0.03] border border-white/5">
              <button className="px-3 py-1 rounded-md text-[10px] font-bold bg-white text-black">TypeScript</button>
              <button className="px-3 py-1 rounded-md text-[10px] font-bold text-gray-500 hover:text-gray-300">Python</button>
            </div>
          </div>
          
          <div className="relative group">
            <div className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={() => copyToClipboard(quickstartCode, "code")}
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
              <h4 className="text-sm font-bold text-white mb-2">SDK Installation</h4>
              <p className="text-xs text-gray-500 leading-relaxed mb-4">Install the Synapse SDK to handle discovery, quoting, and invocation in your agent code.</p>
              <div className="flex items-center justify-between p-3 rounded-lg bg-black border border-white/5">
                <code className="text-[11px] font-mono text-gray-400">npm install @synapse/sdk</code>
                <button onClick={() => copyToClipboard("npm install @synapse/sdk", "npm")} className="text-gray-600 hover:text-white transition-colors">
                  {copied === "npm" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all">
              <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 w-fit mb-4">
                <Layers className="w-5 h-5 text-purple-400" />
              </div>
              <h4 className="text-sm font-bold text-white mb-2">MCP Integration</h4>
              <p className="text-xs text-gray-500 leading-relaxed mb-4">Connect Synapse to Model Context Protocol (MCP) servers for seamless tool use with LLMs.</p>
              <button className="flex items-center gap-2 text-[11px] font-bold text-purple-400 hover:text-purple-300 transition-colors uppercase tracking-widest">
                View MCP Guide
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
              Documentation
            </h2>
            <div className="space-y-2">
              {[
                "Authentication & Credentials",
                "Discovery Protocol",
                "Quote & Settlement",
                "Budget Policy Engine",
                "Error Handling Contract",
                "Webhook Integration"
              ].map((item, idx) => (
                <button key={idx} className="w-full flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all group">
                  <span className="text-xs font-medium text-gray-400 group-hover:text-white transition-colors">{item}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-600 group-hover:text-blue-400 transition-all" />
                </button>
              ))}
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-gradient-to-br from-blue-500/10 to-transparent border border-blue-500/20">
            <h3 className="text-sm font-bold text-white mb-2">Need Help?</h3>
            <p className="text-xs text-gray-500 leading-relaxed mb-4">Join our developer community to get support and share your agentic projects.</p>
            <button className="w-full py-2.5 bg-white text-black rounded-lg text-[11px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors">
              Join Discord
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ArrowRight({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
    </svg>
  );
}
