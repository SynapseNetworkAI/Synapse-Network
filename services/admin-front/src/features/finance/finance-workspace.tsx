"use client";

import { Box, Button, Stack } from "@chakra-ui/react";
import { useState } from "react";

import { MessageBanner } from "@/components/console-ui";
import { ConsumerDepositsTable } from "@/features/finance/consumer-deposits-table";
import { FinanceAttentionSurface } from "@/features/finance/finance-page-sections";
import { buildFinancePressureCards } from "@/features/finance/finance-presenters";
import { FinanceOverviewTab } from "@/features/finance/finance-overview-tab";
import {
  PlatformFeeTreasuryModal,
  canUsePlatformFeeTreasury,
} from "@/features/finance/platform-fee-treasury-modal";
import { ProviderWithdrawalsTable } from "@/features/finance/provider-withdrawals-table";
import type {
  AdminAuthSecurityPolicy,
  AdminProfile,
  ApprovalItem,
  ActivityTrendPoint,
  FinanceOverview,
  ReconciliationDetail,
} from "@/services/admin-api";

const financeTabs = [
  { id: "overview", label: "Overview" },
  { id: "consumerDeposits", label: "Consumer Deposits" },
  { id: "providerWithdrawals", label: "Provider Withdrawals" },
  { id: "reconciliation", label: "Reconciliation" },
  { id: "platformFees", label: "Platform Fees" },
];

function FinanceTabsBar({
  activeTab,
  onSelect,
}: Readonly<{ activeTab: string; onSelect: (tabId: string) => void }>) {
  return (
    <Stack direction={{ base: "column", md: "row" }} gap="10px" flexWrap="wrap">
      {financeTabs.map((tab) => (
        <Button
          key={tab.id}
          size="sm"
          borderRadius="999px"
          variant={activeTab === tab.id ? "solid" : "outline"}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </Button>
      ))}
    </Stack>
  );
}

function FinanceTabPanel({
  activeTab,
  admin,
  approvals,
  onOpenPlatformFeeTreasury,
  overview,
  reconciliationDetail,
  token,
  trendPoints,
}: Readonly<{
  activeTab: string;
  admin: AdminProfile;
  approvals: ApprovalItem[];
  onOpenPlatformFeeTreasury: () => void;
  overview: FinanceOverview;
  reconciliationDetail: ReconciliationDetail | null;
  token: string | null;
  trendPoints: ActivityTrendPoint[];
}>) {
  if (activeTab === "consumerDeposits" && token) {
    return <ConsumerDepositsTable token={token} />;
  }
  if (activeTab === "providerWithdrawals" && token) {
    return <ProviderWithdrawalsTable token={token} />;
  }
  if (activeTab === "reconciliation") {
    return (
      <Box>
        <MessageBanner
          kind="success"
          message="Reconciliation 明细继续由现有 dashboard/reconciliation-detail 投影提供；本页保留入口，危险修复动作仍走审批流。"
        />
      </Box>
    );
  }
  if (activeTab === "platformFees") {
    return (
      <Box>
        <FinanceAttentionSurface
          overview={overview}
          pressureCards={buildFinancePressureCards(overview)}
          canOpenPlatformFeeTreasury={canUsePlatformFeeTreasury(admin.role)}
          onOpenPlatformFeeTreasury={onOpenPlatformFeeTreasury}
        />
      </Box>
    );
  }
  return (
    <FinanceOverviewTab
      approvals={approvals}
      canOpenPlatformFeeTreasury={canUsePlatformFeeTreasury(admin.role)}
      onOpenPlatformFeeTreasury={onOpenPlatformFeeTreasury}
      overview={overview}
      reconciliationDetail={reconciliationDetail}
      trendPoints={trendPoints}
    />
  );
}

export function FinanceWorkspace({
  admin,
  approvals,
  error,
  overview,
  reconciliationDetail,
  security,
  token,
  trendPoints,
}: Readonly<{
  admin: AdminProfile;
  approvals: ApprovalItem[];
  error: string | null;
  overview: FinanceOverview;
  reconciliationDetail: ReconciliationDetail | null;
  security: AdminAuthSecurityPolicy | null;
  token: string | null;
  trendPoints: ActivityTrendPoint[];
}>) {
  const [activeTab, setActiveTab] = useState("overview");
  const [platformFeeModalOpen, setPlatformFeeModalOpen] = useState(false);

  return (
    <>
      <Stack gap="16px">
        <FinanceTabsBar activeTab={activeTab} onSelect={setActiveTab} />
        {error ? <MessageBanner kind="error" message={error} /> : null}
      </Stack>
      <FinanceTabPanel
        activeTab={activeTab}
        admin={admin}
        approvals={approvals}
        onOpenPlatformFeeTreasury={() => setPlatformFeeModalOpen(true)}
        overview={overview}
        reconciliationDetail={reconciliationDetail}
        token={token}
        trendPoints={trendPoints}
      />
      {token ? (
        <PlatformFeeTreasuryModal
          open={platformFeeModalOpen}
          security={security}
          onClose={() => setPlatformFeeModalOpen(false)}
        />
      ) : null}
    </>
  );
}
