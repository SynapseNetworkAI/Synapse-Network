"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Activity, ArrowLeft, RefreshCw, Server } from "lucide-react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import {
  getServiceHealthHistory,
  listServiceRegistry,
  type ServiceHealthHistoryResponse,
} from "@/utils/serviceApi";
import { useAuth } from "@/components/WalletAuthGuard";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import CopyableValue from "@/components/xui/CopyableValue";
import XSelect from "@/components/xui/XSelect";

const HealthChartsPanel = dynamic(
  () => import("@/components/provider/HealthChartsPanel"),
  {
    loading: () => (
      <div className="space-y-5">
        <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-5">
          <div className="h-5 w-56 animate-pulse rounded bg-[#1a1a1a]" />
          <div className="mt-5 h-64 animate-pulse rounded-xl bg-[#080808]" />
        </div>
      </div>
    ),
    ssr: false,
  }
);

export default function ProviderHealthPage() {
  const { address } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const queryServiceId = searchParams?.get("serviceId") || "";

  const [services, setServices] = useState<
    Array<{ serviceId: string; name: string }>
  >([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string>("");
  const [loadingServices, setLoadingServices] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [history, setHistory] = useState<ServiceHealthHistoryResponse | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;

    const loadServices = async () => {
      if (!address || !isSessionAuthenticated) {
        setServices([]);
        setSelectedServiceId("");
        setLoadingServices(false);
        return;
      }

      setLoadingServices(true);
      try {
        const rows = await listServiceRegistry(address, address);
        if (cancelled) {
          return;
        }
        const mapped = rows.map((row) => ({
          serviceId: row.serviceId,
          name: row.serviceName || row.name || row.serviceId,
        }));
        setServices(mapped);

        const picked =
          mapped.find((svc) => svc.serviceId === queryServiceId)?.serviceId ||
          mapped[0]?.serviceId ||
          "";
        setSelectedServiceId(picked);
      } catch (err) {
        console.error("Failed to load provider services:", err);
        if (!cancelled) {
          toast.error(t("providerServicesPage.loadFailed"));
          setServices([]);
          setSelectedServiceId("");
        }
      } finally {
        if (!cancelled) {
          setLoadingServices(false);
        }
      }
    };

    void loadServices();
    return () => {
      cancelled = true;
    };
  }, [address, isSessionAuthenticated, queryServiceId, t]);

  const fetchHistory = useCallback(
    async (serviceId: string) => {
      if (!address || !serviceId || !isSessionAuthenticated) {
        setHistory(null);
        return;
      }

      setLoadingHistory(true);
      try {
        const payload = await getServiceHealthHistory(serviceId, address, {
          hours: 24,
          limitPerTarget: 2000,
        });
        setHistory(payload);
      } catch (err) {
        console.error("Failed to load provider health history:", err);
        setHistory(null);
        toast.error(t("providerServicesPage.healthHistoryLoadFailed"));
      } finally {
        setLoadingHistory(false);
      }
    },
    [address, isSessionAuthenticated, t]
  );

  useEffect(() => {
    if (!selectedServiceId) {
      setHistory(null);
      return;
    }
    void fetchHistory(selectedServiceId);
  }, [fetchHistory, selectedServiceId]);

  let bodyContent: JSX.Element;
  if (loadingHistory) {
    bodyContent = (
      <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-10 text-center text-[#86868b]">
        Loading health history...
      </div>
    );
  } else if (!history) {
    bodyContent = (
      <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-10 text-center text-[#86868b]">
        <Server className="mx-auto mb-3 h-8 w-8 text-[#3d3d3f]" />
        Select an API service to inspect runtime target health trends.
      </div>
    );
  } else if (history.targets.length === 0) {
    bodyContent = (
      <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-10 text-center text-[#86868b]">
        No retained history for this service in the current window.
      </div>
    );
  } else {
    bodyContent = <HealthChartsPanel targets={history.targets} />;
  }

  return (
    <div className="p-6 md:p-10 mx-auto max-w-7xl text-white bg-[#000000] min-h-screen space-y-6">
      <div className="flex items-center justify-between border-b border-[#222222] pb-5">
        <div>
          <h1 className="text-3xl md:text-4xl font-[800] tracking-tight text-white flex items-center gap-3">
            <Activity className="w-8 h-8 text-[#22c55e]" />
            API Service Health
          </h1>
          <p className="mt-2 text-sm text-[#86868b]">
            24h runtime health curve and latency jitter distribution for targets
            behind each API service.
          </p>
        </div>
        <Link
          href="/provider/services"
          className="inline-flex items-center gap-2 rounded-lg border border-[#333333] px-4 py-2 text-sm text-[#d1d1d4] hover:border-white hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back To API Services
        </Link>
      </div>

      <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <label
          htmlFor="health-service-select"
          className="text-xs tracking-wide text-[#86868b] uppercase"
        >
          API Service
        </label>
        <XSelect
          id="health-service-select"
          value={selectedServiceId}
          onChange={(next) => setSelectedServiceId(next)}
          options={services.map((svc) => ({
            value: svc.serviceId,
            label: `${svc.name} (${svc.serviceId})`,
          }))}
          triggerClassName="inline-flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-[#222222] bg-[#050505] px-3 py-2 text-sm text-white lg:w-[360px]"
          disabled={loadingServices || services.length === 0}
        />
        <CopyableValue
          value={selectedServiceId}
          label="Service ID"
          valueClassName="font-mono text-xs text-[#86868b]"
          startChars={18}
          endChars={8}
        />
        <button
          onClick={() => {
            if (selectedServiceId) {
              void fetchHistory(selectedServiceId);
            }
          }}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 px-4 py-2 text-sm font-semibold text-[#22c55e] hover:bg-[#22c55e] hover:text-black"
        >
          <RefreshCw
            className={`h-4 w-4 ${loadingHistory ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {history && (
        <div className="rounded-xl border border-[#214228] bg-[#09130b] p-4 text-sm text-[#8de1a5]">
          Requested 24h window, current retention is {history.retentionHours}h.
          Data shown is clipped to the retained window.
        </div>
      )}

      {bodyContent}
    </div>
  );
}
