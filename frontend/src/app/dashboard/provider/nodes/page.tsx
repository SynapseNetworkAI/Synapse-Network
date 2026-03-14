"use client";

import Link from "next/link";
import { Server, ArrowRight, Shield, Gauge, Link2 } from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";

export default function ProviderNodesPage() {
  const { services } = useDashboardData();

  return (
    <div className="p-6 md:p-10 mx-auto max-w-7xl text-white bg-[#000000] min-h-screen space-y-6">
      <div className="border-b border-[#222222] pb-5">
        <h1 className="text-3xl md:text-4xl font-[800] tracking-tight text-white flex items-center gap-3">
          <Server className="w-8 h-8 text-[#22c55e]" />
          Registered Network Nodes
        </h1>
        <p className="mt-2 text-sm text-[#86868b]">
          Provider endpoints, SLA constraints, and service readiness for marketplace routing.
        </p>
      </div>

      <div className="overflow-x-auto rounded-[1.5rem] border border-[#222222] bg-[#0a0a0a]">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-[#222222] text-[10px] text-[#86868b] uppercase tracking-[0.2em] font-semibold bg-[#050505]">
              <th className="py-5 px-6">Service</th>
              <th className="py-5 px-6">Service ID</th>
              <th className="py-5 px-6">Pricing</th>
              <th className="py-5 px-6 text-center">State</th>
              <th className="py-5 px-6 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515]">
            {services.length === 0 && (
              <tr>
                <td colSpan={5} className="py-14 text-center text-sm text-[#86868b]">
                  No nodes published yet.
                </td>
              </tr>
            )}
            {services.map((svc) => (
              <tr key={svc.id} className="hover:bg-[#111111] transition-colors">
                <td className="py-5 px-6">
                  <div className="font-semibold text-white">{svc.name || "Unnamed Service"}</div>
                  <div className="text-xs text-[#86868b] mt-1 flex items-center gap-1">
                    <Link2 className="w-3.5 h-3.5" />
                    {svc.endpoint || "-"}
                  </div>
                </td>
                <td className="py-5 px-6 text-sm font-mono text-[#e5e5ea]">{svc.serviceId}</td>
                <td className="py-5 px-6 text-sm text-[#e5e5ea] font-mono">{svc.pricing} USDC / CALL</td>
                <td className="py-5 px-6 text-center">
                  {svc.isActive ? (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-bold text-[#22c55e] border border-[#22c55e]/30 bg-[#22c55e]/10">
                      <Gauge className="w-3 h-3 mr-1" />
                      Online
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-bold text-[#86868b] border border-[#333333] bg-[#111111]">
                      Offline
                    </span>
                  )}
                </td>
                <td className="py-5 px-6 text-right">
                  <Link
                    href="/dashboard/services"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg border border-[#333333] hover:border-[#ffffff] text-white hover:bg-white hover:text-black transition-all"
                  >
                    Manage <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-[#222222] bg-[#0a0a0a] p-4 text-xs text-[#86868b] flex items-center gap-2">
        <Shield className="w-4 h-4 text-[#22c55e]" />
        Publish flow requires at least one Access Key to protect provider endpoints with gateway signature validation.
      </div>
    </div>
  );
}
