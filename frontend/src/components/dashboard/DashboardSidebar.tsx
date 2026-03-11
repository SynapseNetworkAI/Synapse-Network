"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { useEffect, useState } from "react";
import { getAppRole, AppRole } from "@/utils/roleStore";
import { 
  Terminal, 
  Search, 
  BarChart2, 
  Server, 
  DollarSign, 
  ShieldAlert, 
  Home
} from "lucide-react";

export default function DashboardSidebar() {
  const pathname = usePathname();
  const { address } = useAccount();
  const [role, setRole] = useState<AppRole | undefined>(undefined);

  useEffect(() => {
    setRole(getAppRole());
  }, []);

  // Admin address logic
  const isAdminAddress = address?.toLowerCase() === "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".toLowerCase();

  const getLinkClasses = (path: string, exact = false) => {
    const active = exact ? pathname === path : pathname.startsWith(path) || (path === "/dashboard/billing" && pathname === "/dashboard");
    if (active) {
      return "flex items-center px-4 py-2 mt-1 text-sm font-bold text-green-400 bg-green-900/20 border-l-4 border-green-500 rounded-r shadow-[0_0_12px_rgba(34,197,94,0.1)] transition-all";
    }
    return "flex items-center px-4 py-2 mt-1 text-sm font-medium text-gray-500 border-l-4 border-transparent hover:text-green-400 hover:bg-[#051505] transition-all";
  };

  // Prevent flash of wrong menus by returning minimal skeleton or null before role loaded
  if (role === undefined) {
    return <aside className="w-64 bg-[#050505] border-r border-green-900/50 min-h-[calc(100vh-73px)]" />;
  }

  return (
    <aside className="w-64 bg-[#050505] border-r border-green-900/50 flex flex-col pt-6 overflow-y-auto min-h-[calc(100vh-73px)]">

      {role === 'CONSUMER' && (
        <div className="mb-8">
          <h3 className="px-6 mb-2 text-xs font-semibold tracking-widest text-green-700/60 uppercase">
            🔽 Consumer Space (买家)
          </h3>
          <nav className="flex flex-col">
            <Link href="/dashboard/buyer" className={getLinkClasses("/dashboard/buyer", true)}>
              <Home className="w-4 h-4 mr-3" />
              Buyer Overview
            </Link>
            <Link href="/dashboard/console" className={getLinkClasses("/dashboard/console", false)}>
              <Terminal className="w-4 h-4 mr-3" />
              Developer Console
            </Link>
            <Link href="/dashboard/discover" className={getLinkClasses("/dashboard/discover", false)}>
              <Search className="w-4 h-4 mr-3" />
              Discover Services
            </Link>
            <Link href="/dashboard/billing" className={getLinkClasses("/dashboard/billing", false)}>
              <BarChart2 className="w-4 h-4 mr-3" />
              Usage & Billing
            </Link>
          </nav>
        </div>
      )}

      {role === 'PROVIDER' && (
        <div className="mb-8">
          <h3 className="px-6 mb-2 text-xs font-semibold tracking-widest text-blue-700/60 uppercase">
            🔽 Provider Space (卖家)
          </h3>
          <nav className="flex flex-col">
            <Link href="/dashboard/services" className={getLinkClasses("/dashboard/services", false)}>
              <Server className="w-4 h-4 mr-3" />
              My Services
            </Link>
            <Link href="/dashboard/settlement" className={getLinkClasses("/dashboard/settlement", false)}>
              <DollarSign className="w-4 h-4 mr-3" />
              Settlement
            </Link>
          </nav>
        </div>
      )}

      {(role === 'ADMIN' || isAdminAddress) && (
        <div className="mb-8">
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