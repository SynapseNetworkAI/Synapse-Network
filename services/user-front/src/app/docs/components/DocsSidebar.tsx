"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, ExternalLink } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { useDocsNavigationFeedback } from "../DocsNavigationFeedback";
import { getDocsNavTree } from "../nav-tree";
import { useDocsActive } from "../active-context";
import { warmAllDocsRoutes, warmDocsRoute } from "../navigationWarmup";

export default function DocsSidebar() {
  const pathname = usePathname();
  const activePath = pathname ?? "/docs";
  const router = useRouter();
  const { tList, t } = useLanguage();
  const { activeId } = useDocsActive();
  const { beginNavigation } = useDocsNavigationFeedback();
  const navTree = getDocsNavTree(
    tList("docsPage.sidebarSectionLabels"),
    tList("docsPage.sidebarItemLabels"),
    t("docsPage.sidebarSoon"),
  );
  // Start all sections open
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    const warmup = () => {
      warmAllDocsRoutes(router);
    };

    if (typeof globalThis.requestIdleCallback === "function") {
      const idleId = globalThis.requestIdleCallback(warmup, { timeout: 800 });
      return () => globalThis.cancelIdleCallback(idleId);
    }

    const timeoutId = globalThis.setTimeout(warmup, 80);
    return () => globalThis.clearTimeout(timeoutId);
  }, [router]);

  useEffect(() => {
    setPendingHref(null);
  }, [activePath]);

  const toggle = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  /** True when this nav item represents the currently visible section. */
  const isActive = (href: string, id: string): boolean => {
    const [hrefPath, hrefHash] = href.split("#");
    if (hrefPath !== pathname) return false;
    if (activeId) return id === activeId;
    return !hrefHash;
  };

  const prefetchRoute = useCallback(
    (href: string) => {
      warmDocsRoute(router, href);
    },
    [router]
  );

  const queueNavigation = useCallback(
    (href: string) => {
      const [path] = href.split("#");
      if (path && path !== activePath) {
        beginNavigation(path);
      }
      setPendingHref(href);

      const navigate = () => {
        router.push(href);
      };

      if (typeof globalThis.requestAnimationFrame === "function") {
        globalThis.requestAnimationFrame(navigate);
        return;
      }

      globalThis.setTimeout(navigate, 0);
    },
    [activePath, beginNavigation, router]
  );

  const handleNav = (href: string) => {
    if (!href || href === "#") {
      return;
    }

    if (href.startsWith("http")) {
      globalThis.open(href, "_blank", "noopener,noreferrer");
      return;
    }

    const [path, hash] = href.split("#");
    if (path === activePath && hash) {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (path === activePath && !hash) {
      return;
    }

    queueNavigation(href);
  };

  return (
    <aside
      data-testid="docs-sidebar"
      className="hidden lg:flex flex-col w-[240px] shrink-0 sticky top-[100px] h-[calc(100vh-100px)] overflow-y-auto border-r border-white/[0.05]"
      style={{ background: "#08090b" }}
    >
      <nav className="py-3 px-2" aria-label="Docs navigation">
        {navTree.map((section) => {
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
                    const pending = pendingHref === item.href;
                    const cleanLabel = isChild
                      ? item.label.slice(2) // strip "↳ "
                      : item.label;

                    // Pre-compute class names — use if/else to satisfy no-nested-ternary rule
                    let childCls = "text-[#8b98a5] hover:text-[#c8d0d8]";
                    if (active) childCls = "text-white";
                    else if (pending) childCls = "text-[#7ff7be]/60";

                    let parentCls = "text-[#c0c8d0] hover:text-white hover:bg-white/[0.04]";
                    if (active) parentCls = "text-white bg-white/[0.06]";
                    else if (pending) parentCls = "text-[#7ff7be]/60 bg-white/[0.03]";

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
                            onMouseEnter={() => prefetchRoute(item.href)}
                            onFocus={() => prefetchRoute(item.href)}
                            className={[
                              "w-full flex items-center gap-2 pl-3 pr-2 py-[5px] text-left rounded-r-md transition-colors text-[12.5px] leading-[1.4]",
                              childCls,
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
                        onMouseEnter={() => prefetchRoute(item.href)}
                        onFocus={() => prefetchRoute(item.href)}
                        className={[
                          "relative w-full flex items-center gap-2 px-3 py-[7px] rounded-lg text-left text-[13px] transition-colors",
                          parentCls,
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
                            {t("docsPage.sidebarSoon")}
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
