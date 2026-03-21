"use client";

import { Box, Button, Flex, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import { useRouter } from "next/navigation";

const landingMetrics = [
  { label: "Protected Operators", value: "1,024", meta: "MFA-bound administrator identities" },
  { label: "Approval Velocity", value: "182ms", meta: "median dispatch across control-plane queues" },
  { label: "Ledger Integrity", value: "99.98%", meta: "reconciliation confidence over recent cycles" },
  { label: "Critical Watchpoints", value: "42", meta: "runtime and finance alerts under active review" },
];

const landingModules = [
  { title: "Unified dashboard", detail: "将资金、审批、风控和系统状态折叠成同一个入口，不让操作员在多个站点之间来回跳。" },
  { title: "Server-owned navigation", detail: "菜单可见性完全由 backend 下发，浏览器只消费已经过滤好的 published 配置。" },
  { title: "Step-up controls", detail: "高风险动作统一要求 CSRF + 二次 OTP，避免控制面在关键写操作时失控。" },
];

export default function HomePage() {
  const router = useRouter();

  return (
    <Box minH="100dvh" bg="linear-gradient(180deg, #f3eadf 0%, #fbf7f0 56%, #fffdf9 100%)" px={{ base: "18px", md: "28px", xl: "36px" }} py={{ base: "18px", md: "24px" }}>
      <Stack gap="28px" maxW="1440px" mx="auto">
        <Flex justify="space-between" align={{ base: "flex-start", lg: "center" }} gap="20px" direction={{ base: "column", lg: "row" }}>
          <Stack gap="4px">
            <Text fontSize="11px" letterSpacing="0.22em" textTransform="uppercase" color="brand.700">Synapse Network</Text>
            <Heading size="xl">Admin Console</Heading>
            <Text color="ink.500">A hardened operator surface for settlement, approval, audit, and runtime posture.</Text>
          </Stack>
          <Flex gap="12px" wrap="wrap">
            <Button variant="outline" borderRadius="full" onClick={() => router.push("/login")}>Operator Login</Button>
            <Button bg="brand.500" color="white" borderRadius="full" _hover={{ bg: "brand.600" }} onClick={() => router.push("/dashboard")}>Open Console</Button>
          </Flex>
        </Flex>

        <Grid templateColumns={{ base: "1fr", xl: "1.1fr 0.9fr" }} gap="22px">
          <Box borderRadius="36px" overflow="hidden" p={{ base: "24px", md: "32px" }} bg="#1d1814" color="#f8f0e4" position="relative">
            <Box position="absolute" inset="0" bg="radial-gradient(circle at top right, rgba(243,106,29,0.24), transparent 30%), radial-gradient(circle at bottom left, rgba(255,255,255,0.08), transparent 24%)" />
            <Stack gap="20px" position="relative">
              <Text fontSize="11px" letterSpacing="0.22em" textTransform="uppercase" color="rgba(248,240,228,0.62)">Control Plane Preview</Text>
              <Heading size="3xl" maxW="3xl">Guard money flow like a command floor, not a pile of disconnected CRUD forms.</Heading>
              <Text maxW="2xl" color="rgba(248,240,228,0.74)">这次重构把旧的 CSS shell 整体替换为 Chakra 驱动的新控制台结构，页面围绕 dashboard、审计、执行、配置管理和高风险动作统一编排。</Text>
              <Flex gap="12px" wrap="wrap">
                <Button bg="brand.500" color="white" borderRadius="full" _hover={{ bg: "brand.600" }} onClick={() => router.push("/dashboard")}>进入总览</Button>
                <Button variant="outline" borderRadius="full" color="#f8f0e4" borderColor="rgba(248,240,228,0.18)" onClick={() => router.push("/login")}>绑定管理员会话</Button>
              </Flex>
              <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="14px" pt="10px">
                {landingMetrics.map((metric) => (
                  <Box key={metric.label} borderRadius="24px" p="18px" bg="rgba(255,255,255,0.06)" border="1px solid rgba(255,255,255,0.08)">
                    <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="rgba(248,240,228,0.48)">{metric.label}</Text>
                    <Heading mt="12px" size="2xl">{metric.value}</Heading>
                    <Text mt="8px" color="rgba(248,240,228,0.66)">{metric.meta}</Text>
                  </Box>
                ))}
              </Grid>
            </Stack>
          </Box>

          <Stack gap="18px">
            <Box borderRadius="32px" p="24px" bg="rgba(255,255,255,0.82)" border="1px solid rgba(99,92,82,0.10)" boxShadow="panel">
              <Text fontSize="11px" letterSpacing="0.2em" textTransform="uppercase" color="brand.700">What Changed</Text>
              <Stack mt="14px" gap="14px">
                {landingModules.map((item, index) => (
                  <Flex key={item.title} gap="14px" align="flex-start">
                    <Flex align="center" justify="center" w="36px" h="36px" borderRadius="14px" bg="rgba(243,106,29,0.12)" color="brand.700" fontWeight="700">{String(index + 1).padStart(2, "0")}</Flex>
                    <Stack gap="4px">
                      <Heading size="sm">{item.title}</Heading>
                      <Text color="ink.500">{item.detail}</Text>
                    </Stack>
                  </Flex>
                ))}
              </Stack>
            </Box>

            <Box borderRadius="32px" p="24px" bg="linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(248,243,236,0.92) 100%)" border="1px solid rgba(99,92,82,0.10)" boxShadow="panel">
              <Text fontSize="11px" letterSpacing="0.2em" textTransform="uppercase" color="brand.700">Command Surfaces</Text>
              <Grid templateColumns="repeat(2, minmax(0, 1fr))" gap="12px" mt="14px">
                {[
                  "Dashboard",
                  "Approvals",
                  "Finance",
                  "Risk",
                  "Execution",
                  "Audit",
                  "Users",
                  "Menu Config",
                ].map((item) => (
                  <Box key={item} borderRadius="18px" border="1px solid rgba(99,92,82,0.12)" p="14px" bg="rgba(255,255,255,0.7)">
                    <Text fontWeight="700">{item}</Text>
                  </Box>
                ))}
              </Grid>
            </Box>
          </Stack>
        </Grid>
      </Stack>
    </Box>
  );
}
