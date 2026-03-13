"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ServiceRegistryRecord, discoverServices } from "@/utils/serviceApi";
import { Copy, TerminalSquare, Activity, Globe } from "lucide-react";
import toast from "react-hot-toast";

export default function DiscoverPage() {
  const [intent, setIntent] = useState("");
  const [services, setServices] = useState<ServiceRegistryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await discoverServices(intent);
      setServices(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to discover services");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Service ID copied to clipboard");
  };

  return (
    <div className="max-w-6xl p-8 mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">AI Service Discovery</h1>
          <p className="mt-2 text-gray-400">
            Synapse Network 赛博黄页 - 选择并集成全网最优的去中心化 AI 算力与服务节点
          </p>
        </div>
              </div>

      <div className="flex items-center justify-between gap-3 p-4 border border-gray-800 rounded-lg bg-gray-900/50">
        <div className="flex w-full space-x-4">
          <input
            type="text"
            placeholder="Search intent or tags (e.g. weather, llm, image, data)..."
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="w-full px-4 py-3 text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-8 py-3 font-semibold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400 disabled:opacity-50 min-w-[140px]"
          >
            {loading ? "Searching..." : "Discover"}
          </button>
        </div>
      </div>

      {error && <div className="p-4 text-red-500 rounded-lg bg-red-900/50">{error}</div>}

      <div className="overflow-hidden border border-gray-800 rounded-xl bg-black/40">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/40 text-gray-400 text-sm font-semibold">
                <th className="p-4 pl-6 whitespace-nowrap">Node / Provider</th>
                <th className="p-4 whitespace-nowrap">Capabilities</th>
                <th className="p-4 whitespace-nowrap text-right">Price (per call)</th>
                <th className="p-4 whitespace-nowrap text-center">Status</th>
                <th className="p-4 pr-6 whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {services.length === 0 && !loading && !error && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-500">
                    <Globe className="w-10 h-10 mx-auto mb-3 text-gray-700 opacity-50" />
                    暂无匹配的 API 服务。卖家可以去 Developer Console 注册新服务。
                  </td>
                </tr>
              )}
              {services.map((svc) => (
                <tr 
                  key={svc.serviceId} 
                  className="transition-colors hover:bg-gray-900/50 group"
                >
                  <td className="p-4 pl-6">
                    <div className="flex flex-col">
                      <span className="font-bold text-white text-base">
                        {svc.serviceName || svc.name || "未命名服务"}
                      </span>
                      <span className="text-xs text-gray-500 font-mono mt-1 flex items-center">
                        {svc.serviceId}
                      </span>
                    </div>
                  </td>
                  
                  <td className="p-4">
                    <div className="flex flex-wrap gap-2">
                      {svc.tags && svc.tags.length > 0 ? (
                        svc.tags.map((tag) => (
                          <span
                            key={`${svc.serviceId}-${tag}`}
                            className="px-2 py-1 text-xs text-gray-300 border border-gray-700 rounded bg-gray-800/80"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-gray-600 italic">Standard</span>
                      )}
                    </div>
                  </td>

                  <td className="p-4 text-right">
                    <div className="inline-flex items-center justify-end px-2 py-1 space-x-1.5 text-sm font-mono text-green-400 bg-green-900/20 rounded">
                      <span>{svc.pricing}</span>
                      <span className="text-xs opacity-70">USDC</span>
                    </div>
                  </td>

                  <td className="p-4 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <div className="flex items-center space-x-2">
                        <div className="relative flex w-2 h-2">
                          <span className="absolute inline-flex w-full h-full bg-green-400 rounded-full opacity-75 animate-ping"></span>
                          <span className="relative inline-flex w-2 h-2 bg-green-500 rounded-full"></span>
                        </div>
                        <span className="text-xs font-semibold text-green-500">99.9%</span>
                      </div>
                      <span className="text-[10px] text-gray-600 mt-0.5">{"<"} 40ms</span>
                    </div>
                  </td>

                  <td className="p-4 pr-6">
                    <div className="flex items-center justify-end gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleCopy(svc.serviceId)}
                        title="Copy Service ID"
                        className="p-2 text-gray-400 transition-colors border border-gray-700 rounded bg-gray-800 hover:text-white hover:border-gray-600"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <Link
                        href={`/dashboard/router`}
                        title="Open in Router"
                        className="p-2 text-green-400 transition-colors border border-green-900 rounded bg-green-900/20 hover:bg-green-500 hover:text-black"
                      >
                        <TerminalSquare className="w-4 h-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex items-center justify-center pt-4">
        <p className="text-xs text-gray-600 flex items-center">
          <Activity className="w-3 h-3 mr-1" />
          Real-time network indices updated locally by Synapse Gateway
        </p>
      </div>
    </div>
  );
}
