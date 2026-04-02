"use client";

import { Avatar, Badge, Box, Button, Flex, Grid, Heading, HStack, Input, Stack, Text } from "@chakra-ui/react";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import { AdminSidebar } from "@/components/admin-sidebar";
import { findNavItemByPath, findNavPathByPath } from "@/lib/navigation";
import { useAdminNavigation } from "@/lib/use-admin-navigation";
import type { AdminProfile } from "@/services/admin-api";

export function AdminLayout({ admin, eyebrow, title, description, actions, children }: Readonly<{ admin: AdminProfile; eyebrow: string; title: string; description: string; actions?: ReactNode; children: ReactNode }>) {
  const pathname = usePathname();
  const { navigation } = useAdminNavigation(admin);
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentItem = useMemo(() => findNavItemByPath(navigation, pathname), [navigation, pathname]);
  const currentPath = useMemo(() => findNavPathByPath(navigation, pathname), [navigation, pathname]);
  const currentSectionTitle = useMemo(() => navigation.find((item) => item.id === currentPath[0])?.title ?? null, [currentPath, navigation]);
  const adminInitials = useMemo(() => admin.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(), [admin.displayName]);
  const hasHeaderCopy = Boolean(eyebrow || title || description);

  return (
    <Box minH="100dvh" bg="linear-gradient(180deg, #f5f7fa 0%, #eef2f6 100%)" color="ink.900">
      <Box px={{ base: "0", lg: "16px" }} py={{ base: "0", lg: "16px" }}>
        <Grid templateColumns={{ base: "1fr", lg: "340px minmax(0, 1fr)" }} gap="16px" alignItems="start">
          <Box display={{ base: "none", lg: "block" }}>
            <AdminSidebar admin={admin} navigation={navigation} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
          </Box>
          <Box minH="100dvh" px={{ base: "16px", md: "22px", lg: "0" }} py={{ base: "16px", lg: "0" }}>
            <Box display={{ base: "block", lg: "none" }} mb="12px">
              <Button onClick={() => setMobileOpen(true)} bg="#0f1115" color="#f4f7fb" borderRadius="full">打开导航</Button>
              {mobileOpen ? <Box position="fixed" inset="0" bg="rgba(20,19,17,0.48)" zIndex={20} onClick={() => setMobileOpen(false)} /> : null}
              <AdminSidebar admin={admin} navigation={navigation} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
            </Box>
            <Stack gap="18px">
              <Box
                position={{ base: "static", lg: "sticky" }}
                top={{ lg: "16px" }}
                zIndex={10}
                borderRadius="28px"
                bg="rgba(255,255,255,0.84)"
                border="1px solid rgba(15,17,21,0.06)"
                boxShadow="panel"
                p={{ base: "16px", md: "18px 20px" }}
                backdropFilter="blur(20px)"
              >
                <Flex justify="space-between" align={{ base: "stretch", xl: "center" }} gap="14px" direction={{ base: "column", xl: "row" }}>
                  <HStack gap="12px" align="stretch" flex="1">
                    <Box flex="1" maxW={{ xl: "420px" }}>
                      <Input placeholder="Search operators, approvals, incidents" bg="#f7f9fc" borderRadius="18px" borderColor="rgba(15,17,21,0.08)" _focusVisible={{ borderColor: "signal.400", boxShadow: "0 0 0 3px rgba(31,146,87,0.16)" }} />
                    </Box>
                    <Badge alignSelf="center" borderRadius="full" px="12px" py="8px" bg="rgba(31,146,87,0.12)" color="signal.700" border="1px solid rgba(31,146,87,0.16)">NODE ACTIVE SENTINEL</Badge>
                  </HStack>
                  <HStack gap="10px" justify={{ base: "space-between", xl: "flex-end" }}>
                    <Button variant="ghost" borderRadius="full">通知</Button>
                    <Button variant="ghost" borderRadius="full">日志</Button>
                    <Flex align="center" gap="10px" px="12px" py="8px" borderRadius="18px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)">
                      <Avatar.Root size="sm" colorPalette="green" variant="subtle">
                        <Avatar.Fallback name={admin.displayName}>{adminInitials}</Avatar.Fallback>
                      </Avatar.Root>
                      <Stack gap="0" minW="0">
                        <Text fontWeight="700" lineClamp={1}>{admin.displayName}</Text>
                        <Text fontSize="12px" color="ink.500" lineClamp={1}>{admin.role}</Text>
                      </Stack>
                    </Flex>
                  </HStack>
                </Flex>
              </Box>

              <Box borderRadius="30px" bg="rgba(255,255,255,0.86)" border="1px solid rgba(15,17,21,0.06)" boxShadow="panel" p={{ base: "20px", md: "24px", xl: "28px" }}>
                <Flex justify="space-between" align={{ base: "flex-start", xl: "center" }} gap="16px" direction={{ base: "column", xl: "row" }}>
                  <Stack gap="6px">
                    {hasHeaderCopy && eyebrow ? <Text fontSize="11px" textTransform="uppercase" letterSpacing="0.22em" color="signal.700">{eyebrow}</Text> : null}
                    {hasHeaderCopy && title ? <Heading size="2xl" letterSpacing="-0.03em">{title}</Heading> : null}
                    {hasHeaderCopy && description ? <Text color="ink.500" maxW="4xl">{description}</Text> : null}
                  </Stack>
                  <Stack direction={{ base: "column", md: "row" }} gap="10px" align={{ base: "stretch", md: "center" }}>
                    <Box minW={{ base: "100%", md: "280px" }} borderRadius="20px" bg="#f7f9fc" border="1px solid rgba(15,17,21,0.06)" p="13px 16px">
                      <Text fontSize="11px" textTransform="uppercase" letterSpacing="0.16em" color="ink.500">Current Surface</Text>
                      <Text fontWeight="700">{currentItem?.title ?? currentSectionTitle ?? "Overview"}</Text>
                    </Box>
                    {actions}
                  </Stack>
                </Flex>
              </Box>

              <Stack gap="18px">{children}</Stack>
            </Stack>
          </Box>
        </Grid>
      </Box>
    </Box>
  );
}