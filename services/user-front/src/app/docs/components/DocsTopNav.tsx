"use client";

import Link from "next/link";
import Image from "next/image";
import { Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback, type MouseEvent } from "react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import LanguageSwitcher from "@/components/i18n/LanguageSwitcher";
import { useDocsNavigationFeedback } from "../DocsNavigationFeedback";
import { warmDocsRoute } from "../navigationWarmup";

const TAB_HREFS = ["/docs", "/docs/getting-started", "/docs/concepts", "/docs/api-reference", "/docs/sdk", "/docs/contracts"] as const;

function matchTab(pathname: string) {
  // Most specific match first
  for (const href of [...TAB_HREFS].reverse()) {
    if (pathname === href || pathname.startsWith(href + "/")) {
      return href;
    }
  }
  return "/docs";
}

export default function DocsTopNav() {
  const pathname = usePathname();
  const activePath = pathname ?? "/docs";
  const router = useRouter();
  const { tList, t } = useLanguage();
  const { beginNavigation } = useDocsNavigationFeedback();
  const active = matchTab(pathname ?? "/docs");
  const [scrolled, setScrolled] = useState(false);
  const tabs = tList("docsPage.topNavTabs");

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 2);
    window.addEventListener("scroll", fn, { passive: true });
    fn();
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const queueNavigation = useCallback(
    (href: string) => {
      if (href === activePath) {
        return;
      }

      beginNavigation(href);

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

  const shouldBypassNavGuard = (event: MouseEvent<HTMLAnchorElement>) => {
    return event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  };

  const handleDocsNavigation = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, href: string) => {
      if (shouldBypassNavGuard(event)) {
        return;
      }

      if (href === activePath) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      queueNavigation(href);
    },
    [activePath, queueNavigation]
  );

  const prefetchRoute = useCallback(
    (href: string) => {
      warmDocsRoute(router, href);
    },
    [router]
  );

  const getRouteLinkProps = useCallback(
    (href: string) => ({
      href,
      onClick: (event: MouseEvent<HTMLAnchorElement>) => {
        handleDocsNavigation(event, href);
      },
      onMouseEnter: () => {
        prefetchRoute(href);
      },
      onFocus: () => {
        prefetchRoute(href);
      },
    }),
    [handleDocsNavigation, prefetchRoute]
  );

  const brandMark = (
    <span className="relative inline-flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-[#2a2d31] bg-[#0d0f12]">
      <Image src="/logo-mark.svg" alt="" width={22} height={22} className="h-[22px] w-[22px]" priority />
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
          {...getRouteLinkProps("/docs")}
          className="flex items-center gap-2.5 shrink-0 group"
          aria-label={`${t("docsPage.topNavBrand")} ${t("docsPage.topNavBrandSub")}`}
        >
          {brandMark}
          <div className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-[#e7e9ea] group-hover:text-white transition-colors">
              {t("docsPage.topNavBrand")}
              <span className="text-[#4e535a] font-normal"> · </span>
              <span className="text-[#71767b] font-normal">{t("docsPage.topNavBrandSub")}</span>
            </span>
          </div>
        </Link>

        {/* Center: search */}
        <div className="flex-1 flex justify-center px-4">
          <button
            type="button"
            className="hidden md:flex h-[36px] w-full max-w-[440px] items-center gap-3 rounded-[10px] border border-[#2f3336] bg-transparent px-4 text-left text-[#71767b] transition hover:border-[#3d4043] hover:bg-[#080808] hover:text-[#e7e9ea]"
            aria-label={t("docsPage.topNavSearchAria")}
          >
            <Search className="h-[15px] w-[15px] shrink-0" />
            <span className="flex-1 text-[14px] font-normal truncate">{t("docsPage.topNavSearchPlaceholder")}</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[11px] text-[#3d4043] font-mono">
              Ctrl K
            </kbd>
          </button>
        </div>

        {/* Right: lang + console CTA */}
        <div className="flex items-center gap-3 shrink-0">
          <LanguageSwitcher className="tracking-[0.01em] h-[34px] rounded-[8px] border border-[#2f3336] bg-transparent text-[#71767b] text-[13px] hover:border-[#3d4043] hover:bg-[#0a0a0a] hover:text-[#e7e9ea] transition focus-visible:border-[#536471]" />
          <Link
            {...getRouteLinkProps("/docs/support")}
            className="hidden sm:inline-flex h-[34px] items-center rounded-[10px] border border-[#2f3336] px-3.5 text-[13px] font-semibold tracking-[-0.01em] text-[#e7e9ea] transition-colors hover:border-[#3d4043] hover:bg-[#0a0a0a]"
          >
            Support
          </Link>
          <Link
            href="/dashboard/overview"
            className="hidden sm:inline-flex items-center gap-1.5 h-[34px] px-4 rounded-[10px] bg-white text-[#0f1419] text-[13px] font-semibold tracking-[-0.01em] hover:bg-[#e7e9ea] transition-colors"
          >
            {t("docsPage.topNavDeveloperConsole")}
            <span className="text-[#536471]">→</span>
          </Link>
        </div>
      </div>

      {/* ─── Tab bar ─────────────────────────────────────── 44px */}
      <div
        className="flex items-center h-[44px] px-4 lg:px-6 border-b gap-0 overflow-x-auto scrollbar-hide"
        style={{ borderColor: "#1a1d20" }}
      >
        {TAB_HREFS.map((href, index) => {
          const isActive = active === href;
          return (
            <Link
              key={href}
              {...getRouteLinkProps(href)}
              className="relative flex items-center h-full px-3.5 text-[14px] font-normal shrink-0 transition-colors"
              style={{
                color: isActive ? "#e7e9ea" : "#71767b",
              }}
            >
              {tabs[index] ?? ""}
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
