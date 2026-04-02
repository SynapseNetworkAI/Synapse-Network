"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Search, ExternalLink } from "lucide-react";
import { NAV_TREE } from "../nav-tree";
import { useDocsActive } from "../active-context";

export default function DocsSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { activeId } = useDocsActive();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  /** True when this nav item represents the currently visible section. */
  const isActive = (href: string, id: string): boolean => {
    const [hrefPath, hrefHash] = href.split("#");
    if (hrefPath !== pathname) return false;
    // If the global scroll-tracker has fired, use it.
    if (activeId) return id === activeId;
    // Fallback: the page-root item (no hash) is active on first load.
    return !hrefHash;
  };

  const handleNav = (href: string) => {
    const [path, hash] = href.split("#");
    if (path === pathname && hash) {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    router.push(href);
  };

  return (
    <aside
      data-testid="docs-sidebar"
      className="hidden lg:flex flex-col w-[240px] shrink-0 sticky top-[56px] h-[calc(100vh-56px)] overflow-y-auto border-r border-white/[0.045]"
      style={{ background: "#08090b" }}
    >
      {/* Search stub */}
      <div className="px-4 py-3 border-b border-white/[0.045]">
        <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[#4e535a] hover:border-white/10 transition-colors">
          <Search size={13} />
          <span className="text-[12px] text-[#4e535a]">Search docs...</span>
          <span className="ml-auto text-[10px] text-[#2e3338] border border-white/10 px-1.5 py-0.5 rounded font-mono">
            ⌘K
          </span>
        </button>
      </div>

      <nav className="py-4 px-2 space-y-1" aria-label="Docs navigation">
        {NAV_TREE.map((section) => {
          const isOpen = collapsed[section.id] !== true;
          return (
            <div key={section.id}>
              <button
                onClick={() => toggle(section.id)}
                className="w-full flex items-center justify-between px-2 py-1.5 text-left"
              >
                <span className="text-[10px] font-semibold tracking-[0.12em] text-[#4e535a] uppercase">
                  {section.label}
                </span>
                {isOpen ? (
                  <ChevronDown size={12} className="text-[#3a3f45]" />
                ) : (
                  <ChevronRight size={12} className="text-[#3a3f45]" />
                )}
              </button>

              {isOpen && (
                <div className="mt-0.5 mb-1 space-y-0.5">
                  {section.items.map((item) => {
                    const active = isActive(item.href, item.id);
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleNav(item.href)}
                        className={[
                          "w-full flex items-center gap-2 px-3 py-[7px] rounded-lg text-left transition-colors text-[13px]",
                          active
                            ? "bg-[#7ff7be]/[0.06] text-white border-l-[3px] border-[#7ff7be] rounded-l-none pl-[calc(12px-3px)]"
                            : "text-[#71767b] hover:text-[#c0c5cc] hover:bg-white/[0.03]",
                        ].join(" ")}
                      >
                        <span>{item.label}</span>
                        {item.soon && (
                          <span className="ml-auto text-[10px] text-[#4e535a] border border-white/10 px-1 rounded">
                            SOON
                          </span>
                        )}
                        {item.external && (
                          <ExternalLink size={11} className="ml-auto text-[#4e535a]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
