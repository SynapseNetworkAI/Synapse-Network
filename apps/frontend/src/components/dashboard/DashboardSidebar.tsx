"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useEffect } from "react";
import { 
  ShieldAlert, 
  LayoutGrid,
  PieChart,
  Activity,
  Users,
  Briefcase,
  Compass,
  Box,
  AreaChart,
  Clock
} from "lucide-react";

export default function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { address } = useAccount();

  const providerRoot = "/provider";

  useEffect(() => {
    const allRoutes = [
      "/dashboard/overview",
      "/dashboard/billing",
      "/dashboard/usage",
      "/dashboard/agents",
      "/dashboard/console",
      "/dashboard/discover",
      `${providerRoot}/sell`,
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

  // Admin address logic
  const isAdminAddress = address?.toLowerCase() === "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".toLowerCase();

  const getLinkClasses = (paths: string | string[], exact = false) => {
    const candidates = Array.isArray(paths) ? paths : [paths];
    const active = candidates.some((path) => (exact ? pathname === path : pathname.startsWith(path)));
    if (active) {
      return "flex items-center px-4 py-[10px] mx-2 mt-1 text-[13px] font-semibold text-amber-200 bg-white/[0.04] border-l-2 border-amber-400 rounded-lg shadow-[0_0_12px_rgba(251,191,36,0.08)] transition-all";
    }
    return "flex items-center px-4 py-[10px] mx-2 mt-1 text-[13px] font-medium text-gray-400 border-l-2 border-transparent hover:text-white hover:bg-white/[0.02] rounded-lg transition-all";
  };

  const getBadgeClasses = (active: boolean) => {
    return active 
      ? "ml-auto bg-amber-400/10 text-amber-300 text-[10px] px-2 py-0.5 rounded-full font-mono flex items-center justify-center min-w-[20px]"
      : "ml-auto bg-white/5 text-gray-400 text-[10px] px-2 py-0.5 rounded-full font-mono flex items-center justify-center min-w-[20px]";
  };

  return (
    <aside className="w-[260px] bg-[#0a0a0c] border-r border-white/5 flex flex-col pt-6 overflow-y-auto min-h-[calc(100vh-73px)] pb-12 font-sans tracking-tight">
      
      {/* CONTROL PLANE */}
      <div className="mb-6">
        <h3 className="px-6 mb-2 text-[11px] font-bold tracking-widest text-gray-500 uppercase">
          Control Plane
        </h3>
        <nav className="flex flex-col gap-0.5">
          <Link href="/dashboard/overview" className={getLinkClasses(["/dashboard/overview"], true)}>
            <LayoutGrid className="w-4 h-4 mr-3 opacity-80" />
            Overview
          </Link>
          <Link href="/dashboard/billing" className={getLinkClasses(["/dashboard/billing"], false)}>
            <PieChart className="w-4 h-4 mr-3 opacity-80" />
            Finance
          </Link>
          <Link href="/dashboard/usage" className={getLinkClasses(["/dashboard/usage"], false)}>
            <Activity className="w-4 h-4 mr-3 opacity-80" />
            Audit Log
          </Link>
        </nav>
      </div>

      {/* AGENT WORKSPACE */}
      <div className="mb-6">
        <h3 className="px-6 mb-2 text-[11px] font-bold tracking-widest text-gray-500 uppercase">
          Agent Workspace
        </h3>
        <nav className="flex flex-col gap-0.5">
          <Link href="/dashboard/agents" className={getLinkClasses("/dashboard/agents", false)}>
            <Users className="w-4 h-4 mr-3 opacity-80" />
            Agents
            <span className={getBadgeClasses(pathname.startsWith("/dashboard/agents"))}>3</span>
          </Link>
          <Link href="/dashboard/console" className={getLinkClasses("/dashboard/console", false)}>
            <Briefcase className="w-4 h-4 mr-3 opacity-80" />
            API Keys
            <span className={getBadgeClasses(pathname.startsWith("/dashboard/console"))}>5</span>
          </Link>
          <Link href="/dashboard/discover" className={getLinkClasses("/dashboard/discover", false)}>
            <Compass className="w-4 h-4 mr-3 opacity-80" />
            Discovery
          </Link>
        </nav>
      </div>

      {/* PROVIDER WORKSPACE */}
      <div className="mb-6">
        <h3 className="px-6 mb-2 text-[11px] font-bold tracking-widest text-gray-500 uppercase">
          Provider Workspace
        </h3>
        <nav className="flex flex-col gap-0.5">
          <Link href={`${providerRoot}/sell`} className={getLinkClasses([`${providerRoot}/sell`], false)}>
            <Box className="w-4 h-4 mr-3 opacity-80" />
            Services
            <span className={getBadgeClasses(pathname.startsWith(`${providerRoot}/sell`))}>2</span>
          </Link>
          <Link href={`${providerRoot}/usage`} className={getLinkClasses([`${providerRoot}/usage`], false)}>
            <AreaChart className="w-4 h-4 mr-3 opacity-80" />
            Earnings
          </Link>
          <Link href={`${providerRoot}/settlements`} className={getLinkClasses([`${providerRoot}/settlements`], false)}>
            <Clock className="w-4 h-4 mr-3 opacity-80" />
            Withdrawals
          </Link>
        </nav>
      </div>

      {(isAdminAddress) && (
        <div className="mb-6 mt-auto">
          <h3 className="px-6 mb-2 text-[11px] font-bold tracking-widest text-red-500/60 uppercase">
            Admin Space (平台)
          </h3>
          <nav className="flex flex-col gap-0.5">
            <Link href="/dashboard/admin" className={getLinkClasses("/dashboard/admin", true)}>
              <ShieldAlert className="w-4 h-4 mr-3 opacity-80" />
              Global Dashboard
            </Link>
          </nav>
        </div>
      )}
    </aside>
  );
}
