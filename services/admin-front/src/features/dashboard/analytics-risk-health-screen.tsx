"use client";

import { Button, Grid } from "@chakra-ui/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import {
  DataTable,
  MessageBanner,
  SurfaceCard,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
} from "@/components/console-ui";
import {
  buildRiskContextCards,
  buildRiskSignalCards,
} from "@/features/dashboard/analytics-presenters";
import {
  ANALYTICS_WINDOWS,
  AnalyticsEmptyState,
  AnalyticsPageShell,
  BudgetBlockSamplesTable,
  BudgetBlocksPanel,
  DistributionTable,
  SignalGrid,
  type AnalyticsScreenProps,
  useAnalyticsResource,
  useQueryBackedWindow,
} from "@/features/dashboard/analytics-dashboard-screen";
import { getAnalyticsRiskHealth } from "@/services/admin-api";

export function AnalyticsRiskHealthScreen({
  admin,
  token,
}: Readonly<AnalyticsScreenProps>) {
  const [windowValue, setWindowValue] = useQueryBackedWindow(
    ANALYTICS_WINDOWS,
    "24h",
  );
  const searchParams = useSearchParams();
  const {
    data: risk,
    loading,
    error,
  } = useAnalyticsResource(
    token,
    windowValue,
    getAnalyticsRiskHealth,
    "Risk health failed to load",
  );
  const cards = useMemo(
    () => [...buildRiskSignalCards(risk), ...buildRiskContextCards(risk)],
    [risk],
  );
  const focusBudgetBlocks = searchParams.get("focus") === "budget_blocked";

  if (loading && !risk) {
    return (
      <ControlPlaneLoadingScreen
        title="Risk Health Sync"
        message="正在读取风控规则、预算拦截和 Provider 健康..."
      />
    );
  }

  return (
    <AnalyticsPageShell
      admin={admin}
      eyebrow="Risk Health"
      title="风控健康"
      description="把风控规则、预算拦截、Provider 降级和退款原因压缩成值班信号。"
      windows={ANALYTICS_WINDOWS}
      windowValue={windowValue}
      onWindowChange={setWindowValue}
      extraActions={
        <Link href="/risk">
          <Button borderRadius="full" variant="ghost">
            风控工作台
          </Button>
        </Link>
      }
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <SignalGrid cards={cards} />
      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
        <DistributionTable title="Risk Rules" items={risk?.riskRules ?? []} />
        <DistributionTable
          title="Refund Reasons"
          items={risk?.refundReasons ?? []}
        />
      </Grid>
      <Grid templateColumns={{ base: "1fr", xl: "1.15fr 0.85fr" }} gap="16px">
        <BudgetBlocksPanel risk={risk} highlighted={focusBudgetBlocks} />
        <BudgetBlockSamplesTable risk={risk} />
      </Grid>
      <SurfaceCard
        eyebrow="Provider Health"
        title="Degraded providers"
        description="provider_health_degraded 事件里的 provider / service / reason。"
      >
        {risk?.degradedProviders.length ? (
          <DataTable>
            <TableHeaderRow>
              <Th>Provider</Th>
              <Th>Service</Th>
              <Th>Count</Th>
              <Th>Reason</Th>
            </TableHeaderRow>
            <TableBody>
              {risk.degradedProviders.map((item) => (
                <tr key={`${item.providerId}-${item.serviceId}`}>
                  <Td>{item.providerId}</Td>
                  <Td>{item.serviceId}</Td>
                  <Td>{item.count}</Td>
                  <Td>{item.reason}</Td>
                </tr>
              ))}
            </TableBody>
          </DataTable>
        ) : (
          <AnalyticsEmptyState label="当前窗口暂无 degraded providers" />
        )}
      </SurfaceCard>
    </AnalyticsPageShell>
  );
}
