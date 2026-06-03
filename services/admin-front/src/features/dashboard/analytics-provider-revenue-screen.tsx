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
  buildProviderSettlementCards,
  buildProviderSignalCards,
} from "@/features/dashboard/analytics-presenters";
import {
  ANALYTICS_WINDOWS,
  AnalyticsEmptyState,
  AnalyticsPageShell,
  SignalGrid,
  type AnalyticsScreenProps,
  useAnalyticsResource,
  useQueryBackedWindow,
} from "@/features/dashboard/analytics-dashboard-screen";
import { formatUsdc } from "@/lib/admin-console";
import { getAnalyticsProviderRevenue } from "@/services/admin-api";

export function AnalyticsProviderRevenueScreen({
  admin,
  token,
}: Readonly<AnalyticsScreenProps>) {
  const [windowValue, setWindowValue] = useQueryBackedWindow(
    ANALYTICS_WINDOWS,
    "24h"
  );
  const {
    data: provider,
    loading,
    error,
  } = useAnalyticsResource(
    token,
    windowValue,
    getAnalyticsProviderRevenue,
    "Provider revenue failed to load"
  );
  const cards = useMemo(
    () => [
      ...buildProviderSignalCards(provider),
      ...buildProviderSettlementCards(provider),
    ],
    [provider]
  );

  if (loading && !provider) {
    return (
      <ControlPlaneLoadingScreen
        title="Provider Revenue Sync"
        message="正在读取 Provider 收益与结算聚合..."
      />
    );
  }

  return (
    <AnalyticsPageShell
      admin={admin}
      eyebrow="Provider Revenue"
      title="Provider 收益"
      description="观察 Provider 是否真的赚到钱，以及从收入到结算完成是否堵塞。"
      windows={ANALYTICS_WINDOWS}
      windowValue={windowValue}
      onWindowChange={setWindowValue}
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <SignalGrid cards={cards} />
      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
        <SurfaceCard
          eyebrow="Settlement Funnel"
          title="结算 funnel"
          description="provider_revenue_received 到 settlement claim 完成的转化。"
        >
          {provider?.settlementFunnel.length ? (
            <DataTable>
              <TableHeaderRow>
                <Th>Event</Th>
                <Th>Count</Th>
                <Th>Amount</Th>
                <Th>Conversion</Th>
              </TableHeaderRow>
              <TableBody>
                {provider.settlementFunnel.map((item) => (
                  <tr key={item.eventName}>
                    <Td>{item.label}</Td>
                    <Td>{item.count}</Td>
                    <Td>{formatUsdc(item.amountUsdc)} USDC</Td>
                    <Td>{Math.round(item.conversionRate * 1000) / 10}%</Td>
                  </tr>
                ))}
              </TableBody>
            </DataTable>
          ) : (
            <AnalyticsEmptyState label="当前窗口暂无结算 funnel" />
          )}
        </SurfaceCard>
        <SurfaceCard
          eyebrow="Top Providers"
          title="Top providers"
          description="按 gross / net / invoke count 观察头部 Provider。"
        >
          {provider?.topProviders.length ? (
            <DataTable>
              <TableHeaderRow>
                <Th>Provider</Th>
                <Th>Service</Th>
                <Th>Gross</Th>
                <Th>Net</Th>
                <Th>Invokes</Th>
              </TableHeaderRow>
              <TableBody>
                {provider.topProviders.map((item) => (
                  <tr key={`${item.providerId}-${item.serviceId}`}>
                    <Td>{item.providerId}</Td>
                    <Td>{item.serviceId}</Td>
                    <Td>{formatUsdc(item.grossUsdc)} USDC</Td>
                    <Td>{formatUsdc(item.providerNetUsdc)} USDC</Td>
                    <Td>{item.invokeCount}</Td>
                  </tr>
                ))}
              </TableBody>
            </DataTable>
          ) : (
            <AnalyticsEmptyState label="当前窗口暂无 Top providers" />
          )}
        </SurfaceCard>
      </Grid>
    </AnalyticsPageShell>
  );
}
