"use client";

import Link from "next/link";
import { Network, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import QuickAccessDialog from "@/components/QuickAccessDialog";
import WalletProfileBadge from "@/components/WalletProfileBadge";
import LanguageSwitcher from "@/components/i18n/LanguageSwitcher";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";

type TopNavHref = "/marketplace" | "/blog" | "/about";

export default function Navbar() {
  const pathname = usePathname();
  const activePath = pathname ?? "/";
  const isMarketingPage =
    activePath === "/" || activePath === "/marketplace" || activePath === "/blog" || activePath === "/about";
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
      <span className="absolute inset-[4px] rounded-[7px] border border-white/[0.09]" />
      <span className="absolute left-[8px] top-[10px] h-1.5 w-1.5 rounded-full bg-[#7ff7be] shadow-[0_0_12px_rgba(127,247,190,0.7)]" />
      <span className="absolute right-[8px] bottom-[10px] h-1.5 w-1.5 rounded-full bg-white/85 shadow-[0_0_10px_rgba(255,255,255,0.22)]" />
      <span className="absolute left-[10px] right-[10px] top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-white/0 via-white/45 to-white/0" />
    </span>
  );

  return (
    <>
      {isMarketingPage ? (
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
              </nav>
              <div className="ml-1 border-l border-white/12 pl-2">
                <LanguageSwitcher className="h-8 rounded-full border border-white/16 bg-white/[0.06] px-3 pr-3 text-xs font-semibold tracking-[0.06em] text-white/95 outline-none transition hover:border-white/28 hover:bg-white/[0.12] focus:border-white/45" />
              </div>
            </div>
          </div>
        </nav>
      ) : (
        <nav className="sticky top-0 z-50 border-b border-white/6 bg-[#050608]/92 backdrop-blur-xl">
          <div className="flex h-[60px] items-center gap-3 px-4 sm:px-5 lg:grid lg:grid-cols-[270px_minmax(320px,440px)_1fr] lg:px-0">
            <div className="flex min-w-0 items-center lg:h-full lg:border-r lg:border-white/6 lg:px-6">
              <Link href="/dashboard/overview" className="group flex min-w-0 items-center gap-3 text-white">
                {brandMark}
                <span className="min-w-0 leading-none">
                  <span className="block truncate text-[1.05rem] font-semibold tracking-[-0.04em] text-white/96">Synapse Network</span>
                  <span className="mt-1 block truncate text-[10px] font-medium uppercase tracking-[0.22em] text-white/34">
                    {t("nav.productTagline")}
                  </span>
                </span>
              </Link>
            </div>

            <div className="hidden items-center justify-center px-6 lg:flex">
              <button
                type="button"
                onClick={() => setQuickAccessOpen(true)}
                className="flex h-10 w-full items-center gap-3 rounded-[14px] border border-white/10 bg-white/[0.025] px-4 text-left text-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition hover:border-white/16 hover:bg-white/[0.045] hover:text-white/86"
                aria-label={t("nav.search")}
              >
                <Search className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{t("nav.search")}</span>
                <span className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/42">
                  Ctrl+K
                </span>
              </button>
            </div>

            <div className="ml-auto flex min-w-0 items-center justify-end gap-2 sm:gap-3 lg:px-6">
              <button
                type="button"
                onClick={() => setQuickAccessOpen(true)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-[14px] border border-white/10 bg-white/[0.03] text-white/72 transition hover:border-white/16 hover:bg-white/[0.06] hover:text-white lg:hidden"
                aria-label={t("nav.search")}
              >
                <Search className="h-4 w-4" />
              </button>
              <div className="hidden items-center gap-5 text-[13px] font-medium text-white/46 xl:flex">
                <Link href="/dashboard/developer" className="transition hover:text-white/88">
                  {t("nav.documentation")}
                </Link>
                <Link href="/marketplace" className="transition hover:text-white/88">
                  {t("nav.apiMarketplace")}
                </Link>
              </div>
              <LanguageSwitcher className="h-10 min-w-[92px] rounded-[14px] border border-white/10 bg-white/[0.03] px-3 pr-3 text-[12px] font-semibold tracking-[0.06em] text-white/92 outline-none transition hover:border-white/18 hover:bg-white/[0.06] focus:border-white/28" />
              <WalletProfileBadge compact />
            </div>
          </div>
        </nav>
      )}

      <QuickAccessDialog open={quickAccessOpen} onClose={() => setQuickAccessOpen(false)} />
    </>
  );
}
