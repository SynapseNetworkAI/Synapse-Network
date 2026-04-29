"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Github, Network, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import NotificationCenter from "@/components/NotificationCenter";
import QuickAccessDialog from "@/components/QuickAccessDialog";
import LanguageSwitcher from "@/components/i18n/LanguageSwitcher";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";

type TopNavHref = "/marketplace" | "/blog" | "/about" | "/docs";

export default function Navbar() {
  const pathname = usePathname();
  const activePath = pathname ?? "/";
  const isDocsPage = activePath.startsWith("/docs");
  const isAboutPage = activePath === "/about" || activePath.startsWith("/about/");
  const isMarketingPage =
    !isDocsPage &&
    (activePath === "/" || activePath === "/marketplace" || activePath === "/blog" || activePath === "/about");
  const { t, lang } = useLanguage();

  const [gatewayStatus, setGatewayStatus] = useState<"online" | "offline" | "checking">("checking");
  const [hoveredTopNavHref, setHoveredTopNavHref] = useState<TopNavHref | null>(null);
  const [quickAccessOpen, setQuickAccessOpen] = useState(false);
  const [sliderStyle, setSliderStyle] = useState<{ left: number; width: number; visible: boolean }>({
    left: 0,
    width: 0,
    visible: false,
  });
  const topNavTrackRef = useRef<HTMLDivElement | null>(null);
  const topNavItemRefs = useRef<Partial<Record<TopNavHref, HTMLAnchorElement | null>>>({});

  let gatewayStatusLabel = t("nav.checking");
  let gatewayStatusClasses = "border-yellow-500/20 bg-yellow-500/[0.08] text-yellow-100";
  let gatewayDotClasses = "animate-pulse bg-yellow-300";

  if (gatewayStatus === "online") {
    gatewayStatusLabel = t("nav.online");
    gatewayStatusClasses = "border-[#7ff7be]/20 bg-[#7ff7be]/[0.08] text-[#bdf9dc]";
    gatewayDotClasses =
      "animate-[navPulse_2.4s_ease-in-out_infinite] bg-[#7ff7be] shadow-[0_0_12px_rgba(127,247,190,0.7)]";
  } else if (gatewayStatus === "offline") {
    gatewayStatusLabel = t("nav.offline");
    gatewayStatusClasses = "border-red-500/20 bg-red-500/[0.08] text-red-200";
    gatewayDotClasses = "bg-red-400";
  }

  useEffect(() => {
    let mounted = true;

    const checkGateway = async () => {
      try {
        const res = await fetch(`${getGatewayBaseUrl()}/api/v1/services/discover`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(3000),
        });

        if (mounted) {
          if (!res.ok) {
            // Any HTTP response still means the gateway is reachable.
          }
          setGatewayStatus("online");
        }
      } catch {
        if (mounted) {
          setGatewayStatus("offline");
        }
      }
    };

    checkGateway();
    const interval = setInterval(checkGateway, 10000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const handleQuickAccessShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
        return;
      }

      event.preventDefault();
      setQuickAccessOpen(true);
    };

    window.addEventListener("keydown", handleQuickAccessShortcut);
    return () => {
      window.removeEventListener("keydown", handleQuickAccessShortcut);
    };
  }, []);

  useEffect(() => {
    setQuickAccessOpen(false);
  }, [activePath]);

  const getActiveTopNavHref = useCallback((): TopNavHref => {
    if (activePath === "/marketplace" || activePath.startsWith("/marketplace/")) return "/marketplace";
    if (activePath === "/blog" || activePath.startsWith("/blog/")) return "/blog";
    if (activePath === "/about" || activePath.startsWith("/about/")) return "/about";
    return "/marketplace";
  }, [activePath]);

  const getTopNavLinkClasses = (href: TopNavHref) => {
    const isHighlighted = (hoveredTopNavHref ?? getActiveTopNavHref()) === href;

    return [
      "relative z-10 rounded-full px-3.5 py-1.5 text-sm font-semibold tracking-[0.01em] transition-transform duration-100 active:scale-[0.98]",
      isHighlighted ? "text-white" : "text-[#e2e2e7] hover:text-white",
    ].join(" ");
  };

  useEffect(() => {
    if (!isMarketingPage) {
      setSliderStyle((prev) => ({ ...prev, visible: false }));
      return;
    }

    const updateSlider = () => {
      const targetHref = hoveredTopNavHref ?? getActiveTopNavHref();
      const activeElement = topNavItemRefs.current[targetHref];
      const trackElement = topNavTrackRef.current;
      if (!activeElement || !trackElement) {
        setSliderStyle((prev) => ({ ...prev, visible: false }));
        return;
      }

      setSliderStyle({
        left: activeElement.offsetLeft,
        width: activeElement.offsetWidth,
        visible: true,
      });
    };

    const frame = requestAnimationFrame(updateSlider);
    window.addEventListener("resize", updateSlider);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateSlider);
    };
  }, [getActiveTopNavHref, hoveredTopNavHref, isMarketingPage, lang]);

  const brandMark = (
    <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_10px_24px_rgba(0,0,0,0.24)] transition-transform duration-300 group-hover:scale-[1.03]">
      <Image
        src="/logo-mark.svg"
        alt="SynapseNetwork logo"
        width={24}
        height={24}
        className="h-6 w-6"
        priority
      />
    </span>
  );

  const consoleBrandMark = (
    <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-[#2f3336] bg-[#0d0f12] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <Image
        src="/logo-mark.svg"
        alt="Synapse logo"
        width={22}
        height={22}
        className="h-[22px] w-[22px]"
        priority
      />
    </span>
  );

  // Docs pages render their own DocsTopNav — suppress the global navbar
  if (isDocsPage) return null;

  return (
    <>
      {isAboutPage ? (
        <nav className="sticky top-0 z-50 border-b border-white/[0.09] bg-[#020403]/92 px-5 backdrop-blur-xl sm:px-8 lg:px-12">
          <div className="mx-auto flex h-[70px] max-w-[1536px] items-center justify-between">
            <Link href="/" className="group flex items-center gap-3 text-white transition hover:opacity-90">
              {brandMark}
              <span className="flex flex-col leading-none">
                <span className="text-[1rem] font-semibold tracking-[-0.04em] text-white/96 sm:text-[1.05rem]">Synapse</span>
                <span className="mt-1 text-[9px] font-medium uppercase tracking-[0.28em] text-white/38">Network</span>
              </span>
            </Link>

            <nav className="hidden items-center gap-[42px] text-[15px] font-medium text-white/78 lg:flex" aria-label="About page navigation">
              <Link href="/marketplace" className="transition hover:text-[#7ff7be]">
                {lang === "en" ? "Marketplace" : t("nav.apiMarketplace")}
              </Link>
              <Link href="/docs" className="transition hover:text-[#7ff7be]">
                {t("nav.docs")}
              </Link>
              <a
                href="/forum"
                target="_blank"
                rel="noopener noreferrer"
                className="transition hover:text-[#7ff7be]"
              >
                {t("nav.forum")}
              </a>
              <Link href="/blog" className="transition hover:text-[#7ff7be]">
                {t("nav.blog")}
              </Link>
              <Link href="/about" className="relative font-bold text-[#7ff7be]">
                {t("nav.about")}
                <span className="absolute left-1/2 top-[34px] h-0.5 w-[64px] -translate-x-1/2 bg-[#7ff7be]" aria-hidden="true" />
              </Link>
            </nav>

            <div className="flex items-center gap-4">
              <a
                href="https://github.com/cliff-personal/Synapse-Network-Sdk"
                target="_blank"
                rel="noreferrer"
                className="hidden h-10 w-10 items-center justify-center rounded-full border border-white/16 bg-black/28 text-white transition hover:border-[#7ff7be]/50 hover:text-[#7ff7be] sm:inline-flex"
                aria-label="GitHub"
              >
                <Github className="h-5 w-5" />
              </a>
              <Link
                href="/dashboard/overview"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-[#7ff7be]/55 px-5 text-[14px] font-bold text-[#9fffd0] transition hover:bg-[#7ff7be]/10 hover:text-white"
              >
                Launch Developer Console
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </nav>
      ) : isMarketingPage ? (
        <nav className="sticky top-0 z-50 px-4 pt-4 sm:px-6">
          <div className="mx-auto flex max-w-7xl items-center justify-between rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.085),rgba(255,255,255,0.025))] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_80px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:px-5">
            <div className="flex items-center gap-3 sm:gap-8">
              <Link href="/" className="group flex items-center gap-3 text-white transition-opacity hover:opacity-100">
                {brandMark}
                <span className="flex flex-col leading-none">
                  <span className="text-[1rem] font-semibold tracking-[-0.04em] text-white/96 sm:text-[1.05rem]">Synapse</span>
                  <span className="mt-1 text-[9px] font-medium uppercase tracking-[0.28em] text-white/38">Network</span>
                </span>
              </Link>
              <div
                className={[
                  "hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-medium tracking-[0.18em] uppercase transition-colors md:flex",
                  gatewayStatusClasses,
                ].join(" ")}
              >
                <span className={["inline-flex h-2 w-2 rounded-full", gatewayDotClasses].join(" ")} />
                <Network className="h-3.5 w-3.5 opacity-70" />
                <span>{t("nav.gatewayNode")}</span>
                <span className="text-white/48">/</span>
                <span>{gatewayStatusLabel}</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 rounded-full border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.035))] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_40px_rgba(0,0,0,0.22)] backdrop-blur-xl">
              <nav
                ref={topNavTrackRef}
                className="relative flex items-center gap-1.5"
                aria-label="Marketing"
                onMouseLeave={() => setHoveredTopNavHref(null)}
              >
                <span
                  className="pointer-events-none absolute inset-y-0 rounded-full bg-white/[0.11] transition-[transform,width,opacity] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{
                    transform: `translateX(${sliderStyle.left}px)`,
                    width: sliderStyle.width,
                    opacity: sliderStyle.visible ? 1 : 0,
                  }}
                  aria-hidden="true"
                />
                <span
                  className={[
                    "pointer-events-none absolute inset-y-0 rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_0_18px_rgba(255,255,255,0.08)] transition-opacity ease-[cubic-bezier(0.22,1,0.36,1)]",
                    sliderStyle.visible ? "duration-[120ms] opacity-100" : "duration-[180ms] opacity-0",
                  ].join(" ")}
                  style={{
                    transform: `translateX(${sliderStyle.left}px)`,
                    width: sliderStyle.width,
                  }}
                  aria-hidden="true"
                />
                <Link
                  ref={(node) => {
                    topNavItemRefs.current["/marketplace"] = node;
                  }}
                  href="/marketplace"
                  className={getTopNavLinkClasses("/marketplace")}
                  onMouseEnter={() => setHoveredTopNavHref("/marketplace")}
                  onFocus={() => setHoveredTopNavHref("/marketplace")}
                  onBlur={() => setHoveredTopNavHref(null)}
                >
                  {t("nav.apiMarketplace")}
                </Link>
                <Link
                  ref={(node) => {
                    topNavItemRefs.current["/blog"] = node;
                  }}
                  href="/blog"
                  className={getTopNavLinkClasses("/blog")}
                  onMouseEnter={() => setHoveredTopNavHref("/blog")}
                  onFocus={() => setHoveredTopNavHref("/blog")}
                  onBlur={() => setHoveredTopNavHref(null)}
                >
                  {t("nav.blog")}
                </Link>
                <Link
                  ref={(node) => {
                    topNavItemRefs.current["/about"] = node;
                  }}
                  href="/about"
                  className={getTopNavLinkClasses("/about")}
                  onMouseEnter={() => setHoveredTopNavHref("/about")}
                  onFocus={() => setHoveredTopNavHref("/about")}
                  onBlur={() => setHoveredTopNavHref(null)}
                >
                  {t("nav.about")}
                </Link>
                <Link
                  ref={(node) => {
                    topNavItemRefs.current["/docs"] = node;
                  }}
                  href="/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={getTopNavLinkClasses("/docs")}
                  onMouseEnter={() => setHoveredTopNavHref("/docs")}
                  onFocus={() => setHoveredTopNavHref("/docs")}
                  onBlur={() => setHoveredTopNavHref(null)}
                >
                  {t("nav.docs")}
                </Link>
              </nav>
              <div className="ml-1 border-l border-white/12 pl-2">
                <LanguageSwitcher className="h-8 rounded-full border border-white/16 bg-white/[0.06] px-3 pr-3 text-xs font-semibold tracking-[0.06em] text-white/95 outline-none transition hover:border-white/28 hover:bg-white/[0.12] focus:border-white/45" />
              </div>
            </div>
          </div>
        </nav>
      ) : (
        <nav className="sticky top-0 z-50 border-b border-[#2f3336] bg-[#000000]">
          <div className="relative flex h-[60px] items-center px-4 sm:px-5 lg:px-7">
            <div className="flex min-w-0 w-[270px] items-center">
              <Link href="/dashboard/overview" className="group flex min-w-0 items-center gap-3 text-white">
                {consoleBrandMark}
                <span className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em] text-[#e7e9ea]">
                  Synapse Developer Console
                </span>
              </Link>
            </div>

            <div className="absolute left-1/2 top-1/2 hidden w-[min(440px,calc(100vw-720px))] min-w-[320px] -translate-x-1/2 -translate-y-1/2 lg:block">
              <button
                type="button"
                onClick={() => setQuickAccessOpen(true)}
                className="flex h-10 w-full items-center gap-3 rounded-[12px] border border-[#2f3336] bg-transparent px-4 text-left text-[#71767b] transition hover:border-[#3d4043] hover:bg-[#080808] hover:text-[#e7e9ea]"
                aria-label={t("nav.search")}
              >
                <Search className="h-[18px] w-[18px] shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[15px] font-normal">{t("nav.search")}</span>
                <span className="text-[13px] font-normal tracking-[0.01em] text-[#71767b]">
                  Ctrl+K
                </span>
              </button>
            </div>

            <div className="ml-auto flex min-w-0 items-center justify-end gap-2 sm:gap-[14px]">
              <button
                type="button"
                onClick={() => setQuickAccessOpen(true)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-[12px] border border-[#2f3336] bg-transparent text-[#71767b] transition hover:border-[#3d4043] hover:bg-[#080808] hover:text-[#e7e9ea] lg:hidden"
                aria-label={t("nav.search")}
              >
                <Search className="h-4 w-4" />
              </button>
              <div className="hidden items-center gap-[30px] xl:flex">
                <Link
                  href="/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[15px] font-normal text-[#e7e9ea] transition hover:text-white"
                >
                  {t("nav.documentation")}
                </Link>
                <a
                  href="/forum"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[15px] font-normal text-[#e7e9ea] transition hover:text-white"
                >
                  {t("nav.forum")}
                </a>
                <NotificationCenter />
              </div>
              <LanguageSwitcher className="tracking-[0.01em] focus-visible:border-[#536471]" />
            </div>
          </div>
        </nav>
      )}

      <QuickAccessDialog open={quickAccessOpen} onClose={() => setQuickAccessOpen(false)} />
    </>
  );
}
