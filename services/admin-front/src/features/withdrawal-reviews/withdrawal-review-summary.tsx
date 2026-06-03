import { Box, Grid, Heading, Stack, Text } from "@chakra-ui/react";

import {
  MetricCard,
  SentinelStatusChip,
  SurfaceCard,
} from "@/components/console-ui";
import { formatUsdc } from "@/lib/admin-console";

import type {
  buildWithdrawReasonClusters,
  buildWithdrawReviewMetrics,
} from "./review-presenters";

type WithdrawalReviewMetrics = ReturnType<typeof buildWithdrawReviewMetrics>;
type WithdrawalReasonCluster = ReturnType<
  typeof buildWithdrawReasonClusters
>[number];

export function WithdrawalReviewMetricGrid({
  metrics,
}: Readonly<{ metrics: WithdrawalReviewMetrics }>) {
  return (
    <Grid
      templateColumns={{
        base: "1fr",
        md: "repeat(2, 1fr)",
        xl: "repeat(4, 1fr)",
      }}
      gap="16px"
    >
      <MetricCard
        label="待处理申请"
        value={metrics.pendingCount}
        meta="当前等待人工确认的提现笔数"
      />
      <MetricCard
        label="待确认金额"
        value={formatUsdc(metrics.totalAmount)}
        meta="当前列表涉及的提现总额"
      />
      <MetricCard
        label="优先处理"
        value={metrics.redCount}
        meta="建议先处理的高关注申请"
      />
      <MetricCard
        label="已关联流水"
        value={metrics.linkedCount}
        meta={`另有 ${metrics.yellowCount} 笔需要持续关注`}
      />
    </Grid>
  );
}

export function WithdrawalReviewInsights({
  reasonClusters,
}: Readonly<{ reasonClusters: WithdrawalReasonCluster[] }>) {
  return (
    <Grid templateColumns={{ base: "1fr", xl: "0.92fr 1.08fr" }} gap="16px">
      <WithdrawalReasonClusters reasonClusters={reasonClusters} />
      <WithdrawalReviewGuidance />
    </Grid>
  );
}

function WithdrawalReasonClusters({
  reasonClusters,
}: Readonly<{ reasonClusters: WithdrawalReasonCluster[] }>) {
  return (
    <SurfaceCard
      eyebrow="原因分布"
      title="常见触发原因"
      description="先看哪些原因最集中，再决定是逐笔处理，还是统一排查某一类问题。"
    >
      <Stack gap="12px">
        {reasonClusters.map((cluster) => (
          <Box
            key={cluster.code}
            borderRadius="22px"
            p="16px"
            bg="rgba(255,255,255,0.74)"
            border="1px solid rgba(99,92,82,0.10)"
          >
            <Stack direction="row" justify="space-between" align="center">
              <Heading size="sm">{cluster.code}</Heading>
              <SentinelStatusChip
                label={`${cluster.count} 笔`}
                tone={cluster.code === "manual_review" ? "gray" : "orange"}
              />
            </Stack>
          </Box>
        ))}
      </Stack>
    </SurfaceCard>
  );
}

function WithdrawalReviewGuidance() {
  return (
    <SurfaceCard
      eyebrow="处理说明"
      title="操作注意事项"
      description="提交结果前，请确认判断依据和备注完整，方便后续追踪、复核和对外沟通。"
    >
      <Stack gap="12px">
        {WITHDRAWAL_REVIEW_GUIDANCE_ITEMS.map((item) => (
          <Box
            key={item.title}
            borderRadius="22px"
            p="16px"
            bg="rgba(255,255,255,0.74)"
            border="1px solid rgba(99,92,82,0.10)"
          >
            <Heading size="sm">{item.title}</Heading>
            <Text mt="8px" color="ink.500">
              {item.description}
            </Text>
          </Box>
        ))}
      </Stack>
    </SurfaceCard>
  );
}

const WITHDRAWAL_REVIEW_GUIDANCE_ITEMS = [
  {
    title: "处理结果",
    description:
      "放行后，申请会进入后续出款流程；驳回后，会回到可用状态并保留处理记录。",
  },
  {
    title: "备注要求",
    description:
      "无论通过还是驳回，都建议写清楚核实结果和处理原因，方便后续查询与复盘。",
  },
  {
    title: "页面定位",
    description:
      "这里专门处理需要人工确认的提现申请，避免和其他审批事项混在一起，影响判断效率。",
  },
];
