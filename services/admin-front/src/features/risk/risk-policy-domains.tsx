"use client";

import { Box, Heading, Stack, Text } from "@chakra-ui/react";

import { SurfaceCard } from "@/components/console-ui";

const riskPolicyDomains = [
  [
    "高风险充值",
    "发现链上确认成功但链下入账异常、来源地址异常或大额集中充值。",
  ],
  ["大额提现审核", "超阈值提现统一进入 reviewer 决策和 execution queue。"],
  ["黑白名单维护", "未来接受控名单命令，不让名单变更绕过审批。"],
  ["风险标签处置", "对账户打标、解除标记和策略豁免进行审计留痕。"],
];

export function RiskPolicyDomains() {
  return (
    <SurfaceCard
      eyebrow="Policy Domains"
      title="风控模块树"
      description="风险策略、名单维护和高风险资金动作不应该散在脚本里，而应该在控制面编排。"
    >
      <Stack gap="12px">
        {riskPolicyDomains.map(([title, description]) => (
          <Box
            key={title}
            borderRadius="20px"
            p="16px"
            bg="rgba(255,255,255,0.74)"
            border="1px solid rgba(99,92,82,0.10)"
          >
            <Heading size="sm">{title}</Heading>
            <Text mt="8px" color="ink.500">
              {description}
            </Text>
          </Box>
        ))}
      </Stack>
    </SurfaceCard>
  );
}
