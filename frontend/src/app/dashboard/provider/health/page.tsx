"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Activity, ArrowLeft, RefreshCw, Server } from "lucide-react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import {
  getServiceHealthHistory,
  listServiceRegistry,
  type ServiceHealthHistoryResponse,
  type ServiceTargetHealthHistory,
} from "@/utils/serviceApi";
import { useAuth } from "@/components/WalletAuthGuard";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ChartRow = {
  checkedAt: number;
  status: number;
  statusText: string;
  latencyMs: number;
};

type JitterRow = {
  bin: string;
  count: number;
};

const STATUS_TO_SCORE: Record<string, number> = {
  unknown: 0,
  unhealthy: 1,
  degraded: 2,
  healthy: 3,
};

function statusToScore(status: string): number {
  return STATUS_TO_SCORE[status] ?? 0;
}

function formatTimeLabel(tsMs: number): string {
  return new Date(tsMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildSeries(target: ServiceTargetHealthHistory): ChartRow[] {
  return [...target.history]
    .sort((a, b) => a.checkedAt - b.checkedAt)
    .map((point) => ({
      checkedAt: point.checkedAt,
      status: statusToScore(point.status),
      statusText: point.status,
      latencyMs: Number(point.latencyMs || 0),
    }));
}

function buildJitter(target: ServiceTargetHealthHistory): JitterRow[] {
  const bins = [
    { max: 50, label: "0-50ms" },
    { max: 100, label: "50-100ms" },
    { max: 200, label: "100-200ms" },
    { max: 400, label: "200-400ms" },
    { max: 800, label: "400-800ms" },
    { max: 1200, label: "800-1200ms" },
    { max: Number.POSITIVE_INFINITY, label: "1200ms+" },
  ];

  const counters = new Map<string, number>();
  for (const bin of bins) {
    counters.set(bin.label, 0);
  }

  for (const row of target.history) {
    const latency = Number(row.latencyMs || 0);
    const matched = bins.find((bin) => latency <= bin.max);
    const label = matched ? matched.label : "1200ms+";
    counters.set(label, (counters.get(label) || 0) + 1);
  }

  return bins.map((bin) => ({
    bin: bin.label,
    count: counters.get(bin.label) || 0,
  }));
}

export default function ProviderHealthPage() {
  const { address } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  const searchParams = useSearchParams();

  const [services, setServices] = useState<Array<{ serviceId: string; name: string }>>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string>("");
  const [loadingServices, setLoadingServices] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [history, setHistory] = useState<ServiceHealthHistoryResponse | null>(null);

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

        const fromQuery = searchParams.get("serviceId") || "";
        const picked = mapped.find((svc) => svc.serviceId === fromQuery)?.serviceId || mapped[0]?.serviceId || "";
        setSelectedServiceId(picked);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load service list");
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
  }, [address, isSessionAuthenticated, searchParams]);

  const fetchHistory = useCallback(async (serviceId: string) => {
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
      setHistory(null);
      toast.error(err instanceof Error ? err.message : "Failed to load health history");
    } finally {
      setLoadingHistory(false);
    }
  }, [address, isSessionAuthenticated]);

  useEffect(() => {
    if (!selectedServiceId) {
      setHistory(null);
      return;
    }
    void fetchHistory(selectedServiceId);
  }, [fetchHistory, selectedServiceId]);

  const targetPanels = useMemo(() => {
    if (!history) {
      return [] as Array<{ target: ServiceTargetHealthHistory; series: ChartRow[]; jitter: JitterRow[] }>;
    }
    return history.targets.map((target) => ({
      target,
      series: buildSeries(target),
      jitter: buildJitter(target),
    }));
  }, [history]);

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
        Select a service to inspect target health trends.
      </div>
    );
  } else if (history.targets.length === 0) {
    bodyContent = (
      <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-10 text-center text-[#86868b]">
        No retained history for this service in the current window.
      </div>
    );
  } else {
    bodyContent = (
      <div className="space-y-5">
        {targetPanels.map(({ target, series, jitter }) => (
          <section key={target.targetUrl} className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-5 space-y-5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-white">{target.targetUrl}</h2>
                <p className="text-xs text-[#86868b] mt-1">Latest status: {target.latestStatus}</p>
              </div>
              <div className="text-xs text-[#86868b]">Samples: {target.history.length}</div>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <div className="rounded-xl border border-[#1f1f1f] bg-[#060606] p-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-[#86868b]">Health Curve (status + latency)</p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series}>
                      <CartesianGrid stroke="#1b1b1b" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="checkedAt"
                        tickFormatter={(value) => formatTimeLabel(Number(value))}
                        stroke="#666"
                        minTickGap={24}
                      />
                      <YAxis
                        yAxisId="status"
                        domain={[0, 3]}
                        ticks={[0, 1, 2, 3]}
                        tickFormatter={(v) => ["unknown", "unhealthy", "degraded", "healthy"][Number(v)] || "unknown"}
                        stroke="#4ade80"
                        width={78}
                      />
                      <YAxis yAxisId="latency" orientation="right" stroke="#93c5fd" width={42} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#0b0b0b", border: "1px solid #252525" }}
                        labelFormatter={(value) => new Date(Number(value)).toLocaleString()}
                      />
                      <Legend />
                      <Line yAxisId="status" type="monotone" dataKey="status" stroke="#22c55e" dot={false} strokeWidth={2} name="Health Score" />
                      <Line yAxisId="latency" type="monotone" dataKey="latencyMs" stroke="#60a5fa" dot={false} strokeWidth={1.5} name="Latency (ms)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-[#1f1f1f] bg-[#060606] p-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-[#86868b]">Jitter Distribution (latency bins)</p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={jitter}>
                      <CartesianGrid stroke="#1b1b1b" strokeDasharray="3 3" />
                      <XAxis dataKey="bin" stroke="#666" />
                      <YAxis stroke="#4ade80" allowDecimals={false} />
                      <Tooltip contentStyle={{ backgroundColor: "#0b0b0b", border: "1px solid #252525" }} />
                      <Bar dataKey="count" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 mx-auto max-w-7xl text-white bg-[#000000] min-h-screen space-y-6">
      <div className="flex items-center justify-between border-b border-[#222222] pb-5">
        <div>
          <h1 className="text-3xl md:text-4xl font-[800] tracking-tight text-white flex items-center gap-3">
            <Activity className="w-8 h-8 text-[#22c55e]" />
            Seller Health Console
          </h1>
          <p className="mt-2 text-sm text-[#86868b]">
            24h health curve and latency jitter distribution per target.
          </p>
        </div>
        <Link
          href="/provider/nodes"
          className="inline-flex items-center gap-2 rounded-lg border border-[#333333] px-4 py-2 text-sm text-[#d1d1d4] hover:border-white hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back To API Services
        </Link>
      </div>

      <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <label htmlFor="health-service-select" className="text-xs tracking-wide text-[#86868b] uppercase">Service</label>
        <select
          id="health-service-select"
          value={selectedServiceId}
          onChange={(e) => setSelectedServiceId(e.target.value)}
          className="w-full lg:w-[360px] rounded-lg border border-[#222222] bg-[#050505] px-3 py-2 text-sm text-white outline-none"
          disabled={loadingServices || services.length === 0}
        >
          {services.map((svc) => (
            <option key={svc.serviceId} value={svc.serviceId}>
              {svc.name} ({svc.serviceId})
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            if (selectedServiceId) {
              void fetchHistory(selectedServiceId);
            }
          }}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 px-4 py-2 text-sm font-semibold text-[#22c55e] hover:bg-[#22c55e] hover:text-black"
        >
          <RefreshCw className={`h-4 w-4 ${loadingHistory ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {history && (
        <div className="rounded-xl border border-[#214228] bg-[#09130b] p-4 text-sm text-[#8de1a5]">
          Requested 24h window, current retention is {history.retentionHours}h. Data shown is clipped to the retained window.
        </div>
      )}

      {bodyContent}
    </div>
  );
}
