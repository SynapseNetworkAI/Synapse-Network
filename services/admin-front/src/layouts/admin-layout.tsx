"use client";

import {
  Avatar,
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  HStack,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import { AdminSidebar } from "@/components/admin-sidebar";
import { AdminNotificationInbox } from "@/components/admin-notification-inbox";
import { findNavItemByPath, findNavPathByPath } from "@/lib/navigation";
import { useAdminNavigation } from "@/lib/use-admin-navigation";
import type { AdminProfile } from "@/services/admin-api";

function MobileNavigation({
  admin,
  navigation,
  mobileOpen,
  onOpen,
  onClose,
}: Readonly<{
  admin: AdminProfile;
  navigation: ReturnType<typeof useAdminNavigation>["navigation"];
  mobileOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}>) {
  return (
    <Box display={{ base: "block", lg: "none" }} mb="12px">
      <Button
        onClick={onOpen}
        bg="shadcn.primary"
        color="shadcn.primaryForeground"
        borderRadius="lg"
      >
        打开导航
      </Button>
      {mobileOpen ? (
        <Box
          position="fixed"
          inset="0"
          bg="rgba(20,19,17,0.48)"
          zIndex={20}
          onClick={onClose}
        />
      ) : null}
      <AdminSidebar
        admin={admin}
        navigation={navigation}
        mobileOpen={mobileOpen}
        onCloseMobile={onClose}
      />
    </Box>
  );
}

function AdminTopBar({
  admin,
  adminInitials,
}: Readonly<{ admin: AdminProfile; adminInitials: string }>) {
  return (
    <Box
      position={{ base: "static", lg: "sticky" }}
      top={{ lg: "16px" }}
      zIndex={10}
      borderRadius="lg"
      bg="shadcn.card"
      border="1px solid"
      borderColor="shadcn.border"
      boxShadow="panelSoft"
      p={{ base: "16px", md: "18px 20px" }}
      backdropFilter="blur(20px)"
      data-testid="admin-console-topbar"
    >
      <Flex
        justify="space-between"
        align={{ base: "stretch", xl: "center" }}
        gap="14px"
        direction={{ base: "column", xl: "row" }}
      >
        <HStack gap="12px" align="stretch" flex="1">
          <Box flex="1" maxW={{ xl: "420px" }}>
            <Input
              placeholder="Search operators, approvals, incidents"
              bg="shadcn.background"
              borderRadius="md"
              borderColor="shadcn.input"
              _focusVisible={{
                borderColor: "shadcn.ring",
                boxShadow:
                  "0 0 0 3px color-mix(in oklch, var(--ring) 24%, transparent)",
              }}
            />
          </Box>
          <Badge
            alignSelf="center"
            borderRadius="full"
            px="12px"
            py="8px"
            bg="shadcn.accent"
            color="shadcn.accentForeground"
            border="1px solid"
            borderColor="shadcn.border"
          >
            NODE ACTIVE SENTINEL
          </Badge>
        </HStack>
        <HStack gap="10px" justify={{ base: "space-between", xl: "flex-end" }}>
          <AdminNotificationInbox />
          <Button variant="ghost" borderRadius="full">
            日志
          </Button>
          <Flex
            align="center"
            gap="10px"
            px="12px"
            py="8px"
            borderRadius="md"
            bg="shadcn.background"
            border="1px solid"
            borderColor="shadcn.border"
          >
            <Avatar.Root size="sm" colorPalette="green" variant="subtle">
              <Avatar.Fallback name={admin.displayName}>
                {adminInitials}
              </Avatar.Fallback>
            </Avatar.Root>
            <Stack gap="0" minW="0">
              <Text fontWeight="700" lineClamp={1}>
                {admin.displayName}
              </Text>
              <Text fontSize="12px" color="ink.500" lineClamp={1}>
                {admin.role}
              </Text>
            </Stack>
          </Flex>
        </HStack>
      </Flex>
    </Box>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  currentSurface,
  actions,
}: Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  currentSurface: string;
  actions?: ReactNode;
}>) {
  const hasHeaderCopy = Boolean(eyebrow || title || description);

  return (
    <Box
      borderRadius="lg"
      bg="shadcn.card"
      border="1px solid"
      borderColor="shadcn.border"
      boxShadow="panel"
      p={{ base: "20px", md: "24px", xl: "28px" }}
      data-testid="admin-console-page-header"
    >
      <Flex
        justify="space-between"
        align={{ base: "flex-start", xl: "center" }}
        gap="16px"
        direction={{ base: "column", xl: "row" }}
      >
        <Stack gap="6px">
          {hasHeaderCopy && eyebrow ? (
            <Text
              fontSize="11px"
              textTransform="uppercase"
              letterSpacing="0.22em"
              color="signal.700"
            >
              {eyebrow}
            </Text>
          ) : null}
          {hasHeaderCopy && title ? (
            <Heading size="2xl" letterSpacing="-0.03em">
              {title}
            </Heading>
          ) : null}
          {hasHeaderCopy && description ? (
            <Text color="ink.500" maxW="4xl">
              {description}
            </Text>
          ) : null}
        </Stack>
        <Stack
          direction={{ base: "column", md: "row" }}
          gap="10px"
          align={{ base: "stretch", md: "center" }}
        >
          <Box
            minW={{ base: "100%", md: "280px" }}
            borderRadius="md"
            bg="shadcn.background"
            border="1px solid"
            borderColor="shadcn.border"
            p="13px 16px"
          >
            <Text
              fontSize="11px"
              textTransform="uppercase"
              letterSpacing="0.16em"
              color="ink.500"
            >
              Current Surface
            </Text>
            <Text fontWeight="700">{currentSurface}</Text>
          </Box>
          {actions}
        </Stack>
      </Flex>
    </Box>
  );
}

