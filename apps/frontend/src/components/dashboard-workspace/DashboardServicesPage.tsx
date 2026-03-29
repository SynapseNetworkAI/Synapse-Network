"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Server, Plus, Activity } from "lucide-react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useLanguage } from "@/components/i18n/LanguageProvider";
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

function normalizedServiceStatus(svc: ServiceRegistryRecord): "active" | "inactive" | "archived" | "deleted" {
  const raw = String(svc.status || "").toLowerCase();
  if (raw === "inactive" || raw === "archived" || raw === "deleted") {
    return raw;
  }
  return svc.isActive ? "active" : "inactive";
}

export default function ServicesPage() {
  const { t } = useLanguage();
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
        ? t("servicesPage.confirmActivate", { serviceId: svc.serviceId })
        : t("servicesPage.confirmDeactivate", { serviceId: svc.serviceId })
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
        toast.success(nextActive ? t("servicesPage.serviceActivated") : t("servicesPage.serviceSetInactive"));
      } catch (err) {
        setServices(prevServices);
        invalidateServiceRegistryListCache(address);
        toast.error(err instanceof Error ? err.message : t("servicesPage.updateStatusFailed"));
      } finally {
        setStatusUpdatingServiceId(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("servicesPage.updateStatusFailed"));
    }
  };

  const deleteService = async (svc: ServiceRegistryRecord) => {
    if (!address || statusUpdatingServiceId || deletingServiceId || svc.isActive) {
      return;
    }

    const confirmed = globalThis.confirm(
      t("servicesPage.confirmDelete", { serviceId: svc.serviceId })
    );
    if (!confirmed) {
      return;
    }

    const prevServices = services;
    setDeletingServiceId(svc.serviceId);
    setServices((prev) => prev.filter((item) => item.serviceId !== svc.serviceId));

    try {
      await deleteServiceRegistry(svc.serviceId, address);
      toast.success(t("servicesPage.serviceDeleted"));
    } catch (err) {
      setServices(prevServices);
      invalidateServiceRegistryListCache(address);
      toast.error(err instanceof Error ? err.message : t("servicesPage.deleteFailed"));
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
      const message = err instanceof Error ? err.message : t("servicesPage.loadFailed");
      if (!message.toLowerCase().includes("wallet auth session missing")) {
        toast.error(t("servicesPage.loadFailed"));
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

  const handleEditService = (svc: ServiceRegistryRecord) => {
    const serviceStatus = normalizedServiceStatus(svc);
    if (serviceStatus !== "inactive") {
      toast.error(
        serviceStatus === "active"
          ? t("servicesPage.activeEditBlocked")
          : t("servicesPage.inactiveOnlyEditBlocked"),
      );
      return;
    }

    router.push(`/provider/services?edit=${encodeURIComponent(svc.serviceId)}`);
  };

  const handleOpenDeployService = () => {
    if (!address) {
      openConnectModal?.();
      return;
    }
    router.push("/provider/services/deploy");
  };

  let managedServicesContent: JSX.Element;

  if (address == null) {
    managedServicesContent = (
      <div className="p-8 text-center border border-gray-800 rounded-xl bg-black/40">
        <p className="text-gray-300">{t("servicesPage.walletNotConnected")}</p>
        <p className="text-gray-500 text-sm mt-2">{t("servicesPage.walletNotConnectedDescription")}</p>
      </div>
    );
  } else if (isSessionAuthenticated !== true) {
    managedServicesContent = (
      <div className="p-8 text-center border border-yellow-700/30 rounded-xl bg-yellow-900/10">
        <p className="text-yellow-200">{t("servicesPage.sessionNotAuthenticated")}</p>
        <p className="text-yellow-300/80 text-sm mt-2">{t("servicesPage.sessionNotAuthenticatedDescription")}</p>
      </div>
    );
  } else if (loading) {
    managedServicesContent = (
      <div className="p-8 text-center text-green-400 animate-pulse">{t("servicesPage.loading")}</div>
    );
  } else if (services.length === 0) {
    managedServicesContent = (
      <div className="p-12 text-center border border-dashed border-gray-800 rounded-xl bg-black/20">
        <Server className="w-12 h-12 mx-auto mb-4 text-gray-600" />
        <h3 className="mb-2 text-xl font-bold text-white">{t("servicesPage.emptyTitle")}</h3>
        <p className="mb-6 text-gray-400">{t("servicesPage.emptyDescription")}</p>
        <button
          onClick={handleOpenDeployService}
          className="inline-flex items-center px-6 py-2 font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-600"
        >
          <Plus className="w-5 h-5 mr-2" />
          {t("servicesPage.createFirstService")}
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
              const serviceStatus = normalizedServiceStatus(svc);
              const canEditService = serviceStatus === "inactive";
              let statusActionLabel = t("servicesPage.actionActivate");
              if (isStatusUpdating) {
                statusActionLabel = t("servicesPage.actionUpdating");
              } else if (svc.isActive) {
                statusActionLabel = t("servicesPage.actionInactive");
              }

              return <>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="flex items-center text-xl font-bold text-white">
                  {svc.name}
                  <span className={`ml-3 px-2 py-1 text-xs rounded-full ${svc.isActive ? "bg-green-500/20 text-green-400" : "bg-amber-500/20 text-amber-300"}`}>
                    {svc.isActive ? t("servicesPage.statusActive") : t("servicesPage.statusInactive")}
                  </span>
                </h3>
                <p className="mt-1 font-mono text-sm text-gray-400">{svc.serviceId}</p>
              </div>
            </div>

            <div className="mb-6 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t("servicesPage.fieldEndpoint")}</span>
                <span className="text-gray-300 font-mono truncate max-w-[200px]">{svc.endpoint}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t("servicesPage.fieldPricing")}</span>
                <span className="font-mono text-green-400">{formatPricing(svc.pricing)}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleEditService(svc)}
                disabled={isDeleting || isStatusUpdating}
                title={canEditService ? t("servicesPage.editInactiveService") : t("servicesPage.setInactiveBeforeEditing")}
                className={`flex-1 px-4 py-2 font-bold transition rounded text-sm disabled:cursor-not-allowed disabled:opacity-50 ${canEditService
                  ? "text-white bg-gray-800 hover:bg-gray-700"
                  : "text-amber-200 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/15"
                }`}
              >
                {t("servicesPage.editService")}
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
                onClick={() => void deleteService(svc)}
                disabled={svc.isActive || isDeleting || isStatusUpdating}
                className="flex-1 px-4 py-2 text-sm font-bold transition border rounded disabled:cursor-not-allowed disabled:opacity-50 text-red-300 border-red-500/30 hover:bg-red-500/10"
              >
                {isDeleting ? t("servicesPage.deleting") : t("servicesPage.delete")}
              </button>
              <button
                onClick={() => router.push(`/provider/health?serviceId=${encodeURIComponent(svc.serviceId)}`)}
                disabled={isDeleting}
                className="flex items-center justify-center flex-1 px-4 py-2 text-sm font-bold text-green-400 transition border border-green-500/30 rounded hover:bg-green-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Activity className="w-4 h-4 mr-2" />
                {t("servicesPage.health")}
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
            {t("servicesPage.title")}
          </h1>
          <p className="mt-2 text-gray-400">{t("servicesPage.description")}</p>
        </div>
        <div className="flex gap-4">
          <Link href="/dashboard" className="flex items-center px-4 py-2 text-gray-300 transition-colors bg-gray-900 border border-gray-700 rounded-lg hover:bg-gray-800">
            <ArrowLeft className="w-5 h-5 mr-2" />
            {t("servicesPage.backToDashboard")}
          </Link>
          <button
            onClick={handleOpenDeployService}
            className="flex items-center px-6 py-2 font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-600"
          >
            <Plus className="w-5 h-5 mr-2" />
            {t("servicesPage.newService")}
          </button>
        </div>
      </div>

      {managedServicesContent}

      <div className="rounded-xl border border-gray-800 bg-black/30 p-4 text-xs text-gray-400">
        {t("servicesPage.footerNote")}
      </div>

    </div>
  );
}
