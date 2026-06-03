import { Box, Grid, Stack, Text } from "@chakra-ui/react";

import { SurfaceCard } from "@/components/console-ui";

const REVIEW_HISTORY_USAGE_ITEMS = [
  "业务想确认某笔提现是否已经被放行或驳回。",
  "财务需要区分“已放行但未链上完成”和“已取消 / 已释放”。",
  "reviewer 想快速回看最近自己或同组同学的判断备注。",
];

const REVIEW_HISTORY_HANDOFF_ITEMS = [
  "放行后先进入“已放行”，链上真正完成后再进入“已完成”。",
  "驳回会直接停在“已拒绝”，不再继续出票。",
  "如果票据过期回滚或系统释放锁定金额，会显示“已取消 / 已释放”。",
];

export function ReviewHistoryInsights() {
  return (
    <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
      <SurfaceCard
        eyebrow="How To Use"
        title="什么时候看这里"
        description="审核台处理当下，历史页负责回放结果，不把两种任务混在一个工作台里。"
      >
        <InsightStack items={REVIEW_HISTORY_USAGE_ITEMS} />
      </SurfaceCard>

      <SurfaceCard
        eyebrow="State Handoff"
        title="状态交接说明"
        description="让业务看懂审核动作和提现生命周期之间的关系。"
      >
        <InsightStack muted items={REVIEW_HISTORY_HANDOFF_ITEMS} />
      </SurfaceCard>
    </Grid>
  );
}

function InsightStack({
  items,
  muted = false,
}: Readonly<{ items: string[]; muted?: boolean }>) {
  return (
    <Stack gap="12px">
      {items.map((line) => (
        <Box
          key={line}
          borderRadius="20px"
          p="16px"
          bg="rgba(255,255,255,0.74)"
          border="1px solid rgba(99,92,82,0.10)"
        >
          <Text color={muted ? "ink.500" : undefined}>{line}</Text>
        </Box>
      ))}
    </Stack>
  );
}
