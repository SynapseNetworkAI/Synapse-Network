"use client";

import { useEffect, useState } from "react";
import { ServiceRegistryRecord, discoverServices } from "@/utils/serviceApi";

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

  return (
    <div className="max-w-6xl p-8 mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">AI Service Discovery</h1>
        <p className="mt-2 text-gray-400">
          AgentPay 赛博黄页 - 供买家 AI Agent 检索和发现所需 API
        </p>
      </div>

      <div className="flex space-x-4">
        <input
          type="text"
          placeholder="输入意图或关键词 (例如: 天气, 翻译, 图片)"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          className="w-full px-4 py-3 text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-8 py-3 font-semibold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400 disabled:opacity-50"
        >
          {loading ? "Searching..." : "发现"}
        </button>
      </div>

      {error && <div className="p-4 text-red-500 rounded-lg bg-red-900/50">{error}</div>}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {services.length === 0 && !loading && !error && (
          <div className="py-12 text-center text-gray-500 bg-gray-900 border border-gray-800 rounded-lg col-span-full">
            暂无匹配的 API 服务。卖家可以去 Sell 模块上架服务哦！
          </div>
        )}
        {services.map((svc) => (
          <div
            key={svc.serviceId}
            className="flex flex-col justify-between p-6 transition-all border border-gray-800 rounded-xl bg-gray-900/50 hover:bg-gray-800/80"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xl font-semibold text-white">
                  {svc.serviceName || svc.name || "未命名服务"}
                </h3>
                <span className="px-2 py-1 text-xs text-green-400 rounded bg-green-900/30">
                  {svc.pricing} USDC
                </span>
              </div>
              <p className="text-sm text-gray-400 min-h-[3rem] line-clamp-2">
                {svc.summary || "暂无描述"}
              </p>

              <div className="mt-4 text-xs text-gray-500 break-all">
                <span>Method: {svc.invoke?.method || "N/A"}</span>
              </div>

              {svc.tags && svc.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {svc.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 text-xs text-gray-300 bg-gray-800 rounded"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6">
              <button
                className="w-full px-4 py-2 text-sm font-semibold text-center text-gray-400 transition-colors border border-gray-700 rounded-lg hover:text-white hover:bg-gray-700 hover:border-gray-600"
                onClick={() => {
                  alert(
                    `【模拟 AI 决策与调用】\n\n1. AI 确认此服务意图匹配.\n2. 价格 [${svc.pricing} USDC] 在预算内.\n3. 获取 Schema 格式完毕.\n4. 系统即将拿着 Credential 向网关发起请求...`
                  );
                }}
              >
                授权 Agent 代调用
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}