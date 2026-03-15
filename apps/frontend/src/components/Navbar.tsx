"use client";

import Link from "next/link";
import { Network } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import WalletProfileBadge from "@/components/WalletProfileBadge";
import LanguageSwitcher from "@/components/i18n/LanguageSwitcher";
import { useLanguage } from "@/components/i18n/LanguageProvider";

type TopNavHref = "/dashboard/discover" | "/blog" | "/about";

export default function Navbar() {
  const pathname = usePathname();
  const isMarketingPage = pathname === "/" || pathname === "/blog" || pathname === "/about";
  const { t, lang } = useLanguage();

  const [gatewayStatus, setGatewayStatus] = useState<"online" | "offline" | "checking">("checking");
  const [hoveredTopNavHref, setHoveredTopNavHref] = useState<TopNavHref | null>(null);
  const [sliderStyle, setSliderStyle] = useState<{ left: number; width: number; visible: boolean }>({
    left: 0,
    width: 0,
    visible: false,
  });
  const topNavTrackRef = useRef<HTMLDivElement | null>(null);
  const topNavItemRefs = useRef<Partial<Record<TopNavHref, HTMLAnchorElement | null>>>({});

  useEffect(() => {
    let mounted = true;
    
    const checkGateway = async () => {
      try {
        // Ping a lightweight public endpoint on the Python Gateway
        // We use AbortSignal to timeout quickly if the server is unreachable
        const res = await fetch("http://127.0.0.1:8000/api/v1/services/discover", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(3000)
        });
        
        if (mounted) {
          if (res.ok) {
            setGatewayStatus("online");
          } else {
            // Even if we get a 4xx/5xx, the gateway *is* technically online/responding
            // but let's just count ok for absolute health
            setGatewayStatus("online");
          }
        }
      } catch {
        if (mounted) {
          setGatewayStatus("offline");
        }
      }
    };

    // Initial check
    checkGateway();
    
    // Poll every 10 seconds
    const interval = setInterval(checkGateway, 10000);
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const getActiveTopNavHref = useCallback((): TopNavHref => {
    if (pathname === "/blog" || pathname.startsWith("/blog/")) return "/blog";
    if (pathname === "/about" || pathname.startsWith("/about/")) return "/about";
    return "/dashboard/discover";
  }, [pathname]);

  const getTopNavLinkClasses = (href: TopNavHref) => {
    const isHighlighted = (hoveredTopNavHref ?? getActiveTopNavHref()) === href;

    return [
      "relative z-10 rounded-full px-3.5 py-1.5 text-sm font-semibold tracking-[0.01em] transition-transform duration-100 active:scale-[0.98]",
      isHighlighted
        ? "text-white"
        : "text-[#e2e2e7] hover:text-white",
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

  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between p-4 border-b bg-black/80 backdrop-blur-xl border-white/10">
      <div className="flex items-center space-x-8">
        <Link href="/" className="text-xl font-bold font-mono tracking-widest text-green-500 [text-shadow:0_0_8px_rgba(34,197,94,0.7)] hover:text-green-300 transition-colors flex items-center">
          Synapse Network<span className="animate-[pulse_1s_infinite]">_</span>
        </Link>
        <div className={`hidden md:flex items-center px-3 py-1 rounded border text-xs font-mono transition-colors ${
          gatewayStatus === "online" 
            ? "bg-green-900/20 border-green-500/30 text-green-400" 
            : gatewayStatus === "offline"
              ? "bg-red-900/20 border-red-500/30 text-red-500"
              : "bg-yellow-900/20 border-yellow-500/30 text-yellow-500"
        }`}>
          <Network className={`w-3 h-3 mr-2 ${gatewayStatus === 'online' ? 'animate-pulse text-green-400' : gatewayStatus === 'offline' ? 'text-red-500' : 'animate-spin text-yellow-500'}`} />
          {t("nav.gatewayNode")}: {gatewayStatus === "online" ? t("nav.online") : gatewayStatus === "offline" ? t("nav.offline") : t("nav.checking")}
        </div>
      </div>

      {isMarketingPage ? (
        <div className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-2 py-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div
            ref={topNavTrackRef}
            className="relative flex items-center gap-1.5"
            onMouseLeave={() => setHoveredTopNavHref(null)}
          >
            <span
              className="pointer-events-none absolute inset-y-0 rounded-full bg-white/10 transition-[transform,width,opacity] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                transform: `translateX(${sliderStyle.left}px)`,
                width: sliderStyle.width,
                opacity: sliderStyle.visible ? 1 : 0,
              }}
              aria-hidden="true"
            />
            <span
              className={[
                "pointer-events-none absolute inset-y-0 rounded-full shadow-[0_0_18px_rgba(255,255,255,0.16)] transition-opacity ease-[cubic-bezier(0.22,1,0.36,1)]",
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
                topNavItemRefs.current["/dashboard/discover"] = node;
              }}
              href="/dashboard/discover"
              className={getTopNavLinkClasses("/dashboard/discover")}
              onMouseEnter={() => setHoveredTopNavHref("/dashboard/discover")}
              onFocus={() => setHoveredTopNavHref("/dashboard/discover")}
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
          </div>
          <div className="ml-1 border-l border-white/15 pl-2">
            <LanguageSwitcher className="h-8 rounded-full border border-white/20 bg-white/[0.08] px-3 text-xs font-semibold tracking-[0.02em] text-white/95 outline-none transition hover:bg-white/[0.14] focus:border-white/50" />
          </div>
        </div>
      ) : (
        <div className="flex items-center">
          <WalletProfileBadge />
        </div>
      )}
    </nav>
  );
}
