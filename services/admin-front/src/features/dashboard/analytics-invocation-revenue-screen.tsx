"use client";

import { Grid } from "@chakra-ui/react";
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
  buildInvocationSignalCards,
  buildInvocationVolumeCards,
} from "@/features/dashboard/analytics-presenters";
import {
  ANALYTICS_WINDOWS,
  AnalyticsEmptyState,
  AnalyticsPageShell,
  DistributionTable,
  SignalGrid,
  type AnalyticsScreenProps,
  useAnalyticsResource,
  useQueryBackedWindow,
} from "@/features/dashboard/analytics-dashboard-screen";
import { formatUsdc } from "@/lib/admin-console";
import { getAnalyticsInvocationRevenue } from "@/services/admin-api";

export function AnalyticsInvocationRevenueScreen({
  admin,
  token,
}: Readonly<AnalyticsScreenProps>) {
  const [windowValue, setWindowValue] = useQueryBackedWindow(
    ANALYTICS_WINDOWS,
    "24h"
  );
  const {
    data: invocation,
    loading,
    error,
  } = useAnalyticsResource(
    token,
    windowValue,
    getAnalyticsInvocationRevenue,
    "Invocation revenue failed to load"
  );
  const primaryCards = useMemo(
    () => buildInvocationSignalCards(invocation),
    [invocation]
  );
  const volumeCards = useMemo(
    () => buildInvocationVolumeCards(invocation),
    [invocation]
  );

  if (loading && !invocation) {
    return (
      <ControlPlaneLoadingScreen
        title="Invocation Revenue Sync"
        message="正在读取调用收入聚合..."
      />
    );
  }

  return (
    <AnalyticsPageShell
      admin={admin}
      eyebrow="Invocation Revenue"
      title="调用与收入"
      description="Gateway 收入 source of truth：quote、invoke、GMV、失败归因和延迟。"
      windows={ANALYTICS_WINDOWS}
      windowValue={windowValue}
      onWindowChange={setWindowValue}
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <SignalGrid cards={[...primaryCards, ...volumeCards]} />
      <SurfaceCard
        eyebrow="Trend"
        title="调用收入趋势"
        description="按后端 bucket 展示 completed、failed、GMV 和 provider net。"
      >
        {invocation?.trend.length ? (
          <DataTable>
            <TableHeaderRow>
              <Th>Bucket</Th>
              <Th>Completed</Th>
              <Th>Failed</Th>
              <Th>GMV</Th>
              <Th>Platform Fee</Th>
              <Th>Provider Net</Th>
            </TableHeaderRow>
            <TableBody>
              {invocation.trend.map((point) => (
                <tr key={point.bucket}>
                  <Td>{point.bucket}</Td>
                  <Td>{point.invokeCompleted}</Td>
                  <Td>{point.invokeFailed}</Td>
                  <Td>{formatUsdc(point.gmvUsdc)} USDC</Td>
                  <Td>{formatUsdc(point.platformFeeUsdc)} USDC</Td>
                  <Td>{formatUsdc(point.providerNetUsdc)} USDC</Td>
                </tr>
              ))}
            </TableBody>
          </DataTable>
        ) : (
          <AnalyticsEmptyState label="当前窗口暂无调用收入趋势" />
        )}
      </SurfaceCard>
      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
        <DistributionTable
          title="Failure Stage"
          items={invocation?.failureStages ?? []}
        />
        <DistributionTable
          title="Error Code"
          items={invocation?.errorCodes ?? []}
        />
      </Grid>
    </AnalyticsPageShell>
  );
}
