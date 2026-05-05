"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import {
  Plus,
  X,
  Search,
  Filter,
  KeyRound,
  Copy,
  Check,
  Clock,
  Zap,
  Activity,
} from "lucide-react";
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
import XSelect from "@/components/xui/XSelect";

import { useAuth } from "@/components/WalletAuthGuard";
import AuthMask from "@/components/AuthMask";
import { useLanguage } from "@/components/i18n/LanguageProvider";

const WALLET_SESSION_MISSING_MESSAGE =
  "Wallet auth session missing. Please sign in with wallet.";

function getDurationLabel(seconds: string, t: (key: string) => string): string {
  if (seconds === "0") return t("agentCredentialsPage.never");
  if (seconds === "3600") return t("agentCredentialsPage.durationOneHour");
  if (seconds === "86400") return t("agentCredentialsPage.durationOneDay");
  return t("agentCredentialsPage.durationThirtyDays");
}

function CredentialsContent() {
  const { t } = useLanguage();
  const { address: userAddress } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  const [serviceFilter, setServiceFilter] = useState("");
  const [services, setServices] = useState<
    Array<{ serviceId: string; name: string; pricing?: string }>
  >([]);

  const [expiresInSec, setExpiresInSec] = useState("3600");
  const [expiresAtLocal, setExpiresAtLocal] = useState("");
  const [maxCalls, setMaxCalls] = useState("1000");
  const [rpm, setRpm] = useState("600");

  const [credentials, setCredentials] = useState<AgentCredentialRecord[]>([]);
  const [latestIssued, setLatestIssued] =
    useState<AgentCredentialIssueResponse | null>(null);

  const [quotaMaxCalls, setQuotaMaxCalls] = useState("1000");
  const [quotaRpm, setQuotaRpm] = useState("600");
  const [quotaDailyBudget, setQuotaDailyBudget] = useState("10.00");
  const [quotaExpiresAt, setQuotaExpiresAt] = useState("");
  const [quotaExpiresAtLocal, setQuotaExpiresAtLocal] = useState("");
  const [selectedCredentialId, setSelectedCredentialId] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [revokeCandidate, setRevokeCandidate] = useState<{
    id: string;
    status: string;
  } | null>(null);
  const billingRows = useMemo<
    { timestamp?: number; owner?: string; unit_price?: number }[]
  >(() => [], []);
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
          pricing: typeof row.pricing === "string" ? row.pricing : undefined,
        }))
      );
      setCredentials(credentialRows);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === WALLET_SESSION_MISSING_MESSAGE
      ) {
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
      toast.error(t("agentCredentialsPage.notConnected"));
      return;
    }
    try {
      if (effectiveExpiresInSec <= 0) {
        toast.error(t("agentCredentialsPage.invalidDuration"));
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

      toast.success(t("agentCredentialsPage.credentialIssued"));
      await loadAll();
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : t("agentCredentialsPage.issueFailed")
      );
    }
  };

  const handleRevoke = async (id: string, currentStatus: string) => {
    if (!userAddress) return;
    if (currentStatus === "revoked") {
      toast.error(t("agentCredentialsPage.alreadyRevoked"));
      return;
    }
    setRevokeCandidate({ id, status: currentStatus });
  };

  const confirmRevoke = async () => {
    if (!userAddress || !revokeCandidate) return;
    try {
      await revokeAgentCredential(userAddress, revokeCandidate.id);
      toast.success(t("agentCredentialsPage.credentialRevoked"));
      setRevokeCandidate(null);
      await loadAll();
    } catch (e) {
      console.error(e);
      toast.error(t("agentCredentialsPage.revokeFailed"));
    }
  };

  const openEditQuotaModal = (cred: AgentCredentialRecord) => {
    setSelectedCredentialId(cred.id);
    setQuotaMaxCalls(String(cred.maxCalls || 1000));
    setQuotaRpm(String(cred.rpm || 600));
    setQuotaDailyBudget(String(cred.creditLimit ?? 0));

    if (cred.expiresAt) {
      setQuotaExpiresAt(String(cred.expiresAt));
      const localStr = new Date(cred.expiresAt * 1000)
        .toISOString()
        .slice(0, 16);
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
        creditLimit:
          Number.isFinite(pCreditLimit) && pCreditLimit > 0
            ? pCreditLimit
            : undefined,
        expiresAt: pExp,
      });

      toast.success(t("agentCredentialsPage.quotaUpdated"));
      setIsEditModalOpen(false);
      await loadAll();
    } catch (e) {
      console.error(e);
      toast.error(t("agentCredentialsPage.quotaUpdateFailed"));
    }
  };

  const activeCredentialsCount = credentials.filter(
    (c) => c.status === "active"
  ).length;

  return (
    <div className="flex flex-col flex-1 h-full min-h-screen text-gray-200">
      <header className="x-divider flex-none border-b px-6 py-8 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white mb-1.5 flex items-center gap-2">
              <KeyRound className="w-6 h-6 text-green-400" />
              {t("agentCredentialsPage.title")}
            </h1>
            <p className="text-sm text-gray-400 max-w-2xl">
              {t("agentCredentialsPage.description")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="x-button-primary inline-flex items-center rounded-full px-4 py-2.5 text-sm font-bold"
            >
              <Plus className="w-4 h-4 mr-2" />
              {t("agentCredentialsPage.issueCredential")}
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
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    {t("agentCredentialsPage.activeCredentials")}
                  </p>
                  <p className="text-2xl font-mono text-white">
                    {activeCredentialsCount}
                  </p>
                </div>
              </div>

              <div className="x-tile-flat x-tile-flat-hover flex items-center gap-4 rounded-xl p-5">
                <div className="rounded-lg bg-indigo-900/30 p-3 shadow-[inset_0_0_0_1px_rgba(129,140,248,0.12)]">
                  <Activity className="w-6 h-6 text-indigo-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    {t("agentCredentialsPage.todayCalls")}
                  </p>
                  <p className="text-2xl font-mono text-indigo-400">
                    {todayCallCount}
                  </p>
                </div>
              </div>

              <div className="x-tile-flat x-tile-flat-hover flex items-center gap-4 rounded-xl p-5">
                <div className="rounded-lg bg-yellow-900/30 p-3 shadow-[inset_0_0_0_1px_rgba(250,204,21,0.12)]">
                  <Zap className="w-6 h-6 text-yellow-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    {t("agentCredentialsPage.todaySpend")}
                  </p>
                  <p className="text-2xl font-mono text-yellow-400">
                    {todaySpend.toFixed(3)}
                  </p>
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute w-4 h-4 text-gray-500 -translate-y-1/2 left-3 top-1/2" />
                <input
                  type="text"
                  placeholder={t("agentCredentialsPage.searchPlaceholder")}
                  className="x-input-flat w-full rounded-lg py-2 pl-9 pr-4 text-sm text-white"
                />
              </div>
              <div className="x-panel-muted flex items-center gap-2 rounded-lg px-3 py-1.5">
                <Filter className="w-3.5 h-3.5 text-gray-500" />
                <XSelect
                  value={serviceFilter}
                  onChange={(next) => setServiceFilter(next)}
                  options={[
                    {
                      value: "",
                      label: t("agentCredentialsPage.allServicesUniversal"),
                    },
                    ...services.map((srv) => ({
                      value: srv.serviceId,
                      label: t("agentCredentialsPage.dedicatedServiceLabel", {
                        name: srv.name,
                      }),
                    })),
                  ]}
                  triggerClassName="inline-flex min-h-8 items-center justify-between gap-2 bg-transparent pr-1 text-sm text-gray-300"
                />
              </div>
            </div>

            {/* Credentials Table */}
            <div className="x-panel-flat overflow-hidden rounded-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="x-divider border-b bg-black/20 text-xs uppercase text-gray-400">
                    <tr>
                      <th className="px-4 py-3 font-semibold">
                        {t("agentCredentialsPage.tableCredentialPrefix")}
                      </th>
                      <th className="px-4 py-3 font-semibold">
                        {t("agentCredentialsPage.tableScope")}
                      </th>
                      <th className="px-4 py-3 font-semibold">
                        {t("agentCredentialsPage.tableCalls")}
                      </th>
                      <th className="px-4 py-3 font-semibold">
                        {t("agentCredentialsPage.tableRateLimit")}
                      </th>
                      <th className="px-4 py-3 font-semibold">
                        {t("agentCredentialsPage.tableStatus")}
                      </th>
                      <th className="px-4 py-3 font-semibold">
                        {t("agentCredentialsPage.tableExpires")}
                      </th>
                      <th className="px-4 py-3 font-semibold text-right">
                        {t("agentCredentialsPage.tableActions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {filteredCredentials.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-8 text-center text-gray-500"
                        >
                          {t("agentCredentialsPage.empty")}
                        </td>
                      </tr>
                    ) : (
                      filteredCredentials.map((cred) => (
                        <tr
                          key={cred.id}
                          className="transition-colors hover:bg-gray-800/30"
                        >
                          <td className="px-4 py-3 font-mono text-gray-300">
                            {cred.tokenPrefix || shortId(cred.id)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-gray-400">
                              {t("agentCredentialsPage.universalKey")}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-indigo-400">
                              {cred.callsUsed}
                            </span>{" "}
                            <span className="text-gray-600">/</span>{" "}
                            <span className="font-mono text-gray-300">
                              {cred.maxCalls || "∞"}
                            </span>
                            {cred.maxCalls > 0 &&
                              cred.callsUsed >= cred.maxCalls && (
                                <span className="ml-2 text-xs text-red-400">
                                  ({t("agentCredentialsPage.depleted")})
                                </span>
                              )}
                          </td>
                          <td className="px-4 py-3 text-gray-400 font-mono">
                            {cred.rpm > 0
                              ? `${cred.rpm}/min`
                              : t("agentCredentialsPage.noLimit")}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
                                cred.status === "active"
                                  ? "bg-green-500/10 text-green-400"
                                  : "bg-red-500/10 text-red-400"
                              }`}
                            >
                              {cred.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400">
                            {cred.expiresAt ? (
                              <span
                                className={
                                  cred.expiresAt * 1000 < Date.now()
                                    ? "text-red-400"
                                    : ""
                                }
                              >
                                {new Date(
                                  cred.expiresAt * 1000
                                ).toLocaleString()}
                              </span>
                            ) : (
                              t("agentCredentialsPage.never")
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => openEditQuotaModal(cred)}
                                className="text-xs font-medium text-blue-400 hover:text-blue-300 transition hover:underline"
                                disabled={cred.status === "revoked"}
                              >
                                {t("agentCredentialsPage.adjustQuota")}
                              </button>
                              {cred.status === "active" && (
                                <button
                                  onClick={() =>
                                    handleRevoke(cred.id, cred.status)
                                  }
                                  className="text-xs font-medium text-red-500/80 hover:text-red-400 transition hover:underline"
                                >
                                  {t("agentCredentialsPage.revoke")}
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
                <KeyRound className="w-5 h-5 text-green-400" />{" "}
                {t("agentCredentialsPage.issueCredential")}
              </h3>
              <button
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setLatestIssued(null);
                }}
                className="x-modal-close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {latestIssued === null ? (
              <div className="x-modal-body space-y-5">
                <div className="x-panel-muted space-y-4 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="create-max-calls"
                        className="block mb-1.5 text-xs font-bold text-gray-500 uppercase"
                      >
                        {t("agentCredentialsPage.maxCalls")}
                      </label>
                      <input
                        id="create-max-calls"
                        type="number"
                        value={maxCalls}
                        onChange={(e) => setMaxCalls(e.target.value)}
                        className="x-input-flat w-full rounded-lg px-3 py-2 text-sm font-mono text-white"
                        placeholder="1000"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="create-rpm"
                        className="block mb-1.5 text-xs font-bold text-gray-500 uppercase"
                      >
                        {t("agentCredentialsPage.rateLimitRpm")}
                      </label>
                      <input
                        id="create-rpm"
                        type="number"
                        value={rpm}
                        onChange={(e) => setRpm(e.target.value)}
                        className="x-input-flat w-full rounded-lg px-3 py-2 text-sm font-mono text-white"
                        placeholder="600"
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="create-duration-preset"
                      className="block mb-1.5 text-xs font-bold text-gray-500 uppercase"
                    >
                      {t("agentCredentialsPage.durationSeconds")}
                    </label>
                    <div id="create-duration-preset" className="flex gap-2">
                      {["3600", "86400", "2592000", "0"].map((sec) => (
                        <button
                          key={sec}
                          onClick={() => {
                            setExpiresInSec(sec);
                            setExpiresAtLocal("");
                          }}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                            expiresInSec === sec && !expiresAtLocal
                              ? "bg-green-500/10 text-green-400 shadow-[inset_0_0_0_1px_rgba(34,197,94,0.24)]"
                              : "x-button-ghost text-gray-400"
                          }`}
                        >
                          {getDurationLabel(sec, t)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-8">
                  <button
                    onClick={() => setIsCreateModalOpen(false)}
                    className="x-button-ghost x-modal-action x-modal-action-secondary text-sm font-medium"
                  >
                    {t("agentCredentialsPage.cancel")}
                  </button>
                  <button
                    onClick={handleIssue}
                    className="x-button-primary x-modal-action x-modal-action-primary text-sm font-bold"
                  >
                    {t("agentCredentialsPage.issueCredential")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="x-modal-body space-y-6">
                <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-center">
                  <Check className="w-8 h-8 text-green-400 mx-auto mb-2" />
                  <h4 className="text-green-400 font-bold mb-1">
                    {t("agentCredentialsPage.credentialIssuedTitle")}
                  </h4>
                  <p className="text-xs text-gray-300">
                    {t("agentCredentialsPage.credentialIssuedDescription")}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="issued-secret-token"
                    className="block mb-2 text-xs font-bold text-gray-500 uppercase"
                  >
                    {t("agentCredentialsPage.secretApiKey")}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="issued-secret-token"
                      readOnly
                      value={latestIssued.token}
                      className="x-input-flat w-full rounded-lg px-3 py-2.5 text-sm font-mono text-gray-300 outline-none selection:bg-gray-800"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(latestIssued.token);
                        setCopiedToken(true);
                        setTimeout(() => setCopiedToken(false), 2000);
                      }}
                      className="x-icon-button rounded-lg p-2.5 text-gray-300"
                      aria-label={t("agentCredentialsPage.copySecretApiKey")}
                    >
                      {copiedToken ? (
                        <Check className="w-4 h-4 text-green-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setIsCreateModalOpen(false);
                    setLatestIssued(null);
                  }}
                  className="x-button-ghost w-full rounded-full py-2.5 text-sm font-medium"
                >
                  {t("agentCredentialsPage.done")}
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
                <Clock className="w-5 h-5 text-blue-400" />{" "}
                {t("agentCredentialsPage.overrideQuota")}
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="x-modal-close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="x-modal-body space-y-4">
              <div>
                <label
                  htmlFor="quota-max-calls"
                  className="block mb-1.5 text-xs font-bold text-gray-500 uppercase"
                >
                  {t("agentCredentialsPage.maxCallsInfiniteHint")}
                </label>
                <input
                  id="quota-max-calls"
                  type="number"
                  value={quotaMaxCalls}
                  onChange={(e) => setQuotaMaxCalls(e.target.value)}
                  className="x-input-flat w-full rounded-lg px-3 py-2 text-sm font-mono text-white"
                />
              </div>
              <div>
                <label
                  htmlFor="quota-rpm"
                  className="block mb-1.5 text-xs font-bold text-gray-500 uppercase"
                >
                  {t("agentCredentialsPage.rateLimitRpm")}
                </label>
                <input
                  id="quota-rpm"
                  type="number"
                  value={quotaRpm}
                  onChange={(e) => setQuotaRpm(e.target.value)}
                  className="x-input-flat w-full rounded-lg px-3 py-2 text-sm font-mono text-white"
                />
              </div>
              <div>
                <label
                  htmlFor="quota-daily-budget"
                  className="block mb-1.5 text-xs font-bold text-gray-500 uppercase"
                >
                  {t("agentCredentialsPage.dailyBudgetUsdc")}
                </label>
                <input
                  id="quota-daily-budget"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={quotaDailyBudget}
                  onChange={(e) => setQuotaDailyBudget(e.target.value)}
                  className="x-input-flat w-full rounded-lg px-3 py-2 text-sm font-mono text-white"
                />
              </div>
              <div>
                <label
                  htmlFor="quota-expiration-local"
                  className="block mb-1.5 text-xs font-bold text-gray-500 uppercase"
                >
                  {t("agentCredentialsPage.expirationLocalTime")}
                </label>
                <input
                  id="quota-expiration-local"
                  type="datetime-local"
                  value={quotaExpiresAtLocal}
                  onChange={(e) => setQuotaExpiresAtLocal(e.target.value)}
                  className="x-input-flat w-full rounded-lg px-3 py-2 text-sm text-white"
                />
                <span className="text-[10px] text-gray-600 mt-1 block">
                  {t("agentCredentialsPage.expirationLocalTimeHint")}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="x-button-ghost x-modal-action x-modal-action-secondary text-sm font-medium"
              >
                {t("agentCredentialsPage.cancel")}
              </button>
              <button
                onClick={handleUpdateQuota}
                className="x-button-primary x-modal-action x-modal-action-primary text-sm font-bold"
              >
                {t("agentCredentialsPage.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {revokeCandidate && (
        <div className="x-dialog-shell x-modal-overlay">
          <div className="x-modal-flat x-modal-surface max-w-sm shadow-2xl">
            <div className="x-modal-header mb-0">
              <h3 className="text-lg font-bold text-white">
                {t("agentCredentialsPage.revokeConfirmTitle")}
              </h3>
              <button
                onClick={() => setRevokeCandidate(null)}
                className="x-modal-close"
                type="button"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="x-modal-body">
              <p className="text-sm leading-6 text-gray-300">
                {t("agentCredentialsPage.revokeConfirmDescription")}
              </p>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setRevokeCandidate(null)}
                className="x-button-ghost x-modal-action x-modal-action-secondary text-sm font-medium"
              >
                {t("agentCredentialsPage.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  void confirmRevoke();
                }}
                className="x-button-danger x-modal-action text-sm font-bold"
              >
                {t("agentCredentialsPage.revokeConfirmAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CredentialsPage() {
  const { t } = useLanguage();
  return (
    <Suspense
      fallback={
        <div className="p-8 text-gray-500">
          {t("agentCredentialsPage.loadingUi")}
        </div>
      }
    >
      <CredentialsContent />
    </Suspense>
  );
}
