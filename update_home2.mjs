const fs = require('fs');
const filePath = '/Users/cliff/workspace/A2A-pay/frontend/src/app/page.tsx';
let source = fs.readFileSync(filePath, 'utf8');

const oldHeader = `"use client";

import { useRouter } from "next/navigation";
import { setAppRole } from "@/utils/roleStore";
import { ArrowRight, ShieldCheck, Zap, Wallet, Bot, Store, ReceiptText, TerminalSquare } from "lucide-react";

export default function Home() {
  const router = useRouter();

  const handleEnterRole = (role: 'CONSUMER' | 'PROVIDER' | 'ADMIN', path: string) => {
    setAppRole(role);
    router.push(path);
  };

  return (
    <div className="mx-auto max-w-7xl px-6 md:px-8 py-10 space-y-16">`;

const newHeader = `"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAppRole } from "@/utils/roleStore";
import { ArrowRight, ShieldCheck, Zap, Wallet, Bot, Store, ReceiptText, TerminalSquare } from "lucide-react";
import { useAccount } from "wagmi";
import { listAgentCredentials } from "@/utils/agentCredentialApi";
import { listServiceRegistry } from "@/utils/serviceApi";
import RoleWarningModal from "@/components/RoleWarningModal";

export default function Home() {
  const router = useRouter();
  const { address } = useAccount();

  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<{ role: 'CONSUMER' | 'PROVIDER' | 'ADMIN', path: string, targetRoleStr: "Buyer" | "Seller" } | null>(null);

  const handleEnterRole = async (role: 'CONSUMER' | 'PROVIDER' | 'ADMIN', path: string) => {
    if (!address || role === 'ADMIN') {
      executeRoute(role, path);
      return;
    }

    try {
      if (role === 'PROVIDER') {
        const keys = await listAgentCredentials(address);
        const activeKeys = keys.filter(k => k.status === 'active');
        if (activeKeys.length > 0) {
          setPendingRoute({ role, path, targetRoleStr: "Seller" });
          setIsWarningOpen(true);
          return;
        }
      } else if (role === 'CONSUMER') {
        const services = await listServiceRegistry(address, address);
        if (services && services.length > 0) {
          setPendingRoute({ role, path, targetRoleStr: "Buyer" });
          setIsWarningOpen(true);
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to check exact role status on entry:", e);
    }

    executeRoute(role, path);
  };

  const executeRoute = (role: 'CONSUMER' | 'PROVIDER' | 'ADMIN', path: string) => {
    setAppRole(role);
    router.push(path);
  };

  const onProceedWarning = () => {
    if (pendingRoute) {
      executeRoute(pendingRoute.role, pendingRoute.path);
    }
    setIsWarningOpen(false);
  };

  return (
    <div className="mx-auto max-w-7xl px-6 md:px-8 py-10 space-y-16">
      <RoleWarningModal
        isOpen={isWarningOpen}
        onProceed={onProceedWarning}
        onCancel={() => setIsWarningOpen(false)}
        targetRole={pendingRoute?.targetRoleStr || "Seller"}
      />`;

// Handle carriage returns and exact spacing
source = source.replace(
  /.*import \{ useRouter.*$[\s\S]*?return \([^<]*<div className="mx-auto max-w-7xl px-6 md:px-8 py-10 space-y-16">/m, 
  newHeader
);

fs.writeFileSync(filePath, source);
console.log('Fixed page');