export function AdminLayout({
  admin,
  eyebrow,
  title,
  description,
  actions,
  children,
}: Readonly<{
  admin: AdminProfile;
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}>) {
  const pathname = usePathname();
  const { navigation } = useAdminNavigation(admin);
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentItem = useMemo(
    () => findNavItemByPath(navigation, pathname),
    [navigation, pathname]
  );
  const currentPath = useMemo(
    () => findNavPathByPath(navigation, pathname),
    [navigation, pathname]
  );
  const currentSectionTitle = useMemo(
    () => navigation.find((item) => item.id === currentPath[0])?.title ?? null,
    [currentPath, navigation]
  );
  const adminInitials = useMemo(
    () =>
      admin.displayName
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
    [admin.displayName]
  );
  const currentSurface =
    currentItem?.title ?? currentSectionTitle ?? "Overview";

  return (
    <Box
      minH="100dvh"
      bg="linear-gradient(180deg, var(--background) 0%, var(--console-stage) 100%)"
      color="ink.900"
      data-testid="admin-console-shell"
      data-ui-system="shadcn-token-console"
    >
      <Box px={{ base: "0", lg: "16px" }} py={{ base: "0", lg: "16px" }}>
        <Grid
          templateColumns={{ base: "1fr", lg: "340px minmax(0, 1fr)" }}
          gap="16px"
          alignItems="start"
        >
          <Box display={{ base: "none", lg: "block" }}>
            <AdminSidebar
              admin={admin}
              navigation={navigation}
              mobileOpen={mobileOpen}
              onCloseMobile={() => setMobileOpen(false)}
            />
          </Box>
          <Box
            minH="100dvh"
            px={{ base: "16px", md: "22px", lg: "0" }}
            py={{ base: "16px", lg: "0" }}
          >
            <MobileNavigation
              admin={admin}
              navigation={navigation}
              mobileOpen={mobileOpen}
              onOpen={() => setMobileOpen(true)}
              onClose={() => setMobileOpen(false)}
            />
            <Stack gap="18px">
              <AdminTopBar admin={admin} adminInitials={adminInitials} />
              <PageHeader
                eyebrow={eyebrow}
                title={title}
                description={description}
                currentSurface={currentSurface}
                actions={actions}
              />
              <Stack gap="18px">{children}</Stack>
            </Stack>
          </Box>
        </Grid>
      </Box>
    </Box>
  );
}
