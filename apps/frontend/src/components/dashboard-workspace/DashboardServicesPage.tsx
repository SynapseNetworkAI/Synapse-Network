"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Server, Plus, Activity } from "lucide-react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  deleteServiceRegistry,
  invalidateServiceRegistryListCache,
  listServiceRegistry,
  updateServiceRegistry,
  upsertServiceRegistryListCache,
  type ServiceRegistryRecord,
} from "@/utils/serviceApi";
import { formatPricing } from "@/utils/pricing";
import { useAuth } from "@/components/WalletAuthGuard";
import { buildOptimisticServiceRecord, buildServiceStatusUpdatePayload } from "@/utils/serviceStatus";

export default function ServicesPage() {
  const router = useRouter();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { isSessionAuthenticated } = useAuth();
  const [services, setServices] = useState<ServiceRegistryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusUpdatingServiceId, setStatusUpdatingServiceId] = useState<string | null>(null);
  const [deletingServiceId, setDeletingServiceId] = useState<string | null>(null);

  const updateServiceStatus = async (svc: ServiceRegistryRecord, nextActive: boolean) => {
    if (!address || statusUpdatingServiceId || deletingServiceId) {
      return;
    }

    const confirmed = globalThis.confirm(
      nextActive
        ? `Activate service ${svc.serviceId}? It will appear for discovery again only when health checks report healthy targets.`
        : `Set service ${svc.serviceId} to inactive? New discovery and direct gateway forwarding requests will be blocked after this update.`
    );
    if (!confirmed) {
      return;
    }

    try {
      const payload = buildServiceStatusUpdatePayload(svc, nextActive);
      const optimisticService = buildOptimisticServiceRecord(svc, payload);

      const prevServices = services;
      setStatusUpdatingServiceId(svc.serviceId);
      setServices((prev) => prev.map((item) => (item.serviceId === svc.serviceId ? optimisticService : item)));
      upsertServiceRegistryListCache(optimisticService);

      try {
        await updateServiceRegistry(payload, address);
        toast.success(nextActive ? "Service activated" : "Service set to inactive");
      } catch (err) {
        setServices(prevServices);
        invalidateServiceRegistryListCache(address);
        toast.error(err instanceof Error ? err.message : "Failed to update service status");
      } finally {
        setStatusUpdatingServiceId(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update service status");
    }
  };

  const deleteService = async (svc: ServiceRegistryRecord) => {
    if (!address || statusUpdatingServiceId || deletingServiceId || svc.isActive) {
      return;
    }

    const confirmed = globalThis.confirm(
      `Delete service ${svc.serviceId}? This is a logical delete. The service will be marked as deleted, removed from your active service list, and kept only for audit history.`
    );
    if (!confirmed) {
      return;
    }

    const prevServices = services;
    setDeletingServiceId(svc.serviceId);
    setServices((prev) => prev.filter((item) => item.serviceId !== svc.serviceId));

    try {
      await deleteServiceRegistry(svc.serviceId, address);
      toast.success("Service deleted");
    } catch (err) {
      setServices(prevServices);
      invalidateServiceRegistryListCache(address);
      toast.error(err instanceof Error ? err.message : "Failed to delete service");
    } finally {
      setDeletingServiceId(null);
    }
  };
  
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

  useEffect(() => {
    if (address) {
      void loadServices();
    } else {
      setServices([]);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const handleOpenDeployService = () => {
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
        <p className="text-gray-300">Wallet not connected.</p>
        <p className="text-gray-500 text-sm mt-2">Connect and sign in to manage your API services and service definitions.</p>
      </div>
    );
  } else if (isSessionAuthenticated !== true) {
    managedServicesContent = (
      <div className="p-8 text-center border border-yellow-700/30 rounded-xl bg-yellow-900/10">
        <p className="text-yellow-200">Session not authenticated yet.</p>
        <p className="text-yellow-300/80 text-sm mt-2">Sign in with wallet to view and manage your private service definitions.</p>
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
        <p className="mb-6 text-gray-400">You haven&apos;t created any service definitions yet.</p>
        <button
          onClick={handleOpenDeployService}
          className="inline-flex items-center px-6 py-2 font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-600"
        >
          <Plus className="w-5 h-5 mr-2" />
          Create First Service
        </button>
      </div>
    );
  } else {
    managedServicesContent = (
      <div className="grid gap-6 md:grid-cols-2">
        {services.map((svc) => (
          <div key={svc.id} className="p-6 border border-gray-800 rounded-xl bg-gray-900/50 hover:border-green-500/50 transition-colors">
            {(() => {
              const isStatusUpdating = statusUpdatingServiceId === svc.serviceId;
              const isDeleting = deletingServiceId === svc.serviceId;
              let statusActionLabel = "Activate";
              if (isStatusUpdating) {
                statusActionLabel = "Updating...";
              } else if (svc.isActive) {
                statusActionLabel = "Inactive";
              }

              return <>
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
                onClick={() => router.push(`/provider/services?edit=${encodeURIComponent(svc.serviceId)}`)}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 font-bold text-white transition bg-gray-800 rounded hover:bg-gray-700 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                Edit Service
              </button>
              <button
                onClick={() => void deleteService(svc)}
                disabled={svc.isActive || isDeleting || isStatusUpdating}
                className="flex-1 px-4 py-2 text-sm font-bold transition border rounded disabled:cursor-not-allowed disabled:opacity-50 text-red-300 border-red-500/30 hover:bg-red-500/10"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
              <button
                onClick={() => void updateServiceStatus(svc, !svc.isActive)}
                disabled={isStatusUpdating || isDeleting}
                className={`flex-1 px-4 py-2 text-sm font-bold transition border rounded disabled:cursor-not-allowed disabled:opacity-50 ${svc.isActive
                  ? "text-amber-300 border-amber-500/30 hover:bg-amber-500/10"
                  : "text-green-400 border-green-500/30 hover:bg-green-500/10"
                }`}
              >
                {statusActionLabel}
              </button>
              <button
                onClick={() => router.push(`/dashboard/provider/health?serviceId=${encodeURIComponent(svc.serviceId)}`)}
                disabled={isDeleting}
                className="flex items-center justify-center flex-1 px-4 py-2 text-sm font-bold text-green-400 transition border border-green-500/30 rounded hover:bg-green-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Activity className="w-4 h-4 mr-2" />
                Health
              </button>
            </div>
              </>;
            })()}
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
            My Services
          </h1>
          <p className="mt-2 text-gray-400">Manage API services, service definitions, and endpoint health.</p>
        </div>
        <div className="flex gap-4">
          <Link href="/dashboard" className="flex items-center px-4 py-2 text-gray-300 transition-colors bg-gray-900 border border-gray-700 rounded-lg hover:bg-gray-800">
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Dashboard
          </Link>
          <button
            onClick={handleOpenDeployService}
            className="flex items-center px-6 py-2 font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-600"
          >
            <Plus className="w-5 h-5 mr-2" />
            New Service
          </button>
        </div>
      </div>

      {managedServicesContent}

    </div>
  );
}
