"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function CopyButton({ text }: Readonly<{ text: string }>) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="absolute top-2.5 right-2.5 p-1.5 rounded-md text-[#71767b] hover:text-white hover:bg-white/[0.08] transition-colors"
      aria-label="Copy code"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

export function CodeBlock({
  code,
  lang = "bash",
}: Readonly<{ code: string; lang?: string }>) {
  return (
    <div className="relative mt-4 rounded-xl overflow-hidden border border-white/[0.06] bg-[#0a0b0d]">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5">
        <span className="text-[10px] font-semibold tracking-widest uppercase text-[#4e535a] font-mono">
          {lang}
        </span>
      </div>
      <pre className="p-4 text-[13px] font-mono text-[#c9d1d9] leading-relaxed overflow-x-auto whitespace-pre">
        {code.trim()}
      </pre>
      <CopyButton text={code.trim()} />
    </div>
  );
}
