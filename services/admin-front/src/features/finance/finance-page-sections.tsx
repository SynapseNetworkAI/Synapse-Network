"use client";

import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";

import {
  DataTable,
  MetricCard,
  MetricLabelWithHint,
  SentinelStatusChip,
  SurfaceCard,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
} from "@/components/console-ui";
import {
  getApprovalStatusLabel,
  getApprovalStatusTone,
  getApprovalTypeLabel,
} from "@/features/approval/approval-presenters";
import { getVaultDeltaTone } from "@/features/finance/finance-presenters";
import { formatDateTime, formatUsdc } from "@/lib/admin-console";
import type { ApprovalItem, FinanceOverview } from "@/services/admin-api";

type FinanceCard = {
  key: string;
  label: string;
  hint: string;
  value: string;
  description: string;
};

function FinanceSmallCard({ card }: Readonly<{ card: FinanceCard }>) {
  return (
    <Box
      borderRadius="22px"
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
  );
}

export function FinanceCardGrid({
  cards,
}: Readonly<{
  cards: FinanceCard[];
}>) {
  return (
    <Grid
      templateColumns={{
        base: "1fr",
        md: "repeat(2, 1fr)",
        xl: "repeat(4, 1fr)",
      }}
      gap="16px"
    >
      {cards.map((card) => (
        <MetricCard
          key={card.key}
          label={<MetricLabelWithHint label={card.label} hint={card.hint} />}
          value={card.value}
          meta={card.description}
        />
      ))}
    </Grid>
  );
}

export function FinanceDeltaVolumeGrid({
  projectedAt,
  deltaCards,
  flowVolumeCards,
}: Readonly<{
  projectedAt: string | null;
  deltaCards: FinanceCard[];
  flowVolumeCards: FinanceCard[];
}>) {
  return (
    <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
      <SurfaceCard
        eyebrow="资金差异"
        title="整体是否对得上"
        description="这里先看平台整体资金是否平衡。若发现差异，再进入对账明细查看原因。"
        stamp={projectedAt ?? "live"}
      >
        <Grid
          templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }}
          gap="12px"
        >
          {deltaCards.map((card) => (
            <FinanceSmallCard key={card.key} card={card} />
          ))}
        </Grid>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="收支规模"
        title="充值、消费、退款、提现"
        description="把今天的主要收支规模放在一起，帮助快速判断当前资金变化是不是符合业务预期。"
        stamp={projectedAt ?? "live"}
      >
        <Grid
          templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }}
          gap="12px"
        >
          {flowVolumeCards.map((card) => (
            <FinanceSmallCard key={card.key} card={card} />
          ))}
        </Grid>
      </SurfaceCard>
    </Grid>
  );
}

export function FinanceAttentionSurface({
  overview,
  pressureCards,
  canOpenPlatformFeeTreasury,
  onOpenPlatformFeeTreasury,
}: Readonly<{
  overview: FinanceOverview;
  pressureCards: FinanceCard[];
  canOpenPlatformFeeTreasury: boolean;
  onOpenPlatformFeeTreasury: () => void;
}>) {
  return (
    <SurfaceCard
      eyebrow="待处理事项"
      title="当前需要关注什么"
      description="这里汇总需要优先留意的资金事项，并提供直接入口，方便继续处理。"
    >
      <Stack gap="12px">
        <Box
          borderRadius="20px"
          p="16px"
          bg="rgba(255,255,255,0.74)"
          border="1px solid rgba(99,92,82,0.10)"
        >
          <Text
            fontSize="11px"
            letterSpacing="0.18em"
            textTransform="uppercase"
            color="ink.500"
          >
            资金差异提醒
          </Text>
          <Stack
            mt="10px"
            direction="row"
            align="center"
            justify="space-between"
          >
            <Heading size="md">
              {formatUsdc(overview.vaultLedgerDeltaUsdc)} USDC
            </Heading>
            <SentinelStatusChip
              label={getVaultDeltaTone(
                overview.vaultLedgerDeltaUsdc
              ).toUpperCase()}
              tone={getVaultDeltaTone(overview.vaultLedgerDeltaUsdc)}
            />
          </Stack>
          <Text mt="8px" color="ink.500">
            如果这里出现明显差异，建议进入对账明细进一步查看原因。
          </Text>
          <Link href="/finance/reconciliation">
            <Button mt="12px" size="sm" borderRadius="full">
              查看对账详情
            </Button>
          </Link>
        </Box>

        {pressureCards.map((card) => (
          <FinanceSmallCard key={card.key} card={card} />
        ))}

        <Link href="/withdrawal-reviews">
          <Button
            borderRadius="full"
            bg="brand.500"
            color="white"
            _hover={{ bg: "brand.600" }}
          >
            进入提现审核
          </Button>
        </Link>
        {canOpenPlatformFeeTreasury ? (
          <Button
            borderRadius="full"
            variant="outline"
            borderColor="rgba(99,92,82,0.22)"
            onClick={onOpenPlatformFeeTreasury}
          >
            Withdraw platform fees
          </Button>
        ) : null}
      </Stack>
    </SurfaceCard>
  );
}

export function FinanceApprovalsSurface({
  approvals,
}: Readonly<{ approvals: ApprovalItem[] }>) {
  return (
    <SurfaceCard
      eyebrow="相关审批"
      title="和资金有关的待办"
      description="把退款、提现、异常入账等相关审批放在这里，方便业务统一查看当前待处理事项。"
    >
      <DataTable>
        <TableHeaderRow>
          <Th>Approval</Th>
          <Th>Type</Th>
          <Th>Amount</Th>
          <Th>Status</Th>
          <Th>Created</Th>
        </TableHeaderRow>
        <TableBody>
          {approvals.map((item) => (
            <Box as="tr" key={item.approvalId}>
              <Td>
                <Text fontWeight="700">{item.approvalId}</Text>
                <Text color="ink.500">{item.requesterRole}</Text>
              </Td>
              <Td>
                <Text>{getApprovalTypeLabel(item.approvalType)}</Text>
                <Text color="ink.500">{item.approvalType}</Text>
              </Td>
              <Td>{formatUsdc(item.amountUsdc)}</Td>
              <Td>
                <SentinelStatusChip
                  label={getApprovalStatusLabel(item.status)}
                  tone={getApprovalStatusTone(item.status)}
                />
              </Td>
              <Td>{formatDateTime(item.createdAt)}</Td>
            </Box>
          ))}
        </TableBody>
      </DataTable>
    </SurfaceCard>
  );
}
