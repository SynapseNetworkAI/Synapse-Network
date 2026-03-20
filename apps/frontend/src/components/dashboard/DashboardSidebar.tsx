"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { 
  LayoutGrid,
  Wallet,
  Bot,
  Compass,
  Box,
  AreaChart,
  Clock,
  ShieldCheck,
  Terminal,
  AlertTriangle,
  History
} from "lucide-react";

export default function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const providerRoot = "/provider";

  useEffect(() => {
    const allRoutes = [
      "/dashboard/overview",
      "/dashboard/agents",
      "/dashboard/discovery",
      "/dashboard/invocations",
      "/dashboard/billing",
      "/dashboard/audit",
      "/dashboard/developer",
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
  }, [router, providerRoot]);

  const getLinkClasses = (paths: string | string[], exact = false) => {
    const candidates = Array.isArray(paths) ? paths : [paths];
    const active = candidates.some((path) => (exact ? pathname === path : pathname.startsWith(path)));
    if (active) {
      return "flex items-center px-4 py-[10px] mx-2 mt-1 text-[13px] font-semibold text-blue-300 bg-white/[0.04] border-l-2 border-blue-400 rounded-lg shadow-[0_0_12px_rgba(59,130,246,0.08)] transition-all";
    }
    return "flex items-center px-4 py-[10px] mx-2 mt-1 text-[13px] font-medium text-gray-400 border-l-2 border-transparent hover:text-white hover:bg-white/[0.02] rounded-lg transition-all";
  };

  const getBadgeClasses = (active: boolean) => {
    return active 
      ? "ml-auto bg-blue-400/10 text-blue-300 text-[10px] px-2 py-0.5 rounded-full font-mono flex items-center justify-center min-w-[20px]"
      : "ml-auto bg-white/5 text-gray-400 text-[10px] px-2 py-0.5 rounded-full font-mono flex items-center justify-center min-w-[20px]";
  };

  return (
    <aside className="w-[260px] bg-[#0a0a0c] border-r border-white/5 flex flex-col pt-6 overflow-y-auto min-h-[calc(100vh-73px)] pb-12 font-sans tracking-tight">
      
      {/* OWNER CONTROL PLANE */}
      <div className="mb-6">
        <h3 className="px-6 mb-2 text-[11px] font-bold tracking-widest text-gray-500 uppercase flex items-center gap-2">
          <ShieldCheck className="w-3 h-3" />
          Owner Control
        </h3>
        <nav className="flex flex-col gap-0.5">
          <Link href="/dashboard/overview" className={getLinkClasses(["/dashboard/overview"], true)}>
            <LayoutGrid className="w-4 h-4 mr-3 opacity-80" />
            Overview
          </Link>
          <Link href="/dashboard/agents" className={getLinkClasses("/dashboard/agents", false)}>
            <Bot className="w-4 h-4 mr-3 opacity-80" />
            Agents
            <span className={getBadgeClasses(pathname.startsWith("/dashboard/agents"))}>3</span>
          </Link>
          <Link href="/dashboard/discovery" className={getLinkClasses("/dashboard/discovery", false)}>
            <Compass className="w-4 h-4 mr-3 opacity-80" />
            Discovery
          </Link>
          <Link href="/dashboard/invocations" className={getLinkClasses("/dashboard/invocations", false)}>
            <History className="w-4 h-4 mr-3 opacity-80" />
            Invocations
          </Link>
          <Link href="/dashboard/billing" className={getLinkClasses(["/dashboard/billing"], false)}>
            <Wallet className="w-4 h-4 mr-3 opacity-80" />
            Treasury
          </Link>
          <Link href="/dashboard/audit" className={getLinkClasses(["/dashboard/audit"], false)}>
            <AlertTriangle className="w-4 h-4 mr-3 opacity-80" />
            Risk & Audit
          </Link>
          <Link href="/dashboard/developer" className={getLinkClasses(["/dashboard/developer"], false)}>
            <Terminal className="w-4 h-4 mr-3 opacity-80" />
            Developer
          </Link>
        </nav>
      </div>

      {/* PROVIDER WORKSPACE */}
      <div className="mb-6">
        <h3 className="px-6 mb-2 text-[11px] font-bold tracking-widest text-gray-500 uppercase flex items-center gap-2">
          <Box className="w-3 h-3" />
          Provider Role
        </h3>
        <nav className="flex flex-col gap-0.5">
          <Link href={`${providerRoot}/services`} className={getLinkClasses([`${providerRoot}/services`], false)}>
            <Box className="w-4 h-4 mr-3 opacity-80" />
            My Services
            <span className={getBadgeClasses(pathname.startsWith(`${providerRoot}/services`))}>2</span>
          </Link>
          <Link href={`${providerRoot}/usage`} className={getLinkClasses([`${providerRoot}/usage`], false)}>
            <AreaChart className="w-4 h-4 mr-3 opacity-80" />
            Usage Analytics
          </Link>
          <Link href={`${providerRoot}/settlements`} className={getLinkClasses([`${providerRoot}/settlements`], false)}>
            <Clock className="w-4 h-4 mr-3 opacity-80" />
            Settlements
          </Link>
        </nav>
      </div>

    </aside>
  );
}
