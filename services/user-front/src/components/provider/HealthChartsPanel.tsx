"use client";

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
import type { ServiceTargetHealthHistory } from "@/utils/serviceApi";

type ChartRow = {
  checkedAt: number;
  status: number;
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

type Props = {
  targets: ServiceTargetHealthHistory[];
};

export default function HealthChartsPanel({ targets }: Readonly<Props>) {
  return (
    <div className="space-y-5">
      {targets.map((target) => {
        const series = buildSeries(target);
        const jitter = buildJitter(target);

        return (
          <section key={target.targetUrl} className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-5 space-y-5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-white">{target.targetUrl}</h2>
                <p className="text-xs text-[#86868b] mt-1">Latest status: {target.latestStatus}</p>
              </div>
              <div className="text-xs text-[#86868b]">Samples: {target.history.length}</div>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-[#1f1f1f] bg-[#060606] p-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-[#86868b]">Health Curve (status + latency)</p>
                <div className="h-64 min-h-[256px] min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={220}>
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

              <div className="min-w-0 rounded-xl border border-[#1f1f1f] bg-[#060606] p-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-[#86868b]">Jitter Distribution (latency bins)</p>
                <div className="h-64 min-h-[256px] min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={220}>
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
        );
      })}
    </div>
  );
}
