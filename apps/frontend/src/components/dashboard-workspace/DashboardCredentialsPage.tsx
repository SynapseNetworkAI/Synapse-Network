"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { Plus, X, Search, Filter, KeyRound, Copy, Check, Clock, Zap, Activity } from "lucide-react";
import { listServiceRegistry } from "@/utils/serviceApi";
import {
  issueAgentCredential,
  listAgentCredentials,
  listAuditLogs,
  revokeAgentCredential,
  updateAgentCredentialQuota,
  type AgentCredentialIssueResponse,
  type AgentCredentialRecord,
} from "@/utils/agentCredentialApi";
import { setCredentialForService } from "@/utils/agentCredentialStore";
import { clearAuthSession } from "@/utils/authSession";
 
 
import { useAuth } from "@/components/WalletAuthGuard";
import AuthMask from "@/components/AuthMask";

const WALLET_SESSION_MISSING_MESSAGE = "Wallet auth session missing. Please sign in with wallet.";

function getDurationLabel(seconds: string): string {
  if (seconds === "0") return "Never";
  if (seconds === "3600") return "1 Hr";
  if (seconds === "86400") return "1 Day";
  return "30 Days";
}

function CredentialsContent() {
  const { address: userAddress } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  const [serviceFilter, setServiceFilter] = useState("");
  const [services, setServices] = useState<Array<{ serviceId: string; name: string; pricing?: string }>>([]);

  const [expiresInSec, setExpiresInSec] = useState("3600");
  const [expiresAtLocal, setExpiresAtLocal] = useState("");
  const [maxCalls, setMaxCalls] = useState("1000");
  const [rpm, setRpm] = useState("600");

  const [credentials, setCredentials] = useState<AgentCredentialRecord[]>([]);
  const [latestIssued, setLatestIssued] = useState<AgentCredentialIssueResponse | null>(null);

  const [quotaMaxCalls, setQuotaMaxCalls] = useState("1000");
  const [quotaRpm, setQuotaRpm] = useState("600");
  const [quotaDailyBudget, setQuotaDailyBudget] = useState("10.00");
  const [quotaExpiresAt, setQuotaExpiresAt] = useState("");
  const [quotaExpiresAtLocal, setQuotaExpiresAtLocal] = useState("");
  const [selectedCredentialId, setSelectedCredentialId] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const billingRows = useMemo<{timestamp?: number; owner?: string; unit_price?: number}[]>(() => [], []);
  const [copiedToken, setCopiedToken] = useState(false);

  const loadAll = useCallback(async () => {
    if (!isSessionAuthenticated || !userAddress) {
      setServices([]);
      setCredentials([]);
      return;
    }

    try {
      const [serviceRows, credentialRows] = await Promise.all([
        listServiceRegistry(userAddress, userAddress),
        listAgentCredentials(userAddress),
        listAuditLogs(userAddress, 200),
      ]);

      setServices(
        serviceRows.map((row) => ({
          serviceId: row.id || row.serviceId,
          name: row.serviceName || row.name,
          pricing: typeof row.pricing === 'string' ? row.pricing : undefined
        }))
      );
      setCredentials(credentialRows);

    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load credential data";
      if (message === WALLET_SESSION_MISSING_MESSAGE) {
        clearAuthSession();
        setServices([]);
        setCredentials([]);
        return;
      }
      throw error;
    }
  }, [userAddress, isSessionAuthenticated]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const filteredCredentials = useMemo(() => {
    if (!serviceFilter) return credentials;
    // Credentials are owner-scoped now and no longer service-bound.
    return credentials;
  }, [credentials, serviceFilter]);


  const shortId = useCallback((value: string) => {
    if (!value) return "--";
    if (value.length <= 16) return value;
    return `${value.slice(0, 8)}...${value.slice(-6)}`;
  }, []);

  const todaySpend = useMemo(() => {
    if (!userAddress) return 0;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startSec = Math.floor(start.getTime() / 1000);
    const currentAddress = userAddress.toLowerCase();

    return billingRows.reduce((sum, row) => {
      const rowTs = Number(row.timestamp || 0);
      const owner = String(row.owner || "").toLowerCase();
      if (rowTs < startSec) return sum;
      if (owner !== currentAddress) return sum;
      return sum + Number(row.unit_price || 0);
    }, 0);
  }, [billingRows, userAddress]);

  const todayCallCount = useMemo(() => {
    if (!userAddress) return 0;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startSec = Math.floor(start.getTime() / 1000);
    const currentAddress = userAddress.toLowerCase();

    return billingRows.reduce((count, row) => {
      const rowTs = Number(row.timestamp || 0);
      const owner = String(row.owner || "").toLowerCase();
      if (rowTs < startSec) return count;
      if (owner !== currentAddress) return count;
      return count + 1;
    }, 0);
  }, [billingRows, userAddress]);

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

  const handleIssue = async () => {
    if (!userAddress) {
      toast.error("Not connected");
      return;
    }
    try {
      if (effectiveExpiresInSec <= 0) {
        toast.error("Duration must be > 0 or a valid future date");
        return;
      }
      const cMax = Number.parseInt(maxCalls, 10) || 0;
      const cRpm = Number.parseInt(rpm, 10) || 0;

      const payload = {
        expiresInSec: effectiveExpiresInSec,
        maxCalls: cMax,
        rpm: cRpm,
      };

      const res = await issueAgentCredential(userAddress, payload);
      setLatestIssued(res);

      setCredentialForService("OWNER_SHARED", res.token);

      toast.success("Credential issued");
      await loadAll();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Failed to issue credential");
    }
  };

  const handleRevoke = async (id: string, currentStatus: string) => {
    if (!userAddress) return;
    if (currentStatus === "revoked") {
      toast.error("Already revoked");
      return;
    }
    if (!confirm("Are you sure you want to revoke this credential? Any API key secret derived from it will stop authenticating immediately.")) return;

    try {
      await revokeAgentCredential(userAddress, id);
      toast.success("Credential revoked");
      await loadAll();
    } catch (e) {
      console.error(e);
      toast.error("Failed to revoke");
    }
  };

  const openEditQuotaModal = (cred: AgentCredentialRecord) => {
    setSelectedCredentialId(cred.id);
    setQuotaMaxCalls(String(cred.maxCalls || 1000));
    setQuotaRpm(String(cred.rpm || 600));
    setQuotaDailyBudget(String(cred.creditLimit ?? 0));

    if (cred.expiresAt) {
      setQuotaExpiresAt(String(cred.expiresAt));
      const localStr = new Date(cred.expiresAt * 1000).toISOString().slice(0, 16);
      setQuotaExpiresAtLocal(localStr);
    } else {
      setQuotaExpiresAt("0");
      setQuotaExpiresAtLocal("");
    }
    setIsEditModalOpen(true);
  };

  const handleUpdateQuota = async () => {
    if (!userAddress || !selectedCredentialId) return;
    try {
      const pMax = Number.parseInt(quotaMaxCalls, 10) || 0;
      const pRpm = Number.parseInt(quotaRpm, 10) || 0;
      const pCreditLimit = Number.parseFloat(quotaDailyBudget);

      let pExp = Number.parseInt(quotaExpiresAt, 10) || 0;
      if (quotaExpiresAtLocal) {
        const ms = new Date(quotaExpiresAtLocal).getTime();
        if (Number.isFinite(ms)) {
          pExp = Math.floor(ms / 1000);
        }
      }

      await updateAgentCredentialQuota(userAddress, selectedCredentialId, {
        maxCalls: pMax,
        rpm: pRpm,
        creditLimit: Number.isFinite(pCreditLimit) && pCreditLimit > 0 ? pCreditLimit : undefined,
        expiresAt: pExp,
      });

      toast.success("API Key quota updated");
      setIsEditModalOpen(false);
      await loadAll();
    } catch (e) {
      console.error(e);
      toast.error("Failed to update API Key");
    }
  };

  const activeCredentialsCount = credentials.filter(c => c.status === "active").length;

  return (
    <div className="flex flex-col flex-1 h-full min-h-screen text-gray-200">
      <header className="x-divider flex-none border-b px-6 py-8 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white mb-1.5 flex items-center gap-2">
              <KeyRound className="w-6 h-6 text-green-400" />
              Agent Credentials
            </h1>
            <p className="text-sm text-gray-400 max-w-2xl">
              Issue runtime credentials for autonomous agents. Each credential is delivered once as a secret API key and stays inside owner-scoped spending controls.
            </p>
          </div>
          <div className="flex items-center gap-3">
             <button
              onClick={() => setIsCreateModalOpen(true)}
              className="x-button-primary inline-flex items-center rounded-full px-4 py-2.5 text-sm font-bold"
            >
              <Plus className="w-4 h-4 mr-2" />
              Issue Credential
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-6 lg:px-8 space-y-6">
        <AuthMask>
        <div className="space-y-6">
        {/* Wallet Overview Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
           <div className="x-tile-flat x-tile-flat-hover flex items-center gap-4 rounded-xl p-5">
             <div className="x-panel-muted rounded-lg p-3">
                <KeyRound className="w-6 h-6 text-gray-400" />
             </div>
             <div>
               <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Active Credentials</p>
                <p className="text-2xl font-mono text-white">{activeCredentialsCount}</p>
             </div>
          </div>
          
           <div className="x-tile-flat x-tile-flat-hover flex items-center gap-4 rounded-xl p-5">
             <div className="rounded-lg bg-indigo-900/30 p-3 shadow-[inset_0_0_0_1px_rgba(129,140,248,0.12)]">
                <Activity className="w-6 h-6 text-indigo-400" />
             </div>
             <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Today Calls</p>
                <p className="text-2xl font-mono text-indigo-400">{todayCallCount}</p>
             </div>
          </div>

           <div className="x-tile-flat x-tile-flat-hover flex items-center gap-4 rounded-xl p-5">
             <div className="rounded-lg bg-yellow-900/30 p-3 shadow-[inset_0_0_0_1px_rgba(250,204,21,0.12)]">
                <Zap className="w-6 h-6 text-yellow-400" />
             </div>
             <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Today Spend (USDC)</p>
                <p className="text-2xl font-mono text-yellow-400">{todaySpend.toFixed(3)}</p>
             </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
             <Search className="absolute w-4 h-4 text-gray-500 -translate-y-1/2 left-3 top-1/2" />
             <input
              type="text"
              placeholder="Search credential ID..."
              className="x-input-flat w-full rounded-lg py-2 pl-9 pr-4 text-sm text-white"
             />
          </div>
           <div className="x-panel-muted flex items-center gap-2 rounded-lg px-3 py-1.5">
             <Filter className="w-3.5 h-3.5 text-gray-500" />
             <select
               value={serviceFilter}
               onChange={(e) => setServiceFilter(e.target.value)}
               className="x-select-flat cursor-pointer appearance-none bg-transparent pr-4 text-sm text-gray-300"
             >
               <option value="">All Services (Universal)</option>
               {services.map((srv) => (
                 <option key={srv.serviceId} value={srv.serviceId}>
                   {srv.name} (Dedicated)
                 </option>
               ))}
             </select>
          </div>
        </div>

        {/* Credentials Table */}
        <div className="x-panel-flat overflow-hidden rounded-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="x-divider border-b bg-black/20 text-xs uppercase text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">Credential Prefix</th>
                  <th className="px-4 py-3 font-semibold">Scope</th>
                  <th className="px-4 py-3 font-semibold">Calls (Used / Max)</th>
                  <th className="px-4 py-3 font-semibold">Rate Limit</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Expires</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {filteredCredentials.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      No credentials found. Click &quot;Issue Credential&quot; to create one.
                    </td>
                  </tr>
                ) : (
                  filteredCredentials.map((cred) => (
                    <tr key={cred.id} className="transition-colors hover:bg-gray-800/30">
                      <td className="px-4 py-3 font-mono text-gray-300">
                        {cred.tokenPrefix || shortId(cred.id)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-400">Universal Key</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-indigo-400">{cred.callsUsed}</span>{" "}
                        <span className="text-gray-600">/</span>{" "}
                        <span className="font-mono text-gray-300">{cred.maxCalls || "∞"}</span>
                        {cred.maxCalls > 0 && cred.callsUsed >= cred.maxCalls && (
                          <span className="ml-2 text-xs text-red-400">(Depleted)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-400 font-mono">
                        {cred.rpm > 0 ? `${cred.rpm}/min` : "No Limit"}
                      </td>
                      <td className="px-4 py-3">
                         <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
                           cred.status === "active" 
                             ? "bg-green-500/10 text-green-400" 
                             : "bg-red-500/10 text-red-400"
                         }`}>
                           {cred.status.toUpperCase()}
                         </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {cred.expiresAt ? (
                          <span className={cred.expiresAt * 1000 < Date.now() ? "text-red-400" : ""}>
                            {new Date(cred.expiresAt * 1000).toLocaleString()}
                          </span>
                        ) : (
                          "Never"
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                           <button
                             onClick={() => openEditQuotaModal(cred)}
                             className="text-xs font-medium text-blue-400 hover:text-blue-300 transition hover:underline"
                             disabled={cred.status === "revoked"}
                           >
                             Adjust Quota
                           </button>
                           {cred.status === "active" && (
                             <button
                               onClick={() => handleRevoke(cred.id, cred.status)}
                               className="text-xs font-medium text-red-500/80 hover:text-red-400 transition hover:underline"
                             >
                               Revoke
                             </button>
                           )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        </div>
        </AuthMask>
      </main>

      {/* Creation Modal */}
      {isCreateModalOpen && (
        <div className="x-dialog-shell x-modal-overlay">
          <div className="x-modal-flat x-modal-surface max-w-lg shadow-2xl">
             <div className="x-modal-header mb-0">
                <h3 className="text-xl flex items-center gap-2 font-bold text-white">
                  <KeyRound className="w-5 h-5 text-green-400" /> Issue Credential
                </h3>
                <button onClick={() => { setIsCreateModalOpen(false); setLatestIssued(null); }} className="x-modal-close">
                  <X className="w-5 h-5" />
                </button>
             </div>

             {latestIssued === null ? (
               <div className="x-modal-body space-y-5">
                  <div className="x-panel-muted space-y-4 rounded-lg p-4">
                    <div className="grid grid-cols-2 gap-4">
                       <div>
                         <label htmlFor="create-max-calls" className="block mb-1.5 text-xs font-bold text-gray-500 uppercase">Max Calls</label>
                         <input id="create-max-calls" type="number" value={maxCalls} onChange={e => setMaxCalls(e.target.value)} className="x-input-flat w-full rounded-lg px-3 py-2 text-sm font-mono text-white" placeholder="1000"/>
                       </div>
                       <div>
                         <label htmlFor="create-rpm" className="block mb-1.5 text-xs font-bold text-gray-500 uppercase">Rate Limit (RPM)</label>
                         <input id="create-rpm" type="number" value={rpm} onChange={e => setRpm(e.target.value)} className="x-input-flat w-full rounded-lg px-3 py-2 text-sm font-mono text-white" placeholder="600"/>
                       </div>
                    </div>
                    <div>
                       <label htmlFor="create-duration-preset" className="block mb-1.5 text-xs font-bold text-gray-500 uppercase">Duration (Seconds)</label>
                       <div id="create-duration-preset" className="flex gap-2">
                         {["3600", "86400", "2592000", "0"].map(sec => (
                           <button
                             key={sec}
                             onClick={() => { setExpiresInSec(sec); setExpiresAtLocal(""); }}
                             className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${expiresInSec === sec && !expiresAtLocal ? "bg-green-500/10 text-green-400 shadow-[inset_0_0_0_1px_rgba(34,197,94,0.24)]" : "x-button-ghost text-gray-400"}`}
                           >
                             {getDurationLabel(sec)}
                           </button>
                         ))}
                       </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 mt-8">
                     <button onClick={() => setIsCreateModalOpen(false)} className="x-button-ghost x-modal-action x-modal-action-secondary text-sm font-medium">Cancel</button>
                    <button onClick={handleIssue} className="x-button-primary x-modal-action x-modal-action-primary text-sm font-bold">Issue Credential</button>
                  </div>
               </div>
             ) : (
               <div className="x-modal-body space-y-6">
                 <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-center">
                   <Check className="w-8 h-8 text-green-400 mx-auto mb-2" />
                   <h4 className="text-green-400 font-bold mb-1">Credential Issued</h4>
                   <p className="text-xs text-gray-300">Copy the secret API key now. It will not be shown again.</p>
                 </div>
                 
                 <div>
                   <label htmlFor="issued-secret-token" className="block mb-2 text-xs font-bold text-gray-500 uppercase">Secret API Key</label>
                   <div className="flex items-center gap-2">
                     <input id="issued-secret-token" readOnly value={latestIssued.token} className="x-input-flat w-full rounded-lg px-3 py-2.5 text-sm font-mono text-gray-300 outline-none selection:bg-gray-800" />
                      <button 
                        onClick={() => { 
                          navigator.clipboard.writeText(latestIssued.token);
                          setCopiedToken(true);
                          setTimeout(() => setCopiedToken(false), 2000);
                        }} 
                        className="x-icon-button rounded-lg p-2.5 text-gray-300"
                      >
                         {copiedToken ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                   </div>
                 </div>

                  <button onClick={() => { setIsCreateModalOpen(false); setLatestIssued(null); }} className="x-button-ghost w-full rounded-full py-2.5 text-sm font-medium">
                    Done
                 </button>
               </div>
             )}
          </div>
        </div>
      )}

      {/* Edit Quota Modal */}
      {isEditModalOpen && (
        <div className="x-dialog-shell x-modal-overlay">
          <div className="x-modal-flat x-modal-surface max-w-sm shadow-2xl">
             <div className="x-modal-header mb-0">
               <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-400" /> Override Quota
               </h3>
               <button onClick={() => setIsEditModalOpen(false)} className="x-modal-close">
                 <X className="w-5 h-5" />
               </button>
             </div>
             
             <div className="x-modal-body space-y-4">
                <div>
                  <label htmlFor="quota-max-calls" className="block mb-1.5 text-xs font-bold text-gray-500 uppercase">Max Calls (-1 for infinite)</label>
                  <input id="quota-max-calls" type="number" value={quotaMaxCalls} onChange={e => setQuotaMaxCalls(e.target.value)} className="x-input-flat w-full rounded-lg px-3 py-2 text-sm font-mono text-white"/>
                </div>
                <div>
                  <label htmlFor="quota-rpm" className="block mb-1.5 text-xs font-bold text-gray-500 uppercase">Rate Limit (RPM)</label>
                  <input id="quota-rpm" type="number" value={quotaRpm} onChange={e => setQuotaRpm(e.target.value)} className="x-input-flat w-full rounded-lg px-3 py-2 text-sm font-mono text-white"/>
                </div>
                <div>
                  <label htmlFor="quota-daily-budget" className="block mb-1.5 text-xs font-bold text-gray-500 uppercase">Daily Budget (USDC)</label>
                  <input id="quota-daily-budget" type="number" step="0.01" min="0.01" value={quotaDailyBudget} onChange={e => setQuotaDailyBudget(e.target.value)} className="x-input-flat w-full rounded-lg px-3 py-2 text-sm font-mono text-white"/>
                </div>
                <div>
                  <label htmlFor="quota-expiration-local" className="block mb-1.5 text-xs font-bold text-gray-500 uppercase">Expiration (Local Time)</label>
                  <input id="quota-expiration-local" type="datetime-local" value={quotaExpiresAtLocal} onChange={e => setQuotaExpiresAtLocal(e.target.value)} className="x-input-flat w-full rounded-lg px-3 py-2 text-sm text-white"/>
                  <span className="text-[10px] text-gray-600 mt-1 block">Leave empty or clear to use raw timestamp.</span>
                </div>
             </div>

             <div className="flex justify-end gap-3 mt-6">
           <button onClick={() => setIsEditModalOpen(false)} className="x-button-ghost x-modal-action x-modal-action-secondary text-sm font-medium">Cancel</button>
           <button onClick={handleUpdateQuota} className="x-button-primary x-modal-action x-modal-action-primary text-sm font-bold">Save</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CredentialsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-500">Loading UI...</div>}>
      <CredentialsContent />
    </Suspense>
  );
}