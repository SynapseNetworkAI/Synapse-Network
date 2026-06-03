"use client";

import {
  Avatar,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  HStack,
  Stack,
  Text,
} from "@chakra-ui/react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import {
  filterNavigation,
  findNavPathByPath,
  resolveExpandedNavigationIds,
  type NavItem,
} from "@/lib/navigation";
import { logoutAdmin, type AdminProfile } from "@/services/admin-api";

import { NavSearchBar } from "@/components/nav-search-bar";
import { NavTreeNode } from "@/components/nav-tree-node";

type AdminSidebarProps = {
  admin: AdminProfile;
  navigation: NavItem[];
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

function adminInitialsFor(displayName: string) {
  return displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function sidebarLeft(mobileOpen: boolean) {
  return { base: mobileOpen ? 0 : "-100%", lg: "auto" };
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  );
}

function isSearchShortcut(event: KeyboardEvent) {
  return (
    event.key === "/" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !isEditableTarget(event.target)
  );
}

function updateExpandedList(
  current: string[],
  id: string,
  isExpanded: boolean
) {
  return isExpanded
    ? current.filter((entry) => entry !== id)
    : Array.from(new Set([...current, id]));
}

function updateCollapsedList(
  current: string[],
  id: string,
  isExpanded: boolean
) {
  return isExpanded
    ? Array.from(new Set([...current, id]))
    : current.filter((entry) => entry !== id);
}

function useNavigationSearchShortcut(
  inputRef: RefObject<HTMLInputElement | null>
) {
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!isSearchShortcut(event)) return;
      event.preventDefault();
      inputRef.current?.focus();
    }

    globalThis.addEventListener("keydown", handleShortcut);
    return () => globalThis.removeEventListener("keydown", handleShortcut);
  }, [inputRef]);
}

function SidebarBrand({
  onCloseMobile,
}: Readonly<{ onCloseMobile: () => void }>) {
  return (
    <Flex justify="space-between" align="flex-start" gap="10px">
      <Flex align="center" gap="10px">
        <Grid
          placeItems="center"
          w="46px"
          h="46px"
          borderRadius="md"
          bg="shadcn.sidebarPrimary"
          border="1px solid"
          borderColor="shadcn.sidebarRing"
          overflow="hidden"
        >
          <Image
            src="/brand/synapse-network-icon.svg"
            alt="SynapseNetwork"
            width={36}
            height={36}
          />
        </Grid>
        <Stack gap="1px">
          <Text
            fontSize="11px"
            letterSpacing="0.22em"
            textTransform="uppercase"
            color="color-mix(in oklch, var(--sidebar-foreground) 58%, transparent)"
          >
            Synapse Network
          </Text>
          <Heading size="md" letterSpacing="-0.02em">
            Admin Sentinel
          </Heading>
        </Stack>
      </Flex>
      <Button
        display={{ base: "inline-flex", lg: "none" }}
        variant="ghost"
        color="shadcn.sidebarForeground"
        onClick={onCloseMobile}
      >
        关闭
      </Button>
    </Flex>
  );
}

function SidebarNavigation({
  activePathIds,
  expandedIds,
  filtered,
  onNavigate,
  onToggle,
}: Readonly<{
  activePathIds: Set<string>;
  expandedIds: Set<string>;
  filtered: NavItem[];
  onNavigate: (href: string) => void;
  onToggle: (id: string) => void;
}>) {
  return (
    <Box flex="1" overflowY="auto" pr="4px" css={{ scrollbarWidth: "thin" }}>
      <Stack gap="10px">
        {filtered.map((item) => (
          <NavTreeNode
            key={item.id}
            item={item}
            depth={0}
            expandedIds={expandedIds}
            activePathIds={activePathIds}
            onToggle={onToggle}
            onNavigate={onNavigate}
          />
        ))}
        {filtered.length === 0 ? <SidebarEmptySearch /> : null}
      </Stack>
    </Box>
  );
}

function SidebarEmptySearch() {
  return (
    <Box
      borderRadius="lg"
      border="1px solid"
      borderColor="shadcn.sidebarBorder"
      bg="shadcn.sidebarAccent"
      p="16px"
    >
      <Text fontWeight="700">No matching modules</Text>
      <Text
        mt="4px"
        fontSize="13px"
        color="color-mix(in oklch, var(--sidebar-foreground) 62%, transparent)"
      >
        调整关键词后会重新匹配所有层级，并展开相关路径。
      </Text>
    </Box>
  );
}

function SidebarActions({ onLogout }: Readonly<{ onLogout: () => void }>) {
  return (
    <Stack gap="10px">
      <Button
        justifyContent="flex-start"
        variant="ghost"
        color="shadcn.sidebarForeground"
        borderRadius="lg"
        bg="shadcn.sidebarAccent"
      >
        SETTINGS
      </Button>
      <Button
        justifyContent="flex-start"
        variant="ghost"
        color="shadcn.sidebarForeground"
        borderRadius="lg"
        bg="shadcn.sidebarAccent"
        onClick={onLogout}
      >
        LOGOUT
      </Button>
    </Stack>
  );
}

