"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

const WALLET_SESSION_MISSING_MESSAGE = "Wallet auth session missing. Please sign in with wallet.";

export default function CredentialsPage() {
  const { address: userAddress } = useAccount();
  const [serviceFilter, setServiceFilter] = useState("");
  const [services, setServices] = useState<Array<{ serviceId: string; agentId?: string; name: string }>>([]);

  const [agentId, setAgentId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [expiresInSec, setExpiresInSec] = useState("3600");
  const [maxCalls, setMaxCalls] = useState("1000");
  const [rpm, setRpm] = useState("600");

  const [credentials, setCredentials] = useState<AgentCredentialRecord[]>([]);
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [latestIssued, setLatestIssued] = useState<AgentCredentialIssueResponse | null>(null);

  const [quotaMaxCalls, setQuotaMaxCalls] = useState("1000");
  const [quotaRpm, setQuotaRpm] = useState("600");
  const [quotaExpiresAt, setQuotaExpiresAt] = useState("");
  const [selectedCredentialId, setSelectedCredentialId] = useState("");

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
        setServiceId(serviceRows[0].serviceId);
        setAgentId(serviceRows[0].agentId || "");
        setServiceFilter(serviceRows[0].serviceId);
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
  }, [serviceId, userAddress]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const filteredCredentials = useMemo(() => {
    if (!serviceFilter) return credentials;
    return credentials.filter((item) => item.serviceId === serviceFilter);
  }, [credentials, serviceFilter]);

  const handleIssue = async () => {
    if (!userAddress || !agentId || !serviceId) {
      toast.error("Please select agent and service first.");
      return;
    }

    try {
      const created = await issueAgentCredential(userAddress, {
        agentId,
        serviceId,
        expiresInSec: Number.parseInt(expiresInSec, 10),
        maxCalls: Number.parseInt(maxCalls, 10),
        rpm: Number.parseInt(rpm, 10),
      });
      setLatestIssued(created);
      setCredentialForService(created.serviceId, created.token);
      toast.success("Credential issued and set as active for this service.");
      await loadAll();
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
        expiresAt: quotaExpiresAt ? Number.parseInt(quotaExpiresAt, 10) : undefined,
      });
      toast.success("Credential quota updated.");
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Quota update failed");
    }
  };

  return (
    <div className="p-8 mx-auto space-y-6 max-w-7xl">
      <div>
        <h1 className="text-3xl font-bold text-white">Agent Credentials & Audit</h1>
        <p className="mt-1 text-gray-400">Issue short-lived credentials, tune quotas, and inspect owner-level audit logs.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 border border-gray-800 rounded-xl bg-black/40 md:grid-cols-4">
        <input
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          placeholder="agentId"
          className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
        />
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
            <option key={item.serviceId} value={item.serviceId}>{item.serviceId} · {item.name}</option>
          ))}
        </select>
        <input
          value={expiresInSec}
          onChange={(e) => setExpiresInSec(e.target.value)}
          placeholder="expiresInSec"
          className="w-full px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
        />
        <div className="flex gap-2">
          <input
            value={maxCalls}
            onChange={(e) => setMaxCalls(e.target.value)}
            placeholder="maxCalls"
            className="w-1/2 px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
          />
          <input
            value={rpm}
            onChange={(e) => setRpm(e.target.value)}
            placeholder="rpm"
            className="w-1/2 px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
          />
        </div>
        <button
          type="button"
          onClick={handleIssue}
          className="px-4 py-2 text-sm font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400 md:col-span-4"
        >
          Issue Credential
        </button>
      </div>

      {latestIssued && (
        <div className="p-4 border border-green-500/40 rounded-xl bg-green-500/10">
          <p className="text-xs text-green-300 uppercase">Latest issued token (shown once)</p>
          <p className="mt-2 font-mono text-xs text-green-200 break-all">{latestIssued.token}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="p-4 border border-gray-800 rounded-xl bg-black/40">
          <h2 className="mb-3 text-sm font-bold tracking-widest text-white uppercase">Credentials</h2>
          <select
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
            className="w-full px-3 py-2 mb-3 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
          >
            <option value="">All services</option>
            {services.map((item) => (
              <option key={`f-${item.serviceId}`} value={item.serviceId}>{item.serviceId}</option>
            ))}
          </select>

          <div className="space-y-2 max-h-[420px] overflow-auto">
            {filteredCredentials.map((item) => (
              <div key={item.id} className="p-3 border border-gray-800 rounded-lg bg-gray-950/60">
                <p className="font-mono text-xs text-gray-300">{item.id}</p>
                <p className="mt-1 text-xs text-gray-400">{item.serviceId} · {item.agentId}</p>
                <p className="mt-1 text-xs text-gray-500">{item.status} · {item.callsUsed}/{item.maxCalls} calls · {item.rpm} rpm</p>
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCredentialId(item.id);
                      setQuotaMaxCalls(String(item.maxCalls));
                      setQuotaRpm(String(item.rpm));
                      setQuotaExpiresAt(String(item.expiresAt));
                    }}
                    className="px-2 py-1 text-xs text-blue-300 border border-blue-500/30 rounded hover:bg-blue-500/20"
                  >
                    Edit quota
                  </button>
                  {item.status === "active" && (
                    <button
                      type="button"
                      onClick={() => void handleRevoke(item.id)}
                      className="px-2 py-1 text-xs text-red-300 border border-red-500/30 rounded hover:bg-red-500/20"
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
          <h2 className="mb-3 text-sm font-bold tracking-widest text-white uppercase">Quota & Audit</h2>
          <div className="grid grid-cols-1 gap-2 mb-4 md:grid-cols-2">
            <input
              value={selectedCredentialId}
              onChange={(e) => setSelectedCredentialId(e.target.value)}
              placeholder="credentialId"
              className="px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg md:col-span-2"
            />
            <input
              value={quotaMaxCalls}
              onChange={(e) => setQuotaMaxCalls(e.target.value)}
              placeholder="maxCalls"
              className="px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
            />
            <input
              value={quotaRpm}
              onChange={(e) => setQuotaRpm(e.target.value)}
              placeholder="rpm"
              className="px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg"
            />
            <input
              value={quotaExpiresAt}
              onChange={(e) => setQuotaExpiresAt(e.target.value)}
              placeholder="expiresAt (unix sec)"
              className="px-3 py-2 text-sm text-white bg-gray-900 border border-gray-700 rounded-lg md:col-span-2"
            />
            <button
              type="button"
              onClick={handleQuotaUpdate}
              className="px-4 py-2 text-sm font-bold text-black transition-colors bg-yellow-500 rounded-lg hover:bg-yellow-400 md:col-span-2"
            >
              Update quota
            </button>
          </div>

          <div className="max-h-[300px] overflow-auto space-y-2">
            {logs.map((log) => (
              <div key={log.id} className="p-2 border border-gray-800 rounded bg-gray-950/60">
                <p className="text-xs text-gray-300">{new Date(log.timestamp * 1000).toLocaleString()} · {log.action}</p>
                <p className="mt-1 font-mono text-[10px] text-gray-500 break-all">{JSON.stringify(log.details)}</p>
              </div>
            ))}
            {logs.length === 0 && <p className="text-xs text-gray-500">No audit logs.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
