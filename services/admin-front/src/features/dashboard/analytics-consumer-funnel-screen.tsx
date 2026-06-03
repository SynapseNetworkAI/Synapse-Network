"use client";

import { Box, Grid, HStack, Stack, Text } from "@chakra-ui/react";
import { useMemo } from "react";

import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import {
  MessageBanner,
  SentinelStatusChip,
  SurfaceCard,
} from "@/components/console-ui";
import {
  buildConsumerFunnelSteps,
  buildConsumerFunnelSummaryCards,
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
import { getAnalyticsConsumerFunnel } from "@/services/admin-api";

export function AnalyticsConsumerFunnelScreen({
  admin,
  token,
}: Readonly<AnalyticsScreenProps>) {
  const [windowValue, setWindowValue] = useQueryBackedWindow(
    ANALYTICS_WINDOWS,
    "24h"
  );
  const {
    data: funnel,
    loading,
    error,
  } = useAnalyticsResource(
    token,
    windowValue,
    getAnalyticsConsumerFunnel,
    "Consumer funnel failed to load"
  );
  const summaryCards = useMemo(
    () => buildConsumerFunnelSummaryCards(funnel),
    [funnel]
  );
  const steps = useMemo(() => buildConsumerFunnelSteps(funnel), [funnel]);

  if (loading && !funnel) {
    return (
      <ControlPlaneLoadingScreen
        title="Consumer Funnel Sync"
        message="正在读取 ClickHouse 聚合与 gateway-admin 投影..."
      />
    );
  }

  return (
    <AnalyticsPageShell
      admin={admin}
      eyebrow="Consumer Activation"
      title="Consumer 激活漏斗"
      description="从访问、连钱包、注册、报价、充值到首次付费调用，定位增长链路断点。"
      windows={ANALYTICS_WINDOWS}
      windowValue={windowValue}
      onWindowChange={setWindowValue}
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <SignalGrid cards={summaryCards} />
      <SurfaceCard
        eyebrow="Funnel Ladder"
        title="事件链路"
        description="每一步展示 users、events、conversion 和 dropoff；不做用户级追踪。"
      >
        {steps.length ? (
          <Stack gap="12px">
            {steps.map((step, index) => (
              <Box
                key={step.eventName}
                borderRadius="20px"
                p="14px"
                bg="#f7f9fc"
                border="1px solid rgba(15,17,21,0.06)"
              >
                <Grid
                  templateColumns={{ base: "1fr", md: "1.2fr 0.8fr auto" }}
                  gap="12px"
                  alignItems="center"
                >
                  <Stack gap="2px">
                    <Text
                      fontSize="11px"
                      letterSpacing="0.16em"
                      textTransform="uppercase"
                      color="ink.500"
                    >
                      Step {index + 1}
                    </Text>
                    <Text fontSize="16px" fontWeight="800">
                      {step.label}
                    </Text>
                    <Text color="ink.500">{step.eventName}</Text>
                  </Stack>
                  <Box>
                    <Box
                      h="10px"
                      borderRadius="999px"
                      bg="rgba(15,17,21,0.08)"
                      overflow="hidden"
                    >
                      <Box
                        h="100%"
                        w={`${Math.min(
                          100,
                          Number(step.conversion.replace("%", ""))
                        )}%`}
                        bg={
                          step.tone === "red"
                            ? "#b83131"
                            : step.tone === "orange"
                            ? "#f36a1d"
                            : "#1f9257"
                        }
                      />
                    </Box>
                    <Text mt="6px" color="ink.500">
                      users {step.users} / events {step.events}
                    </Text>
                  </Box>
                  <HStack gap="8px" justify="flex-end">
                    <SentinelStatusChip
                      label={step.conversion}
                      tone={step.tone}
                    />
                    <Text color="ink.500">drop {step.dropoff}</Text>
                  </HStack>
                </Grid>
              </Box>
            ))}
          </Stack>
        ) : (
          <AnalyticsEmptyState label="当前窗口暂无完整 consumer 激活链路" />
        )}
      </SurfaceCard>
    </AnalyticsPageShell>
  );
}