function SidebarSessionCard({ admin }: Readonly<{ admin: AdminProfile }>) {
  return (
    <Box
      borderRadius="lg"
      bg="shadcn.sidebarAccent"
      border="1px solid"
      borderColor="shadcn.sidebarBorder"
      p="16px"
    >
      <Text
        fontSize="11px"
        letterSpacing="0.18em"
        textTransform="uppercase"
        color="color-mix(in oklch, var(--sidebar-foreground) 50%, transparent)"
      >
        Active Session
      </Text>
      <Flex mt="10px" align="center" gap="12px">
        <Avatar.Root size="md" colorPalette="green" variant="solid">
          <Avatar.Fallback name={admin.displayName}>
            {adminInitialsFor(admin.displayName)}
          </Avatar.Fallback>
        </Avatar.Root>
        <Stack gap="1px">
          <Heading size="sm">{admin.displayName}</Heading>
          <Text color="color-mix(in oklch, var(--sidebar-foreground) 70%, transparent)">
            {admin.email}
          </Text>
        </Stack>
      </Flex>
      <HStack mt="12px" gap="8px" wrap="wrap">
        <Box
          px="10px"
          py="6px"
          borderRadius="full"
          bg="color-mix(in oklch, var(--sidebar-foreground) 10%, transparent)"
        >
          {admin.role}
        </Box>
        <Box
          px="10px"
          py="6px"
          borderRadius="full"
          bg="color-mix(in oklch, var(--sidebar-primary) 22%, transparent)"
        >
          {admin.permissions.length} permissions
        </Box>
      </HStack>
    </Box>
  );
}

export function AdminSidebar({
  admin,
  navigation,
  mobileOpen,
  onCloseMobile,
}: Readonly<AdminSidebarProps>) {
  const pathname = usePathname();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [manualExpandedIds, setManualExpandedIds] = useState<string[]>([]);
  const [manualCollapsedIds, setManualCollapsedIds] = useState<string[]>([]);

  const activePath = useMemo(
    () => findNavPathByPath(navigation, pathname),
    [navigation, pathname]
  );
  const filteredResult = useMemo(
    () => filterNavigation(navigation, query),
    [navigation, query]
  );

  useEffect(() => {
    const activeAncestorIds = new Set(activePath.slice(0, -1));
    setManualCollapsedIds((current) =>
      current.filter((id) => !activeAncestorIds.has(id))
    );
  }, [pathname, activePath]);

  useNavigationSearchShortcut(inputRef);

  async function handleLogout() {
    try {
      await logoutAdmin("cookie-session");
    } finally {
      router.replace("/login");
    }
  }

  function handleToggle(id: string) {
    const isExpanded = expandedIds.has(id);

    setManualExpandedIds((current) =>
      updateExpandedList(current, id, isExpanded)
    );
    setManualCollapsedIds((current) =>
      updateCollapsedList(current, id, isExpanded)
    );
  }

  function handleNavigate(href: string) {
    onCloseMobile();
    router.push(href);
  }

  const expandedIds = new Set(
    resolveExpandedNavigationIds({
      manualExpandedIds,
      manualCollapsedIds,
      activePath,
      filteredExpandedIds: filteredResult.expandedIds,
      query,
    })
  );
  const activePathIds = new Set(activePath);

  return (
    <Box
      bg="shadcn.sidebar"
      color="shadcn.sidebarForeground"
      borderRadius={{ base: "0", lg: "xl" }}
      minH={{ base: "100dvh", lg: "calc(100dvh - 32px)" }}
      p={{ base: "18px", lg: "22px" }}
      position={{ base: "fixed", lg: "sticky" }}
      top={{ base: 0, lg: "16px" }}
      left={sidebarLeft(mobileOpen)}
      w={{ base: "100%", lg: "340px" }}
      transition="left 0.24s ease"
      zIndex={30}
      display="flex"
      flexDirection="column"
      gap="14px"
      boxShadow="0 30px 80px oklch(0.12 0.024 252 / 38%)"
      border="1px solid"
      borderColor="shadcn.sidebarBorder"
      backgroundImage="linear-gradient(180deg, color-mix(in oklch, var(--sidebar-accent) 42%, transparent) 0%, transparent 30%)"
      overflow="hidden"
      data-testid="admin-console-sidebar"
    >
      <SidebarBrand onCloseMobile={onCloseMobile} />
      <NavSearchBar value={query} onChange={setQuery} inputRef={inputRef} />
      <SidebarNavigation
        activePathIds={activePathIds}
        expandedIds={expandedIds}
        filtered={filteredResult.filtered}
        onNavigate={handleNavigate}
        onToggle={handleToggle}
      />
      <SidebarActions onLogout={() => void handleLogout()} />
      <SidebarSessionCard admin={admin} />
    </Box>
  );
}
