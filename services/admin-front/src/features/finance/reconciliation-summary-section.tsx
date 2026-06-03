import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  MetricCard,
  MetricLabelWithHint,
  SentinelStatusChip,
  SurfaceCard,
} from "@/components/console-ui";
import { formatDateTime, formatUsdc } from "@/lib/admin-console";
import type { ReconciliationDetail } from "@/services/admin-api";

import {
  buildReconciliationHeroCards,
  buildReconciliationSupportingCards,
  describeImbalance,
  resolveReconciliationStamp,
  resolveReconciliationTone,
} from "./reconciliation-presenters";

export function ReconciliationMetricGrid({
  detail,
}: Readonly<{ detail: ReconciliationDetail }>) {
  return (
    <Grid
      templateColumns={{
        base: "1fr",
        md: "repeat(2, 1fr)",
        xl: "repeat(4, 1fr)",
      }}
      gap="16px"
    >
      {buildReconciliationHeroCards(detail).map((card) => (
        <MetricCard
          key={card.key}
          label={<MetricLabelWithHint label={card.label} hint={card.hint} />}
          value={card.value}
          meta={card.meta}
        />
      ))}
    </Grid>
  );
}

export function ReconciliationSummaryGrid({
  detail,
}: Readonly<{ detail: ReconciliationDetail }>) {
  return (
    <Grid templateColumns={{ base: "1fr", xl: "1.1fr 0.9fr" }} gap="16px">
      <InvestigationSummaryCard detail={detail} />
      <SupportingSignalsCard detail={detail} />
    </Grid>
  );
}

function InvestigationSummaryCard({
  detail,
}: Readonly<{ detail: ReconciliationDetail }>) {
  const stamp = resolveReconciliationStamp(detail);
  const tone = resolveReconciliationTone(detail);

  return (
    <SurfaceCard
      eyebrow="Investigation Summary"
      title="偏差调查摘要"
      description={describeImbalance(detail)}
      stamp={stamp}
      actions={
        <Link href="/dashboard">
          <Button size="sm" borderRadius="full">
            返回 Dashboard
          </Button>
        </Link>
      }
    >
      <Stack direction="row" gap="10px" mb="16px" flexWrap="wrap">
        <SentinelStatusChip
          label={detail.reconciliationAlert ? "alert" : "nominal"}
          tone={tone}
        />
        <SentinelStatusChip
          label={detail.gatewayStatus}
          tone={detail.gatewayStatus === "healthy" ? "green" : "red"}
        />
        <SentinelStatusChip
          label={detail.imbalanceDirection.replace("_", " ")}
          tone={tone}
        />
      </Stack>
      <SummaryMarkerCard detail={detail} stamp={stamp} />
    </SurfaceCard>
  );
}

function SummaryMarkerCard({
  detail,
  stamp,
}: Readonly<{ detail: ReconciliationDetail; stamp: string }>) {
  return (
    <SmallSignalCard title="Last reconciliation markers">
      <Text mt="10px" color="ink.500">
        Last reconciliation:{" "}
        {detail.lastReconciliationAt
          ? formatDateTime(detail.lastReconciliationAt)
          : "n/a"}
      </Text>
      <Text mt="6px" color="ink.500">
        Runtime state updated:{" "}
        {detail.runtimeStateUpdatedAt
          ? formatDateTime(detail.runtimeStateUpdatedAt)
          : "n/a"}
      </Text>
      <Text mt="6px" color="ink.500">
        Projection stamp: {stamp}
      </Text>
      {detail.reconciliationLastError ? (
        <Text mt="10px" color="#8f1d1d">
          Last error: {detail.reconciliationLastError}
        </Text>
      ) : null}
    </SmallSignalCard>
  );
}

function SupportingSignalsCard({
  detail,
}: Readonly<{ detail: ReconciliationDetail }>) {
  return (
    <SurfaceCard
      eyebrow="Supporting Signals"
      title="调查支撑信号"
      description="这些卡片用于帮助值班人员快速确认偏差落在哪一层责任面，并决定下一跳去哪一个队列。"
      actions={
        <Link href="/finance">
          <Button size="sm" borderRadius="full">
            打开 Finance Desk
          </Button>
        </Link>
      }
    >
      <Stack gap="12px">
        {buildReconciliationSupportingCards(detail).map((card) => (
          <MetricSignalCard key={card.key} card={card} />
        ))}
        <CapitalContextCard detail={detail} />
      </Stack>
    </SurfaceCard>
  );
}

function MetricSignalCard({
  card,
}: Readonly<{
  card: ReturnType<typeof buildReconciliationSupportingCards>[number];
}>) {
  return (
    <SmallSignalCard
      title={<MetricLabelWithHint label={card.label} hint={card.hint} />}
    >
      <Heading mt="10px" size="md">
        {card.value}
      </Heading>
      <Text mt="8px" color="ink.500">
        {card.description}
      </Text>
    </SmallSignalCard>
  );
}

function CapitalContextCard({
  detail,
}: Readonly<{ detail: ReconciliationDetail }>) {
  return (
    <Box borderRadius="20px" p="16px" bg="rgba(15,17,21,0.94)" color="#f4f7fb">
      <Text
        fontSize="11px"
        letterSpacing="0.18em"
        textTransform="uppercase"
        color="rgba(244,247,251,0.62)"
      >
        Capital context
      </Text>
      <Text mt="10px" color="rgba(244,247,251,0.82)">
        Owner liability: {formatUsdc(detail.ownerLiabilityUsdc)} USDC
      </Text>
      <Text mt="6px" color="rgba(244,247,251,0.82)">
        Provider payable: {formatUsdc(detail.providerPayableUsdc)} USDC
      </Text>
      <Text mt="6px" color="rgba(244,247,251,0.82)">
        Platform fee balance: {formatUsdc(detail.platformFeeBalanceUsdc)} USDC
      </Text>
      <Text mt="6px" color="rgba(244,247,251,0.82)">
        Pending deposits: {detail.pendingDepositCount}
      </Text>
    </Box>
  );
}

function SmallSignalCard({
  children,
  title,
}: Readonly<{ children: ReactNode; title: ReactNode }>) {
  return (
    <Box
      borderRadius="20px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Box
        fontSize="11px"
        letterSpacing="0.18em"
        textTransform="uppercase"
        color="ink.500"
      >
        {title}
      </Box>
      {children}
    </Box>
  );
}
