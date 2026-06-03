"use client";

import { Box, Button, Grid, HStack, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import { useMemo } from "react";

import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import {
  MessageBanner,
  MetricCard,
  SurfaceCard,
} from "@/components/console-ui";
import { findAdminRewriteRoute } from "@/features/admin-rewrite/module-catalog";
import { RewriteModuleWorkspace } from "@/features/admin-rewrite/rewrite-primitives";
import { buildAnalyticsNorthStarCards } from "@/features/dashboard/analytics-presenters";
import {
  ANALYTICS_WINDOWS,
  AnalyticsPageShell,
  type AnalyticsScreenProps,
  useAnalyticsResource,
  useQueryBackedWindow,
} from "@/features/dashboard/analytics-dashboard-screen";
import type { AnalyticsOverview, AnalyticsWindow } from "@/services/admin-api";
import { getAnalyticsOverview } from "@/services/admin-api";

const topicCards = [
  {
    key: "consumer",
    title: "Consumer 激活漏斗",
    href: "/dashboard/analytics/consumer-funnel",
    description: "从访问、连钱包、注册、报价、充值到首次付费调用。",
    metrics: ["wallet_connected", "quote_generated", "invoke_completed"],
  },
  {
    key: "invocation",
    title: "调用与收入",
    href: "/dashboard/analytics/invocation-revenue",
    description: "quote、invoke、GMV、失败归因和 Gateway 延迟。",
    metrics: ["invoke_completed", "invoke_success_rate", "gmv_usdc"],
  },
  {
    key: "provider",
    title: "Provider 收益",
    href: "/dashboard/analytics/provider-revenue",
    description: "Provider 收入、首次收益、结算 funnel 和 Top providers。",
    metrics: ["provider_net_usdc", "platform_fee_usdc", "analytics_health"],
  },
  {
    key: "money",
    title: "资金流",
    href: "/dashboard/analytics/money-flow",
    description: "充值、提现、退款、确认延迟和 ledger context。",
    metrics: ["gmv_usdc", "platform_fee_usdc", "analytics_health"],
  },
  {
    key: "risk",
    title: "风控健康",
    href: "/dashboard/analytics/risk-health",
    description:
      "risk rules、budget blocked、provider degraded 和 refund reasons。",
    metrics: ["analytics_health", "invoke_success_rate", "gmv_usdc"],
  },
  {
    key: "quality",
    title: "埋点质量",
    href: "/dashboard/analytics/data-quality",
    description: "事件量、source coverage、隐私检查和 schema issue。",
    metrics: ["analytics_health", "invoke_completed", "invoke_success_rate"],
  },
] as const;

function withWindow(href: string, windowValue: string): string {
  const joiner = href.includes("?") ? "&" : "?";
  return `${href}${joiner}window=${encodeURIComponent(windowValue)}`;
}

function analyticsTestId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function topicMetricValue(
  cards: AnalyticsOverview["cards"],
  key: string
): string | null {
  const card = buildAnalyticsNorthStarCards(cards).find(
    (item) => item.key === key
  );
  return card ? `${card.label}: ${card.value}` : null;
}

function AnalyticsTopicGrid({
  overview,
  windowValue,
}: Readonly<{ overview: AnalyticsOverview; windowValue: AnalyticsWindow }>) {
  return (
    <Grid templateColumns={{ base: "1fr", xl: "repeat(3, 1fr)" }} gap="14px">
      {topicCards.map((topic) => {
        const metrics = topic.metrics
          .map((key) => topicMetricValue(overview.cards, key))
          .filter((item): item is string => Boolean(item));
        return (
          <a
            key={topic.key}
            href={withWindow(topic.href, windowValue)}
            data-testid={`analytics-drilldown-${topic.key}`}
            style={{ display: "block", textDecoration: "none" }}
          >
            <Box
              minH="210px"
              borderRadius="26px"
              p="20px"
              bg="linear-gradient(180deg, #ffffff 0%, #f3f6fa 100%)"
              border="1px solid rgba(15,17,21,0.06)"
              transition="transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease"
              _hover={{
                transform: "translateY(-2px)",
                boxShadow: "0 16px 40px rgba(15,17,21,0.08)",
                borderColor: "rgba(31,146,87,0.24)",
              }}
            >
              <Text
                fontSize="11px"
                letterSpacing="0.18em"
                textTransform="uppercase"
                color="signal.700"
              >
                Analytics Drilldown
              </Text>
              <Text mt="10px" fontSize="18px" fontWeight="800">
                {topic.title}
              </Text>
              <Text mt="8px" color="ink.500">
                {topic.description}
              </Text>
              <Stack mt="18px" gap="8px">
                {(metrics.length ? metrics : ["打开专题查看完整聚合指标"])
                  .slice(0, 3)
                  .map((metric) => (
                    <Box
                      key={metric}
                      px="12px"
                      py="8px"
                      borderRadius="14px"
                      bg="rgba(15,17,21,0.04)"
                      color="ink.700"
                      fontWeight="700"
                    >
                      {metric}
                    </Box>
                  ))}
              </Stack>
              <Text mt="16px" fontWeight="800" color="signal.700">
                打开专题
              </Text>
            </Box>
          </a>
        );
      })}
    </Grid>
  );
}

function AnalyticsOverviewBody({
  overview,
  windowValue,
}: Readonly<{
  overview: AnalyticsOverview | null;
  windowValue: AnalyticsWindow;
}>) {
  return (
    <>
      {overview?.alerts.length ? (
        <SurfaceCard
          eyebrow="Alerts"
          title="关键告警"
          description="来自 analytics overview 的 critical / warning 信号。"
        >
          <Stack gap="10px">
            {overview.alerts.map((alert) => (
              <Box
                key={`${alert.title}-${alert.detail}`}
                borderRadius="18px"
                p="14px"
                bg={
                  alert.severity === "critical"
                    ? "rgba(184,49,49,0.08)"
                    : "rgba(243,106,29,0.08)"
                }
                border="1px solid rgba(15,17,21,0.06)"
              >
                <HStack justify="space-between" align="flex-start" gap="12px">
                  <Stack gap="2px">
                    <Text fontWeight="800">{alert.title}</Text>
                    <Text color="ink.500">{alert.detail}</Text>
                  </Stack>
                  {alert.href ? (
                    <a
                      href={alert.href}
                      data-testid={`analytics-alert-${analyticsTestId(
                        alert.title
                      )}`}
                      style={{ textDecoration: "none" }}
                    >
                      <Button borderRadius="full" size="sm" variant="ghost">
                        查看
                      </Button>
                    </a>
                  ) : null}
                </HStack>
              </Box>
            ))}
          </Stack>
        </SurfaceCard>
      ) : null}
      {overview ? (
        <SurfaceCard
          eyebrow="Drilldowns"
          title="专题页面"
          description="总览只给方向，专题页只加载自己的聚合接口，避免一个慢接口拖住整套 Analytics。"
        >
          <AnalyticsTopicGrid overview={overview} windowValue={windowValue} />
        </SurfaceCard>
      ) : null}
    </>
  );
}

export function AnalyticsOverviewScreen({
  admin,
  token,
}: Readonly<AnalyticsScreenProps>) {
  const [windowValue, setWindowValue] = useQueryBackedWindow(
    ANALYTICS_WINDOWS,
    "24h"
  );
  const {
    data: overview,
    loading,
    error,
  } = useAnalyticsResource(
    token,
    windowValue,
    getAnalyticsOverview,
    "Analytics overview failed to load"
  );
  const northStarCards = useMemo(
    () => buildAnalyticsNorthStarCards(overview?.cards ?? []),
    [overview]
  );
  const rewriteSpec = findAdminRewriteRoute("/dashboard/analytics");
  const overviewMetrics = northStarCards.map((card) => ({
    label: card.label,
    meta: card.detail,
    value: card.value,
  }));

  if (loading && !overview) {
    return (
      <ControlPlaneLoadingScreen
        title="Analytics Overview Sync"
        message="正在读取 North Star 指标与关键告警..."
      />
    );
  }

  return (
    <AnalyticsPageShell
      admin={admin}
      eyebrow="Analytics Overview"
      title="Analytics 总览"
      description="先判断增长、收入、风控和埋点质量哪里异常，再进入专题页面深挖。"
      windows={ANALYTICS_WINDOWS}
      windowValue={windowValue}
      onWindowChange={setWindowValue}
      extraActions={
        <Link href="/system">
          <Button borderRadius="full" variant="ghost">
            系统诊断
          </Button>
        </Link>
      }
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      {rewriteSpec ? (
        <RewriteModuleWorkspace spec={rewriteSpec} metrics={overviewMetrics}>
          <AnalyticsOverviewBody
            overview={overview}
            windowValue={windowValue}
          />
        </RewriteModuleWorkspace>
      ) : (
        <>
          <Grid
            templateColumns={{
              base: "1fr",
              md: "repeat(2, 1fr)",
              xl: "repeat(6, 1fr)",
            }}
            gap="12px"
          >
            {northStarCards.map((card, index) => (
              <MetricCard
                key={card.key}
                label={card.label}
                value={card.value}
                meta={card.detail}
                accent={
                  index === 0
                    ? "linear-gradient(180deg, #ffffff 0%, #eaf7f0 100%)"
                    : undefined
                }
              />
            ))}
          </Grid>
          <AnalyticsOverviewBody
            overview={overview}
            windowValue={windowValue}
          />
        </>
      )}
    </AnalyticsPageShell>
  );
}
