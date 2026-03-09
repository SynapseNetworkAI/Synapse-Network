import Link from "next/link";
import { Activity, ArrowUpRight, Bot, HandCoins } from "lucide-react";
import PaidInvokePanel from "@/components/PaidInvokePanel";

type DashboardService = {
  id: string;
  agentId: string;
  name: string;
  serviceId: string;
  pricing: string;
  endpoint: string;
  isActive: boolean;
  agentName: string;
  agentRole: string;
  sellerAddress: string;
};

type ServiceGridProps = {
  services: DashboardService[];
  serviceBalances: Record<string, string>;
  onFundService: (serviceName: string) => void;
  onSweepService: (serviceName: string) => void;
};

export default function ServiceGrid({ services, serviceBalances, onFundService, onSweepService }: ServiceGridProps) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {services.map((service) => (
        <div key={service.id} className="relative p-6 overflow-hidden transition-all bg-black border border-gray-800 rounded-xl group hover:border-green-900/50">
          <div className="absolute top-0 left-0 w-full h-1 transition-all bg-gradient-to-r from-gray-800 to-gray-700 group-hover:from-green-500 group-hover:to-emerald-800"></div>

          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-900 border border-gray-800 rounded-lg">
                <Bot className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold leading-tight text-green-400">{service.name}</h3>
                <span className="font-mono text-xs tracking-wide text-gray-500">{service.agentName} / {service.agentRole}</span>
              </div>
            </div>
            <div className={`flex items-center px-2 py-1 text-xs border rounded-full ${service.isActive ? "text-green-400 bg-green-500/10 border-green-500/20" : "text-gray-400 bg-gray-700/20 border-gray-600/50"}`}>
              <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${service.isActive ? "bg-green-400 animate-pulse" : "bg-gray-500"}`}></span>
              {service.isActive ? "Active" : "Inactive"}
            </div>
          </div>

          <div className="mb-4 space-y-2">
            <div className="text-[11px] font-mono text-gray-500">
              Service ID: <span className="text-blue-300">{service.serviceId || "UNSET"}</span>
            </div>
            <div className="text-[11px] font-mono text-gray-500">
              Pricing: <span className="text-green-300">{service.pricing || "0.00"} USDC</span>
            </div>
            <div className="text-[11px] font-mono text-gray-500 truncate">
              Endpoint: <span className="text-gray-300">{service.endpoint || "Not configured"}</span>
            </div>
          </div>

          <div className="mb-6 space-y-4">
            <div>
              <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Seller Wallet Address</span>
              <div className="px-3 py-2 mt-1 font-mono text-sm text-gray-300 truncate border rounded select-all bg-gray-900/50 border-gray-800/50">
                {service.sellerAddress}
              </div>
            </div>

            <div className="flex items-center justify-between p-3 border rounded-lg bg-gray-900/40 border-gray-800/50">
              <span className="text-sm text-gray-400">Balance</span>
              <div className="flex items-center gap-1 font-mono">
                <span className="text-green-500">$</span>
                <span className="text-gray-200">{serviceBalances[service.id] || "0.00"}</span>
                <span className="ml-1 text-xs text-gray-500">USDC</span>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onFundService(service.name)}
              className="flex items-center justify-center flex-1 py-2 text-sm font-medium text-green-400 transition-colors bg-gray-900 border rounded-lg hover:bg-gray-800 border-green-900/30 hover:border-green-500/50"
            >
              <HandCoins className="w-4 h-4 mr-1.5" />
              Fund
            </button>

            <button
              onClick={() => onSweepService(service.name)}
              className="flex items-center justify-center flex-1 py-2 text-sm font-medium text-blue-400 transition-colors bg-gray-900 border rounded-lg hover:bg-gray-800 border-blue-900/30 hover:border-blue-500/50"
            >
              <ArrowUpRight className="w-4 h-4 mr-1.5" />
              Sweep
            </button>

            <Link href={`/dashboard/services/${service.agentId}`} className="flex items-center justify-center flex-1 w-full h-full p-2 text-sm font-medium text-white transition-colors bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700" title="Agent Details">
              <Activity className="w-4 h-4" />
            </Link>
          </div>

          <div className="mt-4">
            <PaidInvokePanel
              sellerAddress={service.sellerAddress}
              endpoint={service.endpoint}
              serviceId={service.serviceId}
              pricing={service.pricing}
              isActive={service.isActive}
              title="Quick Pay & Invoke"
              compact
              defaultCollapsed
            />
          </div>
        </div>
      ))}
    </div>
  );
}
