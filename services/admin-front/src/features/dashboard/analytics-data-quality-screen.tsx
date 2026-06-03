"use client";

import { Box, Button, Grid, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
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
  buildDataQualityLagCards,
  buildDataQualitySchemaIssueRows,
  buildDataQualitySignalCards,
  summarizeCriticalFreshness,
  summarizeSourceCoverage,
} from "@/features/dashboard/analytics-presenters";
import {
  AnalyticsEmptyState,
  AnalyticsPageShell,
  SignalGrid,
  type AnalyticsScreenProps,
  useAnalyticsResource,
  useQueryBackedWindow,
} from "@/features/dashboard/analytics-dashboard-screen";
import type { AnalyticsDataQualityWindow } from "@/services/admin-api";
import { getAnalyticsDataQuality } from "@/services/admin-api";

const DATA_QUALITY_WINDOWS: AnalyticsDataQualityWindow[] = ["1h", "24h"];

export function AnalyticsDataQualityScreen({
  admin,
  token,
}: Readonly<AnalyticsScreenProps>) {
  const [windowValue, setWindowValue] = useQueryBackedWindow(
    DATA_QUALITY_WINDOWS,
    "24h"
  );
  const {
    data: dataQuality,
    loading,
    error,
  } = useAnalyticsResource(
    token,
    windowValue,
    getAnalyticsDataQuality,
    "Data quality failed to load"
  );
  const signalCards = useMemo(
    () => [
      ...buildDataQualitySignalCards(dataQuality),
      ...buildDataQualityLagCards(dataQuality),
    ],
    [dataQuality]
  );
  const schemaRows = useMemo(
    () => buildDataQualitySchemaIssueRows(dataQuality),
    [dataQuality]
  );

  if (loading && !dataQuality) {
    return (
      <ControlPlaneLoadingScreen
        title="Data Quality Sync"
        message="正在读取事件质量、隐私检查和 schema issue..."
      />
    );
  }

  return (
    <AnalyticsPageShell
      admin={admin}
      eyebrow="Data Quality"
      title="埋点质量"
      description="上线门槛看板：重复率、隐私检查、source coverage、关键事件新鲜度和 schema 缺失样本。"
      windows={DATA_QUALITY_WINDOWS}
      windowValue={windowValue}
      onWindowChange={setWindowValue}
      extraActions={
        <Link href="/system">
          <Button borderRadius="full" variant="ghost">
            系统状态
          </Button>
        </Link>
      }
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <SignalGrid cards={signalCards} />
      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
        <SurfaceCard
          eyebrow="Coverage"
          title="Source coverage"
          description="frontend / gateway 来源覆盖，用于确认全链路埋点是否同时在线。"
        >
          <Stack gap="12px">
            <Box
              borderRadius="20px"
              p="16px"
              bg="#f7f9fc"
              border="1px solid rgba(15,17,21,0.06)"
            >
              <Text
                fontSize="11px"
                letterSpacing="0.16em"
                textTransform="uppercase"
                color="ink.500"
              >
                Source Coverage
              </Text>
              <Text mt="8px" fontWeight="700">
                {summarizeSourceCoverage(dataQuality)}
              </Text>
            </Box>
            <Box
              borderRadius="20px"
              p="16px"
              bg="#f7f9fc"
              border="1px solid rgba(15,17,21,0.06)"
            >
              <Text
                fontSize="11px"
                letterSpacing="0.16em"
                textTransform="uppercase"
                color="ink.500"
              >
                Critical Freshness
              </Text>
              <Text mt="8px" fontWeight="700">
                {summarizeCriticalFreshness(dataQuality)}
              </Text>
            </Box>
          </Stack>
        </SurfaceCard>
        <SurfaceCard
          eyebrow="Schema"
          title="Schema issue samples"
          description="展示缺失必填字段、schema 不匹配等样本，不输出敏感原始 payload。"
        >
          {schemaRows.length ? (
            <DataTable>
              <TableHeaderRow>
                <Th>Event</Th>
                <Th>Issue</Th>
                <Th>Count</Th>
              </TableHeaderRow>
              <TableBody>
                {schemaRows.map((item) => (
                  <tr key={item.key}>
                    <Td>{item.eventName}</Td>
                    <Td>{item.issue}</Td>
                    <Td>{item.count}</Td>
                  </tr>
                ))}
              </TableBody>
            </DataTable>
          ) : (
            <AnalyticsEmptyState label="当前窗口暂无 schema issue samples" />
          )}
        </SurfaceCard>
      </Grid>
    </AnalyticsPageShell>
  );
}
