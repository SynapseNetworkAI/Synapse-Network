"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAuth } from "@/components/WalletAuthGuard";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { 
  LayoutGrid,
  Wallet,
  Bot,
  Compass,
  Box,
  Key,
  AreaChart,
  Clock,
  ShieldCheck,
  Terminal,
  AlertTriangle,
  History,
  ChevronDown
} from "lucide-react";

export default function DashboardSidebar() {
  const pathname = usePathname();
  const activePath = pathname ?? "";
  const router = useRouter();
  const { openConnectModal } = useConnectModal();
  const { isConnected, isSessionAuthenticated, authorize } = useAuth();
  const { t } = useLanguage();

  const providerRoot = "/provider";
  const providerConsoleRoute = `${providerRoot}/console`;
  const providerSettlementsRoute = `${providerRoot}/settlements`;
  const billingChildActive = activePath.startsWith("/dashboard/billing");
  const [billingExpanded, setBillingExpanded] = useState(billingChildActive);

  useEffect(() => {
    const allRoutes = [
      "/dashboard/overview",
      "/dashboard/agents",
      "/dashboard/discovery",
      "/dashboard/invocations",
      "/dashboard/billing",
      "/dashboard/billing/credits",
      "/dashboard/billing/payments",
      "/dashboard/audit",
      "/dashboard/developer",
      providerConsoleRoute,
      `${providerRoot}/secrets`,
      `${providerRoot}/services`,
      `${providerRoot}/usage`,
      `${providerRoot}/settlements`,
    ];

    const warmup = () => {
      for (const route of allRoutes) {
        router.prefetch(route);
      }
    };

    if (typeof globalThis.requestIdleCallback === "function") {
      const idleId = globalThis.requestIdleCallback(warmup, { timeout: 1200 });
      return () => globalThis.cancelIdleCallback(idleId);
    }

    const timeoutId = globalThis.setTimeout(warmup, 200);
    return () => globalThis.clearTimeout(timeoutId);
  }, [router, providerConsoleRoute, providerRoot]);

  useEffect(() => {
    if (billingChildActive) {
      setBillingExpanded(true);
    }
  }, [billingChildActive]);

  const isRouteActive = (paths: string | string[], exact = false) => {
    const candidates = Array.isArray(paths) ? paths : [paths];
    return candidates.some((path) => (exact ? activePath === path : activePath.startsWith(path)));
  };

  const getLinkClasses = (paths: string | string[], exact = false) => {
    const active = isRouteActive(paths, exact);
    if (active) {
      return "group mx-2 mt-1 flex items-center rounded-2xl bg-white/[0.045] px-4 py-[11px] text-[14px] font-medium text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.035)] transition-[background-color,color,box-shadow]";
    }
    return "group mx-2 mt-1 flex items-center rounded-2xl px-4 py-[11px] text-[14px] font-medium text-white/74 transition-[background-color,color,box-shadow] hover:bg-white/[0.028] hover:text-white";
  };

  const getBadgeClasses = (active: boolean) => {
    return active 
      ? "ml-auto flex min-w-[22px] items-center justify-center rounded-full bg-white/[0.08] px-2 py-0.5 font-mono text-[10px] text-white/88"
      : "ml-auto flex min-w-[22px] items-center justify-center rounded-full bg-white/[0.045] px-2 py-0.5 font-mono text-[10px] text-white/46";
  };

  const getSubLinkClasses = (path: string) => {
    const active = activePath === path;
    if (active) {
      return "ml-10 mr-2 mt-1 flex items-center rounded-2xl bg-white/[0.065] px-4 py-2.5 text-[14px] font-medium text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] transition-[background-color,color,box-shadow]";
    }
    return "ml-10 mr-2 mt-1 flex items-center rounded-2xl px-4 py-2.5 text-[14px] font-medium text-white/70 transition-[background-color,color] hover:bg-white/[0.03] hover:text-white";
  };

  const getGroupTriggerClasses = (expanded: boolean) => {
    if (expanded) {
      return "group mx-2 mt-1 flex w-[calc(100%-1rem)] items-center rounded-2xl px-4 py-[11px] text-[14px] font-medium text-white/90 transition-[background-color,color] hover:bg-white/[0.028]";
    }
    return "group mx-2 mt-1 flex w-[calc(100%-1rem)] items-center rounded-2xl px-4 py-[11px] text-[14px] font-medium text-white/74 transition-[background-color,color] hover:bg-white/[0.028] hover:text-white";
  };

  const shouldBypassNavGuard = (event: MouseEvent<HTMLAnchorElement>) => {
    return event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  };

  const handleSettlementsNavigation = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (shouldBypassNavGuard(event)) {
      return;
    }

    if (!isConnected) {
      event.preventDefault();
      openConnectModal?.();
      return;
    }

    if (isSessionAuthenticated) {
      return;
    }

    event.preventDefault();
    const authorized = await authorize();
    if (authorized) {
      router.push(providerSettlementsRoute);
    }
  };

  return (
    <aside className="w-[270px] shrink-0 bg-[#0a0a0c] border-r border-white/5 flex flex-col pt-6 overflow-y-auto min-h-[calc(100vh-73px)] pb-12 font-sans tracking-tight">
      
      {/* OWNER CONTROL PLANE */}
      <div className="mb-6">
        <h3 className="px-6 mb-2 text-[11px] font-bold tracking-widest text-gray-500 uppercase flex items-center gap-2">
          <ShieldCheck className="w-3 h-3" />
          {t("sidebar.ownerControl")}
        </h3>
        <nav className="flex flex-col gap-0.5">
          <Link href="/dashboard/overview" className={getLinkClasses(["/dashboard/overview"], true)}>
            <LayoutGrid className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
            {t("sidebar.overview")}
          </Link>
          <Link href="/dashboard/agents" className={getLinkClasses("/dashboard/agents", false)}>
            <Bot className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
            {t("sidebar.agents")}
            <span className={getBadgeClasses(isRouteActive("/dashboard/agents"))}>3</span>
          </Link>
          <Link href="/dashboard/discovery" className={getLinkClasses("/dashboard/discovery", false)}>
            <Compass className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
            {t("sidebar.discovery")}
          </Link>
          <Link href="/dashboard/invocations" className={getLinkClasses("/dashboard/invocations", false)}>
            <History className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
            {t("sidebar.invocations")}
          </Link>
          <button
            type="button"
            className={getGroupTriggerClasses(billingExpanded)}
            onClick={() => setBillingExpanded((current) => !current)}
            aria-expanded={billingExpanded}
            aria-controls="dashboard-billing-subnav"
          >
            <Wallet className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
            {t("sidebar.billing")}
            <ChevronDown
              className={`ml-auto h-4 w-4 text-white/38 transition-transform duration-200 ${billingExpanded ? "rotate-0 text-white/56" : "-rotate-90"}`}
            />
          </button>
          {billingExpanded ? (
            <div id="dashboard-billing-subnav" className="pb-1">
              <Link href="/dashboard/billing/credits" className={getSubLinkClasses("/dashboard/billing/credits")}>
                {t("sidebar.credits")}
              </Link>
              <Link href="/dashboard/billing" className={getSubLinkClasses("/dashboard/billing")}>
                {t("sidebar.payments")}
              </Link>
            </div>
          ) : null}
          <Link href="/dashboard/audit" className={getLinkClasses(["/dashboard/audit"], false)}>
            <AlertTriangle className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
            {t("sidebar.riskAudit")}
          </Link>
          <Link href="/dashboard/developer" className={getLinkClasses(["/dashboard/developer"], false)}>
            <Terminal className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
            {t("sidebar.developerResources")}
          </Link>
        </nav>
      </div>

      {/* PROVIDER WORKSPACE */}
      <div className="mb-6">
        <h3 className="px-6 mb-2 text-[11px] font-bold tracking-widest text-gray-500 uppercase flex items-center gap-2">
          <Box className="w-3 h-3" />
          {t("sidebar.providerRole")}
        </h3>
        <nav className="flex flex-col gap-0.5">
          <Link href={providerConsoleRoute} className={getLinkClasses([providerConsoleRoute, `${providerRoot}/sell`], false)}>
            <LayoutGrid className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
            {t("sidebar.providerConsole")}
          </Link>
          <Link href={`${providerRoot}/secrets`} className={getLinkClasses([`${providerRoot}/secrets`], false)}>
            <Key className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
            {t("sidebar.providerCredentials")}
          </Link>
          <Link href={`${providerRoot}/services`} className={getLinkClasses([`${providerRoot}/services`], false)}>
            <Box className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
            {t("sidebar.myServices")}
            <span className={getBadgeClasses(isRouteActive(`${providerRoot}/services`))}>2</span>
          </Link>
          <Link href={`${providerRoot}/usage`} className={getLinkClasses([`${providerRoot}/usage`], false)}>
            <AreaChart className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
            {t("sidebar.usageAnalytics")}
          </Link>
          <Link
            href={providerSettlementsRoute}
            className={getLinkClasses([providerSettlementsRoute], false)}
            onClick={(event) => {
              void handleSettlementsNavigation(event);
            }}
          >
            <Clock className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
            {t("sidebar.settlements")}
          </Link>
        </nav>
      </div>

    </aside>
  );
}
