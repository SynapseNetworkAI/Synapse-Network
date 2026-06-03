import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";

import { MetricLabelWithHint, SurfaceCard } from "@/components/console-ui";
import type { ReconciliationDetail } from "@/services/admin-api";

import {
  buildReconciliationDepositEvidenceCards,
  buildReconciliationOutflowEvidenceCards,
  type DrilldownToken,
} from "./reconciliation-presenters";
import {
  DepositRepairSection,
  WithdrawalReviewsSection,
} from "./reconciliation-queue-sections";

type DrilldownHandler = (token: DrilldownToken) => void;
type EvidenceMetricCard = ReturnType<
  typeof buildReconciliationDepositEvidenceCards
>[number];

export function ReconciliationEvidenceGrid({
  detail,
  drilldownLoading,
  onDrilldown,
}: Readonly<{
  detail: ReconciliationDetail;
  drilldownLoading: boolean;
  onDrilldown: DrilldownHandler;
}>) {
  return (
    <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
      <DepositEvidenceCard
        detail={detail}
        drilldownLoading={drilldownLoading}
        onDrilldown={onDrilldown}
      />
      <OutflowEvidenceCard
        detail={detail}
        drilldownLoading={drilldownLoading}
        onDrilldown={onDrilldown}
      />
    </Grid>
  );
}

function DepositEvidenceCard({
  detail,
  drilldownLoading,
  onDrilldown,
}: Readonly<{
  detail: ReconciliationDetail;
  drilldownLoading: boolean;
  onDrilldown: DrilldownHandler;
}>) {
  return (
    <SurfaceCard
      eyebrow="Deposit Evidence"
      title="充值入账证据"
      description="先确认充值链路是否存在链上已确认但账本未完成同步、审批未补齐或修复单积压。"
      actions={
        <Link href="/approvals?type=deposit_repair">
          <Button size="sm" borderRadius="full">
            只看充值修复
          </Button>
        </Link>
      }
    >
      <EvidenceMetricStack
        cards={buildReconciliationDepositEvidenceCards(detail)}
      />
      <DepositRepairSection
        items={detail.depositRepairApprovals}
        drilldownLoading={drilldownLoading}
        onDrilldown={onDrilldown}
      />
    </SurfaceCard>
  );
}

function OutflowEvidenceCard({
  detail,
  drilldownLoading,
  onDrilldown,
}: Readonly<{
  detail: ReconciliationDetail;
  drilldownLoading: boolean;
  onDrilldown: DrilldownHandler;
}>) {
  return (
    <SurfaceCard
      eyebrow="Outflow Evidence"
      title="退款与提现证据"
      description="确认偏差是否来自退款、提现审核或 provider 出账队列，而不是充值同步问题。"
      actions={
        <Link href="/withdrawal-reviews">
          <Button size="sm" borderRadius="full">
            打开提现审核台
          </Button>
        </Link>
      }
    >
      <EvidenceMetricStack
        cards={buildReconciliationOutflowEvidenceCards(detail)}
      />
      <WithdrawalReviewsSection
        items={detail.pendingWithdrawalReviews}
        drilldownLoading={drilldownLoading}
        onDrilldown={onDrilldown}
      />
    </SurfaceCard>
  );
}

function EvidenceMetricStack({
  cards,
}: Readonly<{
  cards: EvidenceMetricCard[];
}>) {
  return (
    <Stack gap="12px" mb="16px">
      {cards.map((card) => (
        <Box
          key={card.key}
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
            <MetricLabelWithHint label={card.label} hint={card.hint} />
          </Box>
          <Heading mt="10px" size="md">
            {card.value}
          </Heading>
          <Text mt="8px" color="ink.500">
            {card.description}
          </Text>
        </Box>
      ))}
    </Stack>
  );
}
