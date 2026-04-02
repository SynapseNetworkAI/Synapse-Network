"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import LanguageSwitcher from "@/components/i18n/LanguageSwitcher";

const TABS = [
  { label: "Overview",        href: "/docs" },
  { label: "Getting Started", href: "/docs/getting-started" },
  { label: "Concepts",        href: "/docs/concepts" },
  { label: "API Reference",   href: "/docs/api-reference" },
  { label: "SDK",             href: "/docs/sdk" },
  { label: "Contracts",       href: "/docs/contracts" },
] as const;

function matchTab(pathname: string) {
  // Most specific match first
  for (const tab of [...TABS].reverse()) {
    if (pathname === tab.href || pathname.startsWith(tab.href + "/")) {
      return tab.href;
    }
  }
  return "/docs";
}

export default function DocsTopNav() {
  const pathname = usePathname();
  const active = matchTab(pathname ?? "/docs");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 2);
    window.addEventListener("scroll", fn, { passive: true });
    fn();
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const brandMark = (
    <span className="relative inline-flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-[#2a2d31] bg-[#0d0f12]">
      <span className="absolute inset-[4px] rounded-[5px] border border-white/[0.06]" />
      <span className="absolute left-[7px] top-[9px] h-[5px] w-[5px] rounded-full bg-[#7ff7be]" style={{ boxShadow: "0 0 8px rgba(127,247,190,0.6)" }} />
      <span className="absolute right-[7px] bottom-[9px] h-[5px] w-[5px] rounded-full bg-white/80" />
      <span className="absolute left-[9px] right-[9px] top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-white/0 via-white/40 to-white/0" />
    </span>
  );

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex flex-col" style={{ background: "#000000" }}>

      {/* ─── Top bar ─────────────────────────────────────── 56px */}
      <div
        className="flex items-center h-[56px] px-4 lg:px-6 gap-4 border-b"
        style={{
          borderColor: scrolled ? "#1f2328" : "#1a1d20",
          transition: "border-color 0.15s",
        }}
      >
        {/* Left: logo + name */}
        <Link
          href="/docs"
          className="flex items-center gap-2.5 shrink-0 group"
          aria-label="Synapse Developer Platform"
        >
          {brandMark}
          <div className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-[#e7e9ea] group-hover:text-white transition-colors">
              Synapse
              <span className="text-[#4e535a] font-normal"> · </span>
              <span className="text-[#71767b] font-normal">Developer Platform</span>
            </span>
          </div>
        </Link>

        {/* Center: search */}
        <div className="flex-1 flex justify-center px-4">
          <button
            type="button"
            className="hidden md:flex h-[36px] w-full max-w-[440px] items-center gap-3 rounded-[10px] border border-[#2f3336] bg-transparent px-4 text-left text-[#71767b] transition hover:border-[#3d4043] hover:bg-[#080808] hover:text-[#e7e9ea]"
            aria-label="Search docs"
          >
            <Search className="h-[15px] w-[15px] shrink-0" />
            <span className="flex-1 text-[14px] font-normal truncate">Search docs...</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[11px] text-[#3d4043] font-mono">
              Ctrl K
            </kbd>
          </button>
        </div>

        {/* Right: lang + console CTA */}
        <div className="flex items-center gap-3 shrink-0">
          <LanguageSwitcher className="tracking-[0.01em] h-[34px] rounded-[8px] border border-[#2f3336] bg-transparent text-[#71767b] text-[13px] hover:border-[#3d4043] hover:bg-[#0a0a0a] hover:text-[#e7e9ea] transition focus-visible:border-[#536471]" />
          <Link
            href="/dashboard/overview"
            className="hidden sm:inline-flex items-center gap-1.5 h-[34px] px-4 rounded-[10px] bg-white text-[#0f1419] text-[13px] font-semibold tracking-[-0.01em] hover:bg-[#e7e9ea] transition-colors"
          >
            Developer Console
            <span className="text-[#536471]">→</span>
          </Link>
        </div>
      </div>

      {/* ─── Tab bar ─────────────────────────────────────── 44px */}
      <div
        className="flex items-center h-[44px] px-4 lg:px-6 border-b gap-0 overflow-x-auto scrollbar-hide"
        style={{ borderColor: "#1a1d20" }}
      >
        {TABS.map((tab) => {
          const isActive = active === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="relative flex items-center h-full px-3.5 text-[14px] font-normal shrink-0 transition-colors"
              style={{
                color: isActive ? "#e7e9ea" : "#71767b",
              }}
            >
              {tab.label}
              {isActive && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-[2px]"
                  style={{ background: "#7ff7be" }}
                />
              )}
            </Link>
          );
        })}
      </div>

    </div>
  );
}
