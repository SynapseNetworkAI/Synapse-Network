"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getAppRole, AppRole } from "@/utils/roleStore";
import { Loader2 } from "lucide-react";

export default function RoleGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<AppRole | undefined>(undefined);
  const [isAllowed, setIsAllowed] = useState<boolean>(false);

  useEffect(() => {
    const currentRole = getAppRole();
    setRole(currentRole);

    // If no role is selected, prevent access to dashboard sections directly
    // Platform overview could be public maybe, but generally need a role
    if (!currentRole && pathname !== '/dashboard' && pathname.startsWith('/dashboard')) {
      router.replace('/');
      return;
    }

    // Role-based path authorization
    let allowed = true;
    
    const consumerPaths = ['/dashboard/console', '/dashboard/discover', '/dashboard/billing'];
    const providerPaths = ['/dashboard/services', '/dashboard/settlement'];

    // If a Consumer tries to access Provider paths
    if (currentRole === 'CONSUMER' && providerPaths.some(p => pathname.startsWith(p))) {
      allowed = false;
      router.replace('/dashboard/console');
    }

    // If a Provider tries to access Consumer paths
    if (currentRole === 'PROVIDER' && consumerPaths.some(p => pathname.startsWith(p))) {
      allowed = false;
      router.replace('/dashboard/services');
    }

    setIsAllowed(allowed);
  }, [pathname, router]);

  if (role === undefined || !isAllowed) {
    return (
      <div className="flex items-center justify-center flex-1 h-[50vh]">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}