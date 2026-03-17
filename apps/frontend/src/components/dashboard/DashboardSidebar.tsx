"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useEffect } from "react";
import { 
  Terminal, 
  Search, 
  BarChart2, 
  Server, 
  ShieldAlert, 
  Home,
  Key,
  GitBranch,
  Rows4,
  Wallet,
  Activity
} from "lucide-react";

export default function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { address } = useAccount();

  const providerRoot = "/provider";

  useEffect(() => {
    const allRoutes = [
      "/dashboard/overview",
      "/dashboard/console",
      "/dashboard/discover",
      "/dashboard/usage",
      "/dashboard/billing",
      `${providerRoot}/sell`,
      `${providerRoot}/secrets`,
      `${providerRoot}/nodes`,
      `${providerRoot}/health`,
      `${providerRoot}/settlements`,
      `${providerRoot}/usage`,
      `${providerRoot}/billing`,
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
      return "flex items-center px-4 py-2 mt-1 text-sm font-bold text-green-400 bg-green-900/20 border-l-4 border-green-500 rounded-r shadow-[0_0_12px_rgba(34,197,94,0.1)] transition-all";
    }
    return "flex items-center px-4 py-2 mt-1 text-sm font-medium text-gray-500 border-l-4 border-transparent hover:text-green-400 hover:bg-[#051505] transition-all";
  };

  return (
    <aside className="w-64 bg-[#050505] border-r border-green-900/50 flex flex-col pt-6 overflow-y-auto min-h-[calc(100vh-73px)] pb-12">

      {/* OWNER CONTROL PLANE */}
      <div className="mb-8">
        <h3 className="px-6 mb-2 text-xs font-semibold tracking-widest text-[#00E599]/40 uppercase">
          Owner Hub
        </h3>
        <nav className="flex flex-col">
          <Link href="/dashboard/overview" className={getLinkClasses(["/dashboard/overview", "/dashboard/buyer"], true)}>
            <Home className="w-4 h-4 mr-3" />
            Control Plane
          </Link>
          <Link href="/dashboard/billing" className={getLinkClasses(["/dashboard/billing", `${providerRoot}/billing`], false)}>
            <Wallet className="w-4 h-4 mr-3" />
            Finance & Refunds
          </Link>
        </nav>
      </div>

      {/* AGENT WORKSPACE */}
      <div className="mb-8">
        <h3 className="px-6 mb-2 text-xs font-semibold tracking-widest text-[#00E599]/70 uppercase">
          Agent Workspace
        </h3>
        <nav className="flex flex-col">
          <Link href="/dashboard/console" className={getLinkClasses("/dashboard/console", false)}>
            <Terminal className="w-4 h-4 mr-3" />
            Credentials
          </Link>
          <Link href="/dashboard/discover" className={getLinkClasses("/dashboard/discover", false)}>
            <Search className="w-4 h-4 mr-3" />
            Discovery
          </Link>
          <Link href="/dashboard/usage" className={getLinkClasses("/dashboard/usage", false)}>
            <Activity className="w-4 h-4 mr-3" />
            Invoke Logs
          </Link>
        </nav>
      </div>

      {/* PROVIDER WORKSPACE */}
      <div className="mb-8">
        <h3 className="px-6 mb-2 text-xs font-semibold tracking-widest text-blue-500/70 uppercase">
          Provider Workspace
        </h3>
        <nav className="flex flex-col">
          <Link href={`${providerRoot}/sell`} className={getLinkClasses(["/dashboard/sell", `${providerRoot}/sell`], false)}>
            <Server className="w-4 h-4 mr-3" />
            My Services
          </Link>
          <Link href={`${providerRoot}/secrets`} className={getLinkClasses(["/dashboard/secrets", `${providerRoot}/secrets`], false)}>
            <Key className="w-4 h-4 mr-3" />
            Access Keys
          </Link>
          <Link href={`${providerRoot}/nodes`} className={getLinkClasses(["/dashboard/provider/nodes", `${providerRoot}/nodes`], false)}>
            <GitBranch className="w-4 h-4 mr-3" />
            API Nodes
          </Link>
          <Link href={`${providerRoot}/health`} className={getLinkClasses(["/dashboard/provider/health", `${providerRoot}/health`], false)}>
            <Terminal className="w-4 h-4 mr-3" />
            Health Console
          </Link>
          <Link href={`${providerRoot}/settlements`} className={getLinkClasses(["/dashboard/provider/settlements", `${providerRoot}/settlements`], false)}>
            <Rows4 className="w-4 h-4 mr-3" />
            Settlements
          </Link>
          <Link href={`${providerRoot}/usage`} className={getLinkClasses(["/dashboard/usage", `${providerRoot}/usage`], false)}>
            <BarChart2 className="w-4 h-4 mr-3" />
            Revenue Analytics
          </Link>
        </nav>
      </div>

      {(isAdminAddress) && (
        <div className="mb-8 mt-auto">
          <h3 className="px-6 mb-2 text-xs font-semibold tracking-widest text-red-700/60 uppercase">
            🔽 Admin Space (平台)
          </h3>
          <nav className="flex flex-col">
            <Link href="/dashboard/admin" className={getLinkClasses("/dashboard/admin", true)}>
              <ShieldAlert className="w-4 h-4 mr-3" />
              Global Dashboard
            </Link>
          </nav>
        </div>
      )}
    </aside>
  );
}