"use client";

import { useMemo, useState } from "react";

type Tab = {
  label: string;
  code: string;
};

export function CodeTabs({ tabs }: Readonly<{ tabs: Tab[] }>) {
  const safeTabs = useMemo(() => tabs.filter((tab) => tab.code.trim()), [tabs]);
  const [active, setActive] = useState(safeTabs[0]?.label ?? "");
  const current = safeTabs.find((tab) => tab.label === active) ?? safeTabs[0];

  if (!current) return null;

  return (
    <div className="synapse-code-panel overflow-hidden rounded-[10px]">
      <div className="flex border-b border-white/[0.08] bg-white/[0.025]">
        {safeTabs.map((tab) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActive(tab.label)}
            className={[
              "h-10 px-3 text-xs font-semibold transition",
              current.label === tab.label
                ? "bg-white/[0.08] text-[#7ff7be]"
                : "text-fd-muted-foreground hover:text-fd-foreground",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <pre className="max-h-[520px] overflow-auto p-4 text-[12px] leading-6 text-[#d6fbe7]">
        <code>{current.code}</code>
      </pre>
    </div>
  );
}
