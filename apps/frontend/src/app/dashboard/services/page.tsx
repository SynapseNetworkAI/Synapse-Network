"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Server, Plus, Activity } from "lucide-react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { discoverServices, listServiceRegistry, type ServiceRegistryRecord } from "@/utils/serviceApi";
import { formatPricing } from "@/utils/pricing";
import { useAuth } from "@/components/WalletAuthGuard";

export default function ServicesPage() {
  const router = useRouter();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { isSessionAuthenticated } = useAuth();
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const [services, setServices] = useState<any[]>([]);
  const [publicServices, setPublicServices] = useState<ServiceRegistryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  
  const loadServices = async () => {
    try {
      const data = await listServiceRegistry(address as string, address as string);
      setServices(data);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Failed to load services";
      if (!message.toLowerCase().includes("wallet auth session missing")) {
        toast.error("Failed to load services");
      }
      setServices([]);
    } finally {
      setLoading(false);
    }
  };

  const loadPublicServices = async () => {
    try {
      const rows = await discoverServices();
      setPublicServices(rows);
    } catch (err) {
      console.warn("Failed to load public services", err);
      setPublicServices([]);
    }
  };

  useEffect(() => {
    void loadPublicServices();

    if (address) {
      void loadServices();
    } else {
      setServices([]);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const handleOpenDeployManifest = () => {
    if (!address) {
      openConnectModal?.();
      return;
    }
    router.push("/dashboard/services/deploy");
  };

  let managedServicesContent: JSX.Element;

  if (address == null) {
    managedServicesContent = (
      <div className="p-8 text-center border border-gray-800 rounded-xl bg-black/40">
        <p className="text-gray-300">Wallet not connected. You can still browse public services registered on Synapse.</p>
        <p className="text-gray-500 text-sm mt-2">Connect and sign in to manage your own provider services.</p>
      </div>
    );
  } else if (isSessionAuthenticated !== true) {
    managedServicesContent = (
      <div className="p-8 text-center border border-yellow-700/30 rounded-xl bg-yellow-900/10">
        <p className="text-yellow-200">Session not authenticated yet.</p>
        <p className="text-yellow-300/80 text-sm mt-2">Sign in with wallet to view and manage your private service registry.</p>
      </div>
    );
  } else if (loading) {
    managedServicesContent = (
      <div className="p-8 text-center text-green-400 animate-pulse">Loading Synapses...</div>
    );
  } else if (services.length === 0) {
    managedServicesContent = (
      <div className="p-12 text-center border border-dashed border-gray-800 rounded-xl bg-black/20">
        <Server className="w-12 h-12 mx-auto mb-4 text-gray-600" />
        <h3 className="mb-2 text-xl font-bold text-white">No Services Found</h3>
        <p className="mb-6 text-gray-400">You haven&apos;t deployed any Service Manifests yet.</p>
        <button
          onClick={handleOpenDeployManifest}
          className="inline-flex items-center px-6 py-2 font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-600"
        >
          <Plus className="w-5 h-5 mr-2" />
          Deploy Your First API
        </button>
      </div>
    );
  } else {
    managedServicesContent = (
      <div className="grid gap-6 md:grid-cols-2">
        {services.map((svc) => (
          <div key={svc.id} className="p-6 border border-gray-800 rounded-xl bg-gray-900/50 hover:border-green-500/50 transition-colors">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="flex items-center text-xl font-bold text-white">
                  {svc.name}
                  <span className={`ml-3 px-2 py-1 text-xs rounded-full ${svc.isActive ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                    {svc.isActive ? "Active" : "Offline"}
                  </span>
                </h3>
                <p className="mt-1 font-mono text-sm text-gray-400">{svc.serviceId}</p>
              </div>
            </div>

            <div className="mb-6 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Endpoint</span>
                <span className="text-gray-300 font-mono truncate max-w-[200px]">{svc.endpoint}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Pricing</span>
                <span className="font-mono text-green-400">{formatPricing(svc.pricing)}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => router.push(`/dashboard/provider/nodes?edit=${encodeURIComponent(svc.serviceId)}`)}
                className="flex-1 px-4 py-2 font-bold text-white transition bg-gray-800 rounded hover:bg-gray-700 text-sm"
              >
                Edit Manifest
              </button>
              <button
                onClick={() => router.push(`/dashboard/provider/health?serviceId=${encodeURIComponent(svc.serviceId)}`)}
                className="flex items-center justify-center flex-1 px-4 py-2 text-sm font-bold text-green-400 transition border border-green-500/30 rounded hover:bg-green-500/10"
              >
                <Activity className="w-4 h-4 mr-2" />
                Health
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="p-8 mx-auto space-y-8 max-w-7xl">
      <div className="flex items-center justify-between pb-4 border-b border-gray-800">
        <div>
          <h1 className="flex items-center text-3xl font-bold text-white">
            <Server className="mr-3 text-green-400" />
            Provider Management
          </h1>
          <p className="mt-2 text-gray-400">Manage your deployed API manifests and monitor endpoint health.</p>
        </div>
        <div className="flex gap-4">
          <Link href="/dashboard" className="flex items-center px-4 py-2 text-gray-300 transition-colors bg-gray-900 border border-gray-700 rounded-lg hover:bg-gray-800">
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Dashboard
          </Link>
          <button
            onClick={handleOpenDeployManifest}
            className="flex items-center px-6 py-2 font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-600"
          >
            <Plus className="w-5 h-5 mr-2" />
            Deploy Manifest
          </button>
        </div>
      </div>

      {managedServicesContent}

      <div className="pt-8 border-t border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">Public API Marketplace</h2>
          <span className="text-xs uppercase tracking-wider text-gray-500">No login required</span>
        </div>

        {publicServices.length === 0 ? (
          <div className="p-6 border border-dashed border-gray-800 rounded-xl bg-black/20 text-gray-500 text-sm">
            No public services discovered yet.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {publicServices.map((svc) => (
              <div key={svc.serviceId} className="p-5 border border-gray-800 rounded-xl bg-gray-900/40">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-white">{svc.serviceName || svc.name || "Unnamed Service"}</h3>
                    <p className="text-xs font-mono text-gray-400 mt-1">{svc.serviceId}</p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 border border-green-500/30 text-green-300">
                    Public
                  </span>
                </div>
                <p className="text-sm text-gray-400 mt-3 line-clamp-2">{svc.summary || "No summary provided."}</p>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-gray-500">Pricing</span>
                  <span className="text-green-300 font-mono">{formatPricing(svc.pricing)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
