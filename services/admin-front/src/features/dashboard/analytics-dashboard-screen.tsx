"use client";

import { Box, Button, Grid, HStack, Heading, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { DataTable, MessageBanner, MetricCard, SentinelStatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th } from "@/components/console-ui";
import {
  buildAnalyticsNorthStarCards,
  buildConsumerFunnelSteps,
  buildDataQualitySignalCards,
  buildInvocationSignalCards,
  buildMoneyFlowSignalCards,
  buildProviderSignalCards,
  buildRiskSignalCards,
  summarizeCriticalFreshness,
  summarizeSourceCoverage,
  type AnalyticsSignalCard,
} from "@/features/dashboard/analytics-presenters";
import { formatUsdc } from "@/lib/admin-console";
import type {
  AdminProfile,
  AnalyticsConsumerFunnel,
  AnalyticsDataQuality,
  AnalyticsInvocationRevenue,
  AnalyticsMoneyFlow,
  AnalyticsOverview,
  AnalyticsProviderRevenue,
  AnalyticsRiskHealth,
  AnalyticsWindow,
} from "@/services/admin-api";
import {
  getAnalyticsConsumerFunnel,
  getAnalyticsDataQuality,
  getAnalyticsInvocationRevenue,
  getAnalyticsMoneyFlow,
  getAnalyticsOverview,
  getAnalyticsProviderRevenue,
  getAnalyticsRiskHealth,
} from "@/services/admin-api";

type AnalyticsDashboardSnapshot = {
  overview: AnalyticsOverview;
  consumerFunnel: AnalyticsConsumerFunnel;
  invocationRevenue: AnalyticsInvocationRevenue;
  providerRevenue: AnalyticsProviderRevenue;
  moneyFlow: AnalyticsMoneyFlow;
  riskHealth: AnalyticsRiskHealth;
  dataQuality: AnalyticsDataQuality;
};

type AnalyticsDashboardScreenProps = {
  admin: AdminProfile;
  token: string;
};

const WINDOWS: AnalyticsWindow[] = ["24h", "7d", "30d"];

function resolveStatusLabel(tone: AnalyticsSignalCard["tone"]): string {
  if (tone === "red") {
    return "Degraded";
  }
  if (tone === "orange") {
    return "Monitor";
  }
  if (tone === "green") {
    return "Nominal";
  }
  return "Pending";
}

function SignalGrid({ cards }: Readonly<{ cards: AnalyticsSignalCard[] }>) {
  return (
    <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap="12px">
      {cards.map((card) => (
        <Box key={card.key} borderRadius="22px" p="16px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)">
          <HStack justify="space-between" align="flex-start" gap="10px">
            <Stack gap="4px">
              <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">{card.label}</Text>
              <Heading size="md" letterSpacing="-0.03em">{card.value}</Heading>
            </Stack>
            <SentinelStatusChip label={resolveStatusLabel(card.tone)} tone={card.tone} />
          </HStack>
          <Text mt="10px" color="ink.500">{card.detail}</Text>
        </Box>
      ))}
    </Grid>
  );
}

function AnalyticsFunnelSurface({ funnel }: Readonly<{ funnel: AnalyticsConsumerFunnel | null }>) {
  const steps = useMemo(() => buildConsumerFunnelSteps(funnel), [funnel]);
  return (
    <SurfaceCard
      eyebrow="Consumer Activation"
      title="Consumer 激活漏斗"
      description="从访问、连钱包、注册、报价、充值到首次付费调用，直接定位增长链路里的断点。"
      stamp={funnel ? `Activation ${(funnel.summary.activationRate * 100).toFixed(1)}%` : undefined}
    >
      <Stack gap="12px">
        {steps.map((step, index) => (
          <Box key={step.eventName} borderRadius="20px" p="14px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)">
            <Grid templateColumns={{ base: "1fr", md: "1.2fr 0.8fr auto" }} gap="12px" alignItems="center">
              <Stack gap="2px">
                <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">Step {index + 1}</Text>
                <Heading size="sm">{step.label}</Heading>
              </Stack>
              <Box>
                <Box h="10px" borderRadius="999px" bg="rgba(15,17,21,0.08)" overflow="hidden">
                  <Box h="100%" w={`${Math.min(100, Number(step.conversion.replace("%", "")))}%`} bg={step.tone === "red" ? "#b83131" : step.tone === "orange" ? "#f36a1d" : "#1f9257"} />
                </Box>
                <Text mt="6px" color="ink.500">users {step.users} / events {step.events}</Text>
              </Box>
              <HStack gap="8px" justify="flex-end">
                <SentinelStatusChip label={step.conversion} tone={step.tone} />
                <Text color="ink.500">drop {step.dropoff}</Text>
              </HStack>
            </Grid>
          </Box>
        ))}
      </Stack>
    </SurfaceCard>
  );
}

function InvocationRevenueSurface({ invocation }: Readonly<{ invocation: AnalyticsInvocationRevenue | null }>) {
  const cards = useMemo(() => buildInvocationSignalCards(invocation), [invocation]);
  return (
    <SurfaceCard eyebrow="Invocation Revenue" title="调用与收入" description="Gateway 收入 source of truth：调用成功率、延迟、GMV 和失败归因。">
      <Stack gap="16px">
        <SignalGrid cards={cards} />
        <DataTable>
          <TableHeaderRow>
            <Th>Bucket</Th>
            <Th>Completed</Th>
            <Th>Failed</Th>
            <Th>GMV</Th>
            <Th>Provider Net</Th>
          </TableHeaderRow>
          <TableBody>
            {(invocation?.trend ?? []).slice(-6).map((point) => (
              <tr key={point.bucket}>
                <Td>{point.bucket}</Td>
                <Td>{point.invokeCompleted}</Td>
                <Td>{point.invokeFailed}</Td>
                <Td>{formatUsdc(point.gmvUsdc)} USDC</Td>
                <Td>{formatUsdc(point.providerNetUsdc)} USDC</Td>
              </tr>
            ))}
          </TableBody>
        </DataTable>
      </Stack>
    </SurfaceCard>
  );
}

function ProviderRevenueSurface({ provider }: Readonly<{ provider: AnalyticsProviderRevenue | null }>) {
  const cards = useMemo(() => buildProviderSignalCards(provider), [provider]);
  return (
    <SurfaceCard eyebrow="Provider Revenue" title="Provider 收入与结算" description="观察 Provider 是否真的赚到钱，以及从收入到结算完成是否堵塞。">
      <Stack gap="16px">
        <SignalGrid cards={cards} />
        <DataTable>
          <TableHeaderRow>
            <Th>Provider</Th>
            <Th>Service</Th>
            <Th>Gross</Th>
            <Th>Net</Th>
            <Th>Invokes</Th>
          </TableHeaderRow>
          <TableBody>
            {(provider?.topProviders ?? []).map((item) => (
              <tr key={item.providerId}>
                <Td>{item.providerId}</Td>
                <Td>{item.serviceId}</Td>
                <Td>{formatUsdc(item.grossUsdc)} USDC</Td>
                <Td>{formatUsdc(item.providerNetUsdc)} USDC</Td>
                <Td>{item.invokeCount}</Td>
              </tr>
            ))}
          </TableBody>
        </DataTable>
      </Stack>
    </SurfaceCard>
  );
}

function MoneyRiskSurface({ money, risk }: Readonly<{ money: AnalyticsMoneyFlow | null; risk: AnalyticsRiskHealth | null }>) {
  const moneyCards = useMemo(() => buildMoneyFlowSignalCards(money), [money]);
  const riskCards = useMemo(() => buildRiskSignalCards(risk), [risk]);
  return (
    <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
      <SurfaceCard eyebrow="Money Flow" title="资金流与确认效率" description="充值、提现、退款与现有财务/对账投影同屏观察。">
        <SignalGrid cards={moneyCards} />
      </SurfaceCard>
      <SurfaceCard eyebrow="Risk & Provider Health" title="风控与 Provider 健康" description="把风控规则、预算拦截、Provider 降级和退款原因压缩成值班信号。">
        <Stack gap="16px">
          <SignalGrid cards={riskCards} />
          <HStack gap="10px" wrap="wrap">
            {(risk?.riskRules ?? []).slice(0, 4).map((rule) => (
              <SentinelStatusChip key={rule.key} label={`${rule.label} ${rule.count}`} tone="orange" />
            ))}
          </HStack>
        </Stack>
      </SurfaceCard>
    </Grid>
  );
}

function DataQualitySurface({ dataQuality }: Readonly<{ dataQuality: AnalyticsDataQuality | null }>) {
  const cards = useMemo(() => buildDataQualitySignalCards(dataQuality), [dataQuality]);
  return (
    <SurfaceCard
      eyebrow="Data Quality & Debug"
      title="Analytics 埋点健康"
      description="上线门槛看板：重复率、隐私检查、source coverage、关键事件新鲜度和 schema 缺失样本。"
      stamp={dataQuality ? `Status ${dataQuality.overallStatus}` : undefined}
    >
      <Stack gap="16px">
        <SignalGrid cards={cards} />
        <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="12px">
          <Box borderRadius="20px" p="16px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)">
            <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">Source Coverage</Text>
            <Text mt="8px" fontWeight="700">{summarizeSourceCoverage(dataQuality)}</Text>
          </Box>
          <Box borderRadius="20px" p="16px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)">
            <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">Critical Freshness</Text>
            <Text mt="8px" fontWeight="700">{summarizeCriticalFreshness(dataQuality)}</Text>
          </Box>
        </Grid>
      </Stack>
    </SurfaceCard>
  );
}

export function AnalyticsDashboardScreen({ admin, token }: Readonly<AnalyticsDashboardScreenProps>) {
  const [windowValue, setWindowValue] = useState<AnalyticsWindow>("24h");
  const [snapshot, setSnapshot] = useState<AnalyticsDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getAnalyticsOverview(token, windowValue),
      getAnalyticsConsumerFunnel(token, windowValue),
      getAnalyticsInvocationRevenue(token, windowValue),
      getAnalyticsProviderRevenue(token, windowValue),
      getAnalyticsMoneyFlow(token, windowValue),
      getAnalyticsRiskHealth(token, windowValue),
      getAnalyticsDataQuality(token, "24h"),
    ])
      .then(([overview, consumerFunnel, invocationRevenue, providerRevenue, moneyFlow, riskHealth, dataQuality]) => {
        if (!cancelled) {
          setSnapshot({ overview, consumerFunnel, invocationRevenue, providerRevenue, moneyFlow, riskHealth, dataQuality });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Analytics dashboard failed to load");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, windowValue]);

  const northStarCards = useMemo(() => buildAnalyticsNorthStarCards(snapshot?.overview.cards ?? []), [snapshot]);

  if (loading && !snapshot) {
    return <ControlPlaneLoadingScreen title="Analytics Dashboard Sync" message="正在读取 ClickHouse 聚合与对账投影..." />;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Analytics Dashboard"
      title="Analytics 业务增长与埋点健康"
      description="一屏观察调用增长、收入、激活、Provider 收益、资金链路、风控和埋点质量。"
      actions={(
        <>
          {WINDOWS.map((item) => (
            <Button key={item} borderRadius="full" variant={windowValue === item ? "solid" : "ghost"} bg={windowValue === item ? "#0f1115" : undefined} color={windowValue === item ? "#f4f7fb" : undefined} onClick={() => setWindowValue(item)}>
              {item}
            </Button>
          ))}
          <Link href="/finance/reconciliation"><Button borderRadius="full" variant="ghost">对账明细</Button></Link>
        </>
      )}
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(6, 1fr)" }} gap="12px">
        {northStarCards.map((card, index) => (
          <MetricCard
            key={card.key}
            label={card.label}
            value={card.value}
            meta={card.detail}
            accent={index === 0 ? "linear-gradient(180deg, #ffffff 0%, #eaf7f0 100%)" : undefined}
          />
        ))}
      </Grid>
      {snapshot?.overview.alerts.length ? (
        <SurfaceCard eyebrow="Alerts" title="关键告警" description="来自 analytics overview 的 critical/warning 信号。">
          <Stack gap="10px">
            {snapshot.overview.alerts.map((alert) => (
              <Box key={`${alert.title}-${alert.detail}`} borderRadius="18px" p="14px" bg={alert.severity === "critical" ? "rgba(184,49,49,0.08)" : "rgba(243,106,29,0.08)"} border="1px solid rgba(15,17,21,0.06)">
                <Text fontWeight="800">{alert.title}</Text>
                <Text color="ink.500">{alert.detail}</Text>
              </Box>
            ))}
          </Stack>
        </SurfaceCard>
      ) : null}
      <Grid templateColumns={{ base: "1fr", xl: "0.95fr 1.05fr" }} gap="16px">
        <AnalyticsFunnelSurface funnel={snapshot?.consumerFunnel ?? null} />
        <InvocationRevenueSurface invocation={snapshot?.invocationRevenue ?? null} />
      </Grid>
      <ProviderRevenueSurface provider={snapshot?.providerRevenue ?? null} />
      <MoneyRiskSurface money={snapshot?.moneyFlow ?? null} risk={snapshot?.riskHealth ?? null} />
      <DataQualitySurface dataQuality={snapshot?.dataQuality ?? null} />
    </AdminShell>
  );
}
