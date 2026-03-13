"use client";

import "client-only";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getAppRole, setAppRole, AppRole, clearAppRole } from "@/utils/roleStore";
import { Loader2 } from "lucide-react";
import { useAccount, useDisconnect } from "wagmi";
import { getWalletRole, bindWalletRole } from "@/utils/serviceApi";
import toast from "react-hot-toast";
import AutoRouteModal from "./AutoRouteModal";

export default function RoleGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  
  const [role, setRole] = useState<AppRole | undefined>(undefined);
  const [isAllowed, setIsAllowed] = useState<boolean>(false);
  const [autoRouteRole, setAutoRouteRole] = useState<"CONSUMER" | "PROVIDER" | null>(null);

  useEffect(() => {
    const currentRole = getAppRole();
    setRole(currentRole);

    // If no role is selected, prevent access to dashboard sections directly
    // Platform overview could be public maybe, but generally need a role
    if (!currentRole && pathname !== '/dashboard' && pathname !== '/dashboard/buyer' && pathname !== '/dashboard/discover' && pathname.startsWith('/dashboard')) {
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

  // Check and bind backend role when wallet connects
  useEffect(() => {
    let active = true;
    
    const verifyAndBindBackendRole = async () => {
      if (!address || !role || role === 'ADMIN') return;
      
      try {
        const backendRole = await getWalletRole(address);
        
        if (!active) return;

        if (backendRole && backendRole !== role) {
          // Address is already bound to a completely different role in DB
          if (backendRole === "CONSUMER") {
             setAutoRouteRole("CONSUMER");
          } else if (backendRole === "PROVIDER") {
             setAutoRouteRole("PROVIDER");
          } else {
             toast.error(`This wallet is already bound to the ${backendRole} role. Please use a different wallet.`);
             clearAppRole(address);
             disconnect();
             router.replace('/');
          }
          return;
        }

        if (!backendRole) {
          // Binding new wallet to current workspace role
          const bound = await bindWalletRole(address, role);
          if (bound && active) {
            toast.success(`Wallet successfully bound to ${role === 'CONSUMER' ? 'Buyer' : 'Seller'} workspace!`);
          } else if (active) {
            toast.error("Failed to bind wallet role to the network. Please try again.");
          }
        }
      } catch (err) {
        console.warn("Failed to check or bind DB role via API:", err);
      }
    };

    verifyAndBindBackendRole();

    return () => {
      active = false;
    };
  }, [address, role, router, disconnect]);

  if (role === undefined || !isAllowed) {
    return (
      <div className="flex items-center justify-center flex-1 h-[50vh]">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  const handleAutoRouteConfirm = () => {
    if (autoRouteRole === "CONSUMER") {
      setAppRole("CONSUMER", address);
      router.replace('/dashboard/buyer');
    } else if (autoRouteRole === "PROVIDER") {
      setAppRole("PROVIDER", address);
      router.replace('/dashboard/sell');
    }
    setAutoRouteRole(null);
  };

  return (
    <>
      {children}
      <AutoRouteModal
        isOpen={autoRouteRole !== null}
        onConfirm={handleAutoRouteConfirm}
        targetRole={autoRouteRole || "CONSUMER"}
      />
    </>
  );
}