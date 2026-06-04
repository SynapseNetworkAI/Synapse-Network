"use client";

import { Box, Flex, Heading, Stack, Text } from "@chakra-ui/react";

import { SentinelStatusChip, SurfaceCard } from "@/components/console-ui";

import type { RoleSnapshot } from "./user-presenters";

export function RoleTemplatePanel({
  roleSnapshots,
}: Readonly<{ roleSnapshots: RoleSnapshot[] }>) {
  return (
    <Stack gap="16px">
      <SurfaceCard
        eyebrow="Role Templates"
        title="角色模板负载"
        description="让 operator 直接看到每个模板挂了多少人、多少权限，避免角色定义和实际分配脱节。"
      >
        <Stack gap="12px">
          {roleSnapshots.map((role) => (
            <Box
              key={role.roleKey}
              borderRadius="22px"
              p="16px"
              bg="rgba(255,255,255,0.74)"
              border="1px solid rgba(99,92,82,0.10)"
            >
              <Flex justify="space-between" align="center" gap="12px">
                <Stack gap="2px">
                  <Heading size="sm">{role.roleName}</Heading>
                  <Text color="ink.500">{role.roleKey}</Text>
                </Stack>
                <SentinelStatusChip
                  label={role.status}
                  tone={role.status === "active" ? "green" : "gray"}
                />
              </Flex>
              <Text mt="10px" color="ink.500">
                {role.assignedUsers} assigned · {role.permissionCount}{" "}
                permissions
              </Text>
            </Box>
          ))}
        </Stack>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Operator Guardrails"
        title="身份控制基线"
        description="账号目录只负责身份和角色分配，真正的高风险动作仍由审批、MFA 和执行队列共同约束。"
      >
        <Stack gap="12px">
          <Text color="ink.500">
            高权限账号必须绑定 MFA，避免浏览器 session 成为唯一防线。
          </Text>
          <Text color="ink.500">
            角色模板决定可见 surface，审批与 reviewer
            权限决定是否真的能触发资金动作。
          </Text>
          <Text color="ink.500">
            禁用账号优先保留审计轨迹，不做硬删除，确保执行历史和登录轨迹可回放。
          </Text>
        </Stack>
      </SurfaceCard>
    </Stack>
  );
}
