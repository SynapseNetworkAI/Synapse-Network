"use client";

import { Button, Grid } from "@chakra-ui/react";
import Link from "next/link";
import { useMemo } from "react";

import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import {
  buildMoneyFlowContextCards,
  buildMoneyFlowSignalCards,
} from "@/features/dashboard/analytics-presenters";
import {
  ANALYTICS_WINDOWS,
  AnalyticsPageShell,
  DepositFailureSamplesTable,
  DistributionTable,
  SignalGrid,
  type AnalyticsScreenProps,
  useAnalyticsResource,
  useQueryBackedWindow,
} from "@/features/dashboard/analytics-dashboard-screen";
import { getAnalyticsMoneyFlow } from "@/services/admin-api";

export function AnalyticsMoneyFlowScreen({
  admin,
  token,
}: Readonly<AnalyticsScreenProps>) {
  const [windowValue, setWindowValue] = useQueryBackedWindow(
    ANALYTICS_WINDOWS,
    "24h"
  );
  const {
    data: money,
    loading,
    error,
  } = useAnalyticsResource(
    token,
    windowValue,
    getAnalyticsMoneyFlow,
    "Money flow failed to load"
  );
  const cards = useMemo(
    () => [
      ...buildMoneyFlowSignalCards(money),
      ...buildMoneyFlowContextCards(money),
    ],
    [money]
  );

  if (loading && !money) {
    return (
      <ControlPlaneLoadingScreen
        title="Money Flow Sync"
        message="正在读取充值、提现、退款与 ledger context..."
      />
    );
  }

  return (
    <AnalyticsPageShell
      admin={admin}
      eyebrow="Money Flow"
      title="资金流"
      description="充值、提现、退款、确认延迟与财务投影同屏观察。"
      windows={ANALYTICS_WINDOWS}
      windowValue={windowValue}
      onWindowChange={setWindowValue}
      extraActions={
        <Link href="/finance/reconciliation">
          <Button borderRadius="full" variant="ghost">
            对账明细
          </Button>
        </Link>
      }
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <SignalGrid cards={cards} />
      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
        <DistributionTable
          title="Deposit Errors"
          items={money?.depositErrors ?? []}
        />
        <DistributionTable
          title="Withdrawal Errors"
          items={money?.withdrawalErrors ?? []}
        />
      </Grid>
      <DepositFailureSamplesTable money={money} />
    </AnalyticsPageShell>
  );
}
