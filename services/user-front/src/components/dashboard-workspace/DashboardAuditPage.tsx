"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/components/WalletAuthGuard";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { buildAuthedHeaders } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";
import {
  ActiveAlertsPanel,
  AuditPageHeader,
  AuditTrailPanel,
  RiskOverviewCards,
  toRelativeTime,
  type AuditTrailRecord,
  type RiskOverview,
} from "./DashboardAuditPage.sections";
import {
  extractAuditAmount,
  type FinanceAuditLogAmountSource,
} from "./DashboardAuditPage.amount";

type FinanceAuditLog = FinanceAuditLogAmountSource & {
  id: string;
  timestamp: number;
  action: string;
  domain: string;
  ownerAddress: string;
};

const ACTION_I18N_MAP: Record<string, string> = {
  CONSUMER_DEPOSIT_CONFIRMED: "auditPage.actionDepositConfirmed",
  CONSUMER_DEPOSIT_CONFIRMED_REPAIRED: "auditPage.actionDepositRepaired",
  CONSUMER_WITHDRAW_INTENT_CREATED: "auditPage.actionWithdrawRequested",
  REFUND_INTENT_COMPLETED: "auditPage.actionWithdrawCompleted",
  PROVIDER_WITHDRAW_INTENT_CREATED: "auditPage.actionProviderWithdrawRequested",
  PROVIDER_WITHDRAW_REVIEW_APPROVED: "auditPage.actionProviderWithdrawApproved",
  PROVIDER_WITHDRAW_REVIEW_REJECTED: "auditPage.actionProviderWithdrawRejected",
  PROVIDER_WITHDRAW_COMPLETED: "auditPage.actionProviderWithdrawCompleted",
  PROVIDER_WITHDRAW_CANCELLED: "auditPage.actionProviderWithdrawCancelled",
};

const ACTION_STATUS_MAP: Record<string, string> = {
  CONSUMER_DEPOSIT_CONFIRMED: "auditPage.statusCompleted",
  CONSUMER_DEPOSIT_CONFIRMED_REPAIRED: "auditPage.statusCompleted",
  CONSUMER_WITHDRAW_INTENT_CREATED: "auditPage.statusPending",
  REFUND_INTENT_COMPLETED: "auditPage.statusCompleted",
  PROVIDER_WITHDRAW_INTENT_CREATED: "auditPage.statusPending",
  PROVIDER_WITHDRAW_REVIEW_APPROVED: "auditPage.statusApproved",
  PROVIDER_WITHDRAW_REVIEW_REJECTED: "auditPage.statusRejected",
  PROVIDER_WITHDRAW_COMPLETED: "auditPage.statusCompleted",
  PROVIDER_WITHDRAW_CANCELLED: "auditPage.statusCancelled",
};

const DEFAULT_OVERVIEW: RiskOverview = {
  systemIntegrity: { level: "green", anomalyCount24h: 0 },
  pendingReviews: { level: "green", count: 0 },
  alerts: [],
};

function mapAuditLog(log: FinanceAuditLog): AuditTrailRecord {
  return {
    id: log.id,
    actionKey: ACTION_I18N_MAP[log.action] || "",
    rawAction: log.action,
    amount: extractAuditAmount(log),
    statusKey: ACTION_STATUS_MAP[log.action] || "auditPage.statusPending",
    time: toRelativeTime(log.timestamp),
  };
}

export default function RiskAuditPage() {
  const { t } = useLanguage();
  const { address, isConnected } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  const [auditLogs, setAuditLogs] = useState<AuditTrailRecord[]>([]);
  const [overview, setOverview] = useState<RiskOverview>(DEFAULT_OVERVIEW);

  useEffect(() => {
    if (!isConnected || !isSessionAuthenticated || !address) return;
    const headers = buildAuthedHeaders(address);
    const gatewayBaseUrl = getGatewayBaseUrl();

    fetch(`${gatewayBaseUrl}/api/v1/finance/risk-overview`, { headers })
      .then((r) => r.json())
      .then((data: { overview?: RiskOverview }) => {
        if (data.overview) setOverview(data.overview);
      })
      .catch(() => {});

    fetch(`${gatewayBaseUrl}/api/v1/finance/audit-logs?limit=10`, { headers })
      .then((r) => r.json())
      .then((data: { logs?: FinanceAuditLog[] }) => {
        setAuditLogs((data.logs ?? []).map(mapAuditLog));
      })
      .catch(() => {});
  }, [isConnected, isSessionAuthenticated, address]);

  return (
    <div className="p-8 space-y-10">
      <AuditPageHeader t={t} />
      <RiskOverviewCards overview={overview} t={t} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <ActiveAlertsPanel alerts={overview.alerts} t={t} />
        <AuditTrailPanel logs={auditLogs} t={t} />
      </div>
    </div>
  );
}
