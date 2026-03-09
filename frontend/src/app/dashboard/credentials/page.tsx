"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { listServiceRegistry } from "@/utils/serviceApi";
import {
  issueAgentCredential,
  listAgentCredentials,
  listAuditLogs,
  revokeAgentCredential,
  updateAgentCredentialQuota,
  type AgentCredentialIssueResponse,
  type AgentCredentialRecord,
  type AuditLogRecord,
} from "@/utils/agentCredentialApi";
import { setCredentialForService } from "@/utils/agentCredentialStore";
import { clearAuthSession } from "@/utils/authSession";
import { useSearchParams } from "next/navigation";
import { agentStore } from "@/utils/agentStore";
import { listAgents } from "@/utils/agentApi";
import { useBillingData } from "@/hooks/useBillingData";

const WALLET_SESSION_MISSING_MESSAGE = "Wallet auth session missing. Please sign in with wallet.";

function CredentialsContent() {
  const { address: userAddress } = useAccount();
  const [serviceFilter, setServiceFilter] = useState("");
  const [services, setServices] = useState<Array<{ serviceId: string; agentId?: string; name: string }>>([]);

  const searchParams = useSearchParams();
  const initAgentId = searchParams.get("agentId");
  const [currentAgentInfo, setCurrentAgentInfo] = useState<{name: string, address: string} | null>(null);
  const [agentId, setAgentId] = useState(initAgentId || "");
  const [serviceId, setServiceId] = useState("");
  const [expiresInSec, setExpiresInSec] = useState("3600");
  const [expiresAtLocal, setExpiresAtLocal] = useState("");
  const [maxCalls, setMaxCalls] = useState("1000");
  const [rpm, setRpm] = useState("600");

  const [credentials, setCredentials] = useState<AgentCredentialRecord[]>([]);
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [latestIssued, setLatestIssued] = useState<AgentCredentialIssueResponse | null>(null);

  const [quotaMaxCalls, setQuotaMaxCalls] = useState("1000");
  const [quotaRpm, setQuotaRpm] = useState("600");
  const [quotaExpiresAt, setQuotaExpiresAt] = useState("");
  const [quotaExpiresAtLocal, setQuotaExpiresAtLocal] = useState("");
  const [selectedCredentialId, setSelectedCredentialId] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const { rows: billingRows } = useBillingData();

  useEffect(() => {
    if (initAgentId) {
      setAgentId(initAgentId);
    }
  }, [initAgentId]);


  useEffect(() => {
    if (!userAddress || !agentId) {
      setCurrentAgentInfo(null);
      return;
    }
    const fetchInfo = async () => {
      const localAgents = agentStore.getAgentsByOwner(userAddress);
      const local = localAgents.find((a) => String(a.id) === String(agentId));
      if (local) {
        setCurrentAgentInfo({ name: local.name, address: local.address });
        return;
      }
      
      // 2. check remote
      try {
        const remoteAgents = await listAgents(userAddress);
        const remote = remoteAgents.find((a) => String(a.id) === String(agentId));
        if (remote) {
          setCurrentAgentInfo({ name: String(remote.name), address: String(remote.address) });
        } else {
          setCurrentAgentInfo(null);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchInfo();
  }, [userAddress, agentId]);

  const loadAll = useCallback(async () => {
    if (!userAddress) {
      setServices([]);
      setCredentials([]);
      setLogs([]);
      return;
    }

    try {
      const [serviceRows, credentialRows, auditRows] = await Promise.all([
        listServiceRegistry(userAddress, userAddress),
        listAgentCredentials(userAddress),
        listAuditLogs(userAddress, 200),
      ]);

      setServices(
        serviceRows.map((row) => ({
          serviceId: row.serviceId,
          agentId: row.agentId,
          name: row.name,
        }))
      );
      setCredentials(credentialRows);
      setLogs(auditRows);

      if (!serviceId && serviceRows.length > 0) {
        const preferred = initAgentId
          ? serviceRows.find((row) => String(row.agentId || "") === String(initAgentId))
          : undefined;
        const selected = preferred || serviceRows[0];
        setServiceId(selected.serviceId);
        setServiceFilter(selected.serviceId);
        setAgentId(initAgentId || selected.agentId || "");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load credential data";
      if (message === WALLET_SESSION_MISSING_MESSAGE) {
        clearAuthSession();
        setServices([]);
        setCredentials([]);
        setLogs([]);
        return;
      }
      throw error;
    }
  }, [initAgentId, serviceId, userAddress]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const filteredCredentials = useMemo(() => {
    if (!serviceFilter) return credentials;
    return credentials.filter((item) => item.serviceId === serviceFilter);
  }, [credentials, serviceFilter]);

  const serviceNameById = useMemo(() => {
    return new Map(services.map((item) => [item.serviceId, item.name || item.serviceId]));
  }, [services]);

  const shortId = useCallback((value: string) => {
    if (!value) return "--";
    if (value.length <= 16) return value;
    return `${value.slice(0, 8)}...${value.slice(-6)}`;
  }, []);

  const todaySpend = useMemo(() => {
    if (!currentAgentInfo?.address) return 0;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startSec = Math.floor(start.getTime() / 1000);
    const currentAddress = currentAgentInfo.address.toLowerCase();

    return billingRows.reduce((sum, row) => {
      const rowTs = Number(row.timestamp || 0);
      const buyer = String(row.buyer || "").toLowerCase();
      if (rowTs < startSec) return sum;
      if (buyer !== currentAddress) return sum;
      return sum + Number(row.unit_price || 0);
    }, 0);
  }, [billingRows, currentAgentInfo?.address]);

  const todayCallCount = useMemo(() => {
    if (!currentAgentInfo?.address) return 0;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startSec = Math.floor(start.getTime() / 1000);
    const currentAddress = currentAgentInfo.address.toLowerCase();

    return billingRows.reduce((count, row) => {
      const rowTs = Number(row.timestamp || 0);
      const buyer = String(row.buyer || "").toLowerCase();
      if (rowTs < startSec) return count;
      if (buyer !== currentAddress) return count;
      return count + 1;
    }, 0);
  }, [billingRows, currentAgentInfo?.address]);

  const effectiveExpiresInSec = useMemo(() => {
    if (expiresAtLocal) {
      const endMs = new Date(expiresAtLocal).getTime();
      if (Number.isFinite(endMs)) {
        const diffSec = Math.floor((endMs - Date.now()) / 1000);
        return Math.max(diffSec, 0);
      }
    }
    return Number.parseInt(expiresInSec, 10) || 0;
  }, [expiresAtLocal, expiresInSec]);

  const effectiveQuotaExpiresAt = useMemo(() => {
    if (quotaExpiresAtLocal) {
      const endMs = new Date(quotaExpiresAtLocal).getTime();
      if (Number.isFinite(endMs)) {
        return Math.floor(endMs / 1000);
      }
    }
    const parsed = Number.parseInt(quotaExpiresAt, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, [quotaExpiresAt, quotaExpiresAtLocal]);

  const handleIssue = async () => {
    if (!userAddress || !agentId || !serviceId) {
      toast.error("Please select agent and service first.");
      return;
    }

    if (effectiveExpiresInSec <= 0) {
      toast.error("请选择未来时间，或输入有效的有效期秒数。");
      return;
    }

    try {
      const created = await issueAgentCredential(userAddress, {
        agentId,
        serviceId,
        expiresInSec: effectiveExpiresInSec,
        maxCalls: Number.parseInt(maxCalls, 10),
        rpm: Number.parseInt(rpm, 10),
      });
      setLatestIssued(created);
      setCredentialForService(created.serviceId, created.token);
      toast.success("Credential issued and set as active for this service.");
      await loadAll();
      setIsCreateModalOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Issue failed");
    }
  };

  const handleRevoke = async (credentialId: string) => {
    if (!userAddress) return;
    try {
      await revokeAgentCredential(userAddress, credentialId);
      toast.success("Credential revoked.");
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Revoke failed");
    }
  };

  const handleQuotaUpdate = async () => {
    if (!userAddress || !selectedCredentialId) {
      toast.error("Pick a credential first.");
      return;
    }

    try {
      await updateAgentCredentialQuota(userAddress, selectedCredentialId, {
        maxCalls: Number.parseInt(quotaMaxCalls, 10),
        rpm: Number.parseInt(quotaRpm, 10),
        expiresAt: effectiveQuotaExpiresAt,
      });
      toast.success("Credential quota updated.");
      await loadAll();
      setIsEditModalOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Quota update failed");
    }
  };

  const openEditQuotaModal = (item: AgentCredentialRecord) => {
    setSelectedCredentialId(item.id);
    setQuotaMaxCalls(String(item.maxCalls));
    setQuotaRpm(String(item.rpm));
    setQuotaExpiresAt(String(item.expiresAt));
    if (item.expiresAt) {
      const date = new Date(Number(item.expiresAt) * 1000);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      const hh = String(date.getHours()).padStart(2, "0");
      const mm = String(date.getMinutes()).padStart(2, "0");
      setQuotaExpiresAtLocal(`${y}-${m}-${d}T${hh}:${mm}`);
    } else {
      setQuotaExpiresAtLocal("");
    }
    setIsEditModalOpen(true);
  };

  return (
    <div className="p-8 mx-auto space-y-6 max-w-7xl">
      <div>
        <div>
          <h1 className="text-3xl font-bold text-white">Agent Credentials & Audit</h1>
          <p className="mt-1 text-gray-400">Issue short-lived credentials, tune quotas, and inspect owner-level audit logs.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 mt-4 md:grid-cols-4">
          <div className="p-4 border border-green-500/30 rounded-xl bg-green-500/5">
            <p className="text-xs tracking-wider text-green-300 uppercase">Agent Name</p>
            <p className="mt-2 text-lg font-semibold text-white">
              {currentAgentInfo?.name || "--"}
            </p>
          </div>
          <div className="p-4 border border-gray-700 rounded-xl bg-black/40">
            <p className="text-xs tracking-wider text-gray-400 uppercase">Agent Address</p>
            <p className="mt-2 font-mono text-sm text-gray-200 break-all">
              {currentAgentInfo?.address || "--"}
            </p>
          </div>
          <div className="p-4 border border-yellow-500/30 rounded-xl bg-yellow-500/5">
            <p className="text-xs tracking-wider text-yellow-300 uppercase">Today Spend (USDC)</p>
            <p className="mt-2 font-mono text-2xl font-bold text-yellow-300">
              {todaySpend.toFixed(4)}
            </p>
          </div>
          <div className="p-4 border border-blue-500/30 rounded-xl bg-blue-500/5">
            <p className="text-xs tracking-wider text-blue-300 uppercase">Today Calls</p>
            <p className="mt-2 font-mono text-2xl font-bold text-blue-300">
              {todayCallCount}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4 border border-gray-800 rounded-xl bg-black/40 md:flex-row md:items-center md:justify-between">
        <div className="w-full md:w-80">
          <p className="mb-1 text-xs tracking-wide text-gray-400 uppercase">Service Filter</p>
          <select
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
          >
            <option value="">All services</option>
            {services.map((item) => (
              <option key={`f-${item.serviceId}`} value={item.serviceId}>{item.name || item.serviceId}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2 text-sm font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400"
        >
          新建凭据
        </button>
      </div>

      {latestIssued && (
        <div className="p-4 border border-green-500/40 rounded-xl bg-green-500/10">
          <p className="text-xs text-green-300 uppercase">Latest issued token (shown once)</p>
          <p className="mt-2 font-mono text-xs text-green-200 break-all">{latestIssued.token}</p>
        </div>
      )}

      <div className="p-4 border border-gray-800 rounded-xl bg-black/40">
        <h2 className="mb-3 text-sm font-bold tracking-widest text-white uppercase">Credentials</h2>
        <div className="space-y-2 max-h-[480px] overflow-auto">
          {filteredCredentials.map((item) => (
            <div key={item.id} className="p-3 border border-gray-800 rounded-lg bg-gray-950/60">
              <div className="flex items-start justify-between gap-3">
                <p className="font-mono text-xs text-gray-300">{item.id}</p>
                <span
                  className={`px-2 py-0.5 text-[10px] font-semibold uppercase rounded border ${
                    item.status === "active"
                      ? "text-green-300 border-green-500/30 bg-green-500/10"
                      : "text-red-300 border-red-500/30 bg-red-500/10"
                  }`}
                >
                  {item.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {serviceNameById.get(item.serviceId) || item.serviceId} · 
                <span className="font-mono" title={item.agentId}>{shortId(item.agentId)}</span>
              </p>
              <p className="mt-1 text-xs text-gray-500">{item.callsUsed}/{item.maxCalls} calls · {item.rpm} rpm</p>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => openEditQuotaModal(item)}
                  className="px-2 py-1 text-xs text-blue-300 border rounded border-blue-500/30 hover:bg-blue-500/20"
                >
                  Edit quota
                </button>
                {item.status === "active" && (
                  <button
                    type="button"
                    onClick={() => void handleRevoke(item.id)}
                    className="px-2 py-1 text-xs text-red-300 border rounded border-red-500/30 hover:bg-red-500/20"
                  >
                    Revoke
                  </button>
                )}
              </div>
            </div>
          ))}
          {filteredCredentials.length === 0 && <p className="text-xs text-gray-500">No credentials.</p>}
        </div>
      </div>

      <div className="p-4 border border-gray-800 rounded-xl bg-black/40">
        <h2 className="mb-3 text-sm font-bold tracking-widest text-white uppercase">Audit Logs</h2>
        <div className="max-h-[320px] overflow-auto space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="p-2 border border-gray-800 rounded bg-gray-950/60">
              <p className="text-xs text-gray-300">{new Date(log.timestamp * 1000).toLocaleString()} · {log.action}</p>
              <p className="mt-1 font-mono text-[10px] text-gray-500 break-all">{JSON.stringify(log.details)}</p>
            </div>
          ))}
          {logs.length === 0 && <p className="text-xs text-gray-500">No audit logs.</p>}
        </div>
      </div>

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="w-full max-w-2xl p-5 space-y-4 border border-gray-700 rounded-2xl bg-[#0f1115] shadow-2xl shadow-green-500/10">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">新建凭据</h3>
                <p className="text-xs text-gray-400">为当前 Agent 签发新的访问凭据</p>
              </div>
              <button type="button" onClick={() => setIsCreateModalOpen(false)} className="text-sm text-gray-400 hover:text-white">关闭</button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block p-3 border border-gray-800 rounded-xl bg-gray-900/40 md:col-span-2">
                <p className="mb-1 text-xs tracking-wide text-gray-300 uppercase">Agent ID</p>
                <input
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  placeholder="目标 Agent ID"
                  className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
                />
                <p className="mt-1 text-[11px] text-gray-500">该凭证签发给哪个 Agent 使用</p>
              </label>

              <label className="block p-3 border border-gray-800 rounded-xl bg-gray-900/40 md:col-span-2">
                <p className="mb-1 text-xs tracking-wide text-gray-300 uppercase">Service</p>
                <select
                  value={serviceId}
                  onChange={(e) => {
                    setServiceId(e.target.value);
                    const found = services.find((item) => item.serviceId === e.target.value);
                    setAgentId(found?.agentId || "");
                  }}
                  className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
                >
                  <option value="">Select service</option>
                  {services.map((item) => (
                    <option key={item.serviceId} value={item.serviceId}>{item.name || item.serviceId}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-gray-500">允许访问的目标服务</p>
              </label>

              <label className="block p-3 border border-gray-800 rounded-xl bg-gray-900/40 md:col-span-2">
                <p className="mb-1 text-xs tracking-wide text-gray-300 uppercase">截止时间</p>
                <input
                  type="datetime-local"
                  value={expiresAtLocal}
                  onChange={(e) => setExpiresAtLocal(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
                />
                <p className="mt-1 text-[11px] text-gray-500">推荐使用时间选择器，避免手动换算</p>
              </label>

              <label className="block p-3 border border-gray-800 rounded-xl bg-gray-900/40 md:col-span-2">
                <p className="mb-1 text-xs tracking-wide text-gray-300 uppercase">有效期秒数（高级）</p>
                <input
                  value={expiresInSec}
                  onChange={(e) => setExpiresInSec(e.target.value)}
                  placeholder="例如 3600"
                  className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
                />
                <p className="mt-1 text-[11px] text-gray-500">不选截止时间时，使用该秒数作为 TTL</p>
              </label>

              <label className="block p-3 border border-gray-800 rounded-xl bg-gray-900/40">
                <p className="mb-1 text-xs tracking-wide text-gray-300 uppercase">总调用上限 (maxCalls)</p>
                <input
                  value={maxCalls}
                  onChange={(e) => setMaxCalls(e.target.value)}
                  placeholder="1000"
                  className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
                />
                <p className="mt-1 text-[11px] text-gray-500">生命周期累计调用上限</p>
              </label>

              <label className="block p-3 border border-gray-800 rounded-xl bg-gray-900/40">
                <p className="mb-1 text-xs tracking-wide text-gray-300 uppercase">每分钟上限 (RPM)</p>
                <input
                  value={rpm}
                  onChange={(e) => setRpm(e.target.value)}
                  placeholder="600"
                  className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
                />
                <p className="mt-1 text-[11px] text-gray-500">每分钟允许请求次数</p>
              </label>
            </div>

            <div className="flex items-center justify-between px-3 py-2 border rounded-lg border-green-500/30 bg-green-500/10">
              <p className="text-xs text-green-200">本次签发最终有效期（TTL）</p>
              <p className="font-mono text-sm text-green-300">{effectiveExpiresInSec}s</p>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-sm text-gray-300 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700">取消</button>
              <button type="button" onClick={handleIssue} className="px-4 py-2 text-sm font-bold text-black bg-green-500 rounded-lg hover:bg-green-400">Issue Credential</button>
            </div>
          </div>
        </div>
      )}

      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="w-full max-w-2xl p-5 space-y-4 border border-gray-700 rounded-2xl bg-[#0f1115] shadow-2xl shadow-yellow-500/10">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">编辑凭据配置</h3>
                <p className="text-xs text-gray-400">调整调用上限、速率限制与过期时间</p>
              </div>
              <button type="button" onClick={() => setIsEditModalOpen(false)} className="text-sm text-gray-400 hover:text-white">关闭</button>
            </div>

            <div className="p-3 border border-gray-800 rounded-xl bg-gray-900/40">
              <p className="mb-1 text-xs tracking-wide text-gray-400 uppercase">Credential ID</p>
              <input
                value={selectedCredentialId}
                readOnly
                className="w-full px-3 py-2 font-mono text-xs text-gray-400 bg-gray-900 border border-gray-700 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block p-3 border border-gray-800 rounded-xl bg-gray-900/40">
                <p className="mb-1 text-xs tracking-wide text-gray-300 uppercase">总调用上限 (maxCalls)</p>
                <input
                  value={quotaMaxCalls}
                  onChange={(e) => setQuotaMaxCalls(e.target.value)}
                  placeholder="1000"
                  className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
                />
                <p className="mt-1 text-[11px] text-gray-500">凭据生命周期内允许的最大调用次数</p>
              </label>

              <label className="block p-3 border border-gray-800 rounded-xl bg-gray-900/40">
                <p className="mb-1 text-xs tracking-wide text-gray-300 uppercase">每分钟上限 (RPM)</p>
                <input
                  value={quotaRpm}
                  onChange={(e) => setQuotaRpm(e.target.value)}
                  placeholder="600"
                  className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
                />
                <p className="mt-1 text-[11px] text-gray-500">每分钟请求次数上限，用于限流保护</p>
              </label>

              <label className="block p-3 border border-gray-800 rounded-xl bg-gray-900/40 md:col-span-2">
                <p className="mb-1 text-xs tracking-wide text-gray-300 uppercase">过期时间</p>
                <input
                  type="datetime-local"
                  value={quotaExpiresAtLocal}
                  onChange={(e) => setQuotaExpiresAtLocal(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
                />
                <p className="mt-1 text-[11px] text-gray-500">推荐使用时间选择器；也可在高级模式填写 Unix 秒时间戳</p>
              </label>

              <label className="block p-3 border border-gray-800 rounded-xl bg-gray-900/40 md:col-span-2">
                <p className="mb-1 text-xs tracking-wide text-gray-300 uppercase">过期时间（Unix 秒，高级）</p>
                <input
                  value={quotaExpiresAt}
                  onChange={(e) => setQuotaExpiresAt(e.target.value)}
                  placeholder="expiresAt (unix sec)"
                  className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
                />
              </label>
            </div>

            <div className="flex items-center justify-between px-3 py-2 border rounded-lg border-yellow-500/30 bg-yellow-500/10">
              <p className="text-xs text-yellow-200">本次更新的最终过期时间（Unix sec）</p>
              <p className="font-mono text-sm text-yellow-300">{effectiveQuotaExpiresAt ?? "--"}</p>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-sm text-gray-300 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700">取消</button>
              <button type="button" onClick={handleQuotaUpdate} className="px-4 py-2 text-sm font-bold text-black bg-yellow-500 rounded-lg hover:bg-yellow-400">Update quota</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CredentialsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400 animate-pulse">Loading Credentials Workspace...</div>}>
      <CredentialsContent />
    </Suspense>
  );
}
