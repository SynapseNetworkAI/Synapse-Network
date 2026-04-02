"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, ExternalLink } from "lucide-react";
import { NAV_TREE } from "../nav-tree";
import { useDocsActive } from "../active-context";

export default function DocsSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { activeId } = useDocsActive();
  // Start all sections open
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  /** True when this nav item represents the currently visible section. */
  const isActive = (href: string, id: string): boolean => {
    const [hrefPath, hrefHash] = href.split("#");
    if (hrefPath !== pathname) return false;
    if (activeId) return id === activeId;
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
      className="hidden lg:flex flex-col w-[240px] shrink-0 sticky top-[100px] h-[calc(100vh-100px)] overflow-y-auto border-r border-white/[0.05]"
      style={{ background: "#08090b" }}
    >
      <nav className="py-3 px-2" aria-label="Docs navigation">
        {NAV_TREE.map((section) => {
          const isOpen = collapsed[section.id] !== true;

          return (
            <div key={section.id} className="mb-1">

              {/* ── Section header ─────────────────────────── */}
              <button
                onClick={() => toggle(section.id)}
                className="w-full flex items-center justify-between px-2 py-[7px] text-left group"
              >
                <span className="text-[10.5px] font-semibold tracking-[0.1em] uppercase text-[#636870] group-hover:text-[#8b98a5] transition-colors">
                  {section.label}
                </span>
                <ChevronRight
                  size={12}
                  className="text-[#3a3f45] group-hover:text-[#636870] transition-transform duration-150"
                  style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                />
              </button>

              {/* ── Section items ──────────────────────────── */}
              {isOpen && (
                <div className="mb-2 space-y-px">
                  {section.items.map((item) => {
                    const isChild = item.label.startsWith("↳");

                    // Child items only render when we're on their matching page
                    if (isChild) {
                      const [childPath] = item.href.split("#");
                      if (pathname !== childPath) return null;
                    }

                    const active = isActive(item.href, item.id);
                    const cleanLabel = isChild
                      ? item.label.slice(2) // strip "↳ "
                      : item.label;

                    /* ── Child anchor item ── */
                    if (isChild) {
                      return (
                        <div
                          key={item.id}
                          className="relative ml-[22px]"
                          style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}
                        >
                          {/* Active tick on the left border */}
                          {active && (
                            <span
                              className="absolute -left-px top-1/2 -translate-y-1/2 w-[2px] h-[16px] rounded-full"
                              style={{ background: "#7ff7be" }}
                            />
                          )}
                          <button
                            onClick={() => handleNav(item.href)}
                            className={[
                              "w-full flex items-center gap-2 pl-3 pr-2 py-[5px] text-left rounded-r-md transition-colors text-[12.5px] leading-[1.4]",
                              active
                                ? "text-white"
                                : "text-[#8b98a5] hover:text-[#c8d0d8]",
                            ].join(" ")}
                          >
                            <span
                              className="w-[5px] h-[5px] rounded-full shrink-0 transition-colors"
                              style={{ background: active ? "#7ff7be" : "rgba(255,255,255,0.12)" }}
                            />
                            {cleanLabel}
                          </button>
                        </div>
                      );
                    }

                    /* ── Parent page item ── */
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleNav(item.href)}
                        className={[
                          "relative w-full flex items-center gap-2 px-3 py-[7px] rounded-lg text-left text-[13px] transition-colors",
                          active
                            ? "text-white bg-white/[0.06]"
                            : "text-[#c0c8d0] hover:text-white hover:bg-white/[0.04]",
                        ].join(" ")}
                      >
                        {/* Left green bar for active */}
                        {active && (
                          <span
                            className="absolute left-0 top-[6px] bottom-[6px] w-[2px] rounded-full"
                            style={{ background: "#7ff7be" }}
                          />
                        )}
                        <span className="flex-1 min-w-0 pl-[2px]">{cleanLabel}</span>
                        {item.soon && (
                          <span className="text-[10px] text-[#636870] border border-white/[0.08] px-1.5 py-0.5 rounded-md font-mono shrink-0">
                            SOON
                          </span>
                        )}
                        {item.external && (
                          <ExternalLink size={11} className="text-[#636870] shrink-0" />
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

