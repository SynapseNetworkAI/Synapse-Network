"use client";

import { Avatar, Box, Button, Flex, Grid, Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { filterNavigation, findNavPathByPath, resolveExpandedNavigationIds, type NavItem } from "@/lib/navigation";
import { logoutAdmin, type AdminProfile } from "@/services/admin-api";

import { NavSearchBar } from "@/components/nav-search-bar";
import { NavTreeNode } from "@/components/nav-tree-node";

type AdminSidebarProps = {
  admin: AdminProfile;
  navigation: NavItem[];
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

export function AdminSidebar({ admin, navigation, mobileOpen, onCloseMobile }: Readonly<AdminSidebarProps>) {
  const pathname = usePathname();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [manualExpandedIds, setManualExpandedIds] = useState<string[]>([]);
  const [manualCollapsedIds, setManualCollapsedIds] = useState<string[]>([]);

  const adminInitials = useMemo(() => admin.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(), [admin.displayName]);
  const activePath = useMemo(() => findNavPathByPath(navigation, pathname), [navigation, pathname]);
  const filteredResult = useMemo(() => filterNavigation(navigation, query), [navigation, query]);

  useEffect(() => {
    const activeAncestorIds = new Set(activePath.slice(0, -1));
    setManualCollapsedIds((current) => current.filter((id) => !activeAncestorIds.has(id)));
  }, [pathname, activePath]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target;
      const isEditable = target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditable) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }

    globalThis.addEventListener("keydown", handleShortcut);
    return () => globalThis.removeEventListener("keydown", handleShortcut);
  }, []);

  async function handleLogout() {
    try {
      await logoutAdmin("cookie-session");
    } finally {
      router.replace("/login");
    }
  }

  function handleToggle(id: string) {
    const isExpanded = expandedIds.has(id);

    setManualExpandedIds((current) => isExpanded ? current.filter((entry) => entry !== id) : Array.from(new Set([...current, id])));
    setManualCollapsedIds((current) => isExpanded ? Array.from(new Set([...current, id])) : current.filter((entry) => entry !== id));
  }

  const expandedIds = new Set(resolveExpandedNavigationIds({
    manualExpandedIds,
    manualCollapsedIds,
    activePath,
    filteredExpandedIds: filteredResult.expandedIds,
    query,
  }));
  const activePathIds = new Set(activePath);

  return (
    <Box
      bg="#0a0d12"
      color="#f4f7fb"
      borderRadius={{ base: "0", lg: "30px" }}
      minH={{ base: "100dvh", lg: "calc(100dvh - 32px)" }}
      p={{ base: "18px", lg: "22px" }}
      position={{ base: "fixed", lg: "sticky" }}
      top={{ base: 0, lg: "16px" }}
      left={{ base: mobileOpen ? 0 : "-100%", lg: "auto" }}
      w={{ base: "100%", lg: "340px" }}
      transition="left 0.24s ease"
      zIndex={30}
      display="flex"
      flexDirection="column"
      gap="14px"
      boxShadow="0 30px 80px rgba(7, 10, 15, 0.38)"
      border="1px solid rgba(255,255,255,0.05)"
      backgroundImage="radial-gradient(circle at top left, rgba(34, 211, 238, 0.12), transparent 26%), linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(10,13,18,0) 24%)"
      overflow="hidden"
    >
      <Flex justify="space-between" align="flex-start" gap="10px">
        <Stack gap="4px">
          <Flex align="center" gap="10px">
            <Grid placeItems="center" w="46px" h="46px" borderRadius="14px" bg="rgba(34, 211, 238, 0.08)" color="#b3ebff" border="1px solid rgba(34, 211, 238, 0.24)" fontSize="12px" fontWeight="800" letterSpacing="0.18em">SN</Grid>
            <Stack gap="1px">
              <Text fontSize="11px" letterSpacing="0.22em" textTransform="uppercase" color="rgba(244,247,251,0.52)">Synapse Network</Text>
              <Heading size="md" letterSpacing="-0.02em">Admin Sentinel</Heading>
            </Stack>
          </Flex>
        </Stack>
        <Button display={{ base: "inline-flex", lg: "none" }} variant="ghost" color="#f4f7fb" onClick={onCloseMobile}>关闭</Button>
      </Flex>

      <NavSearchBar value={query} onChange={setQuery} inputRef={inputRef} />

      <Box flex="1" overflowY="auto" pr="4px" css={{ scrollbarWidth: "thin" }}>
        <Stack gap="10px">
          {filteredResult.filtered.map((item) => (
            <NavTreeNode
              key={item.id}
              item={item}
              depth={0}
              expandedIds={expandedIds}
              activePathIds={activePathIds}
              onToggle={handleToggle}
              onNavigate={onCloseMobile}
            />
          ))}
          {filteredResult.filtered.length === 0 ? (
            <Box borderRadius="16px" border="1px solid rgba(255,255,255,0.06)" bg="rgba(255,255,255,0.03)" p="16px">
              <Text fontWeight="700">No matching modules</Text>
              <Text mt="4px" fontSize="13px" color="rgba(244,247,251,0.58)">调整关键词后会重新匹配所有层级，并展开相关路径。</Text>
            </Box>
          ) : null}
        </Stack>
      </Box>

      <Stack gap="10px">
        <Button justifyContent="flex-start" variant="ghost" color="#f4f7fb" borderRadius="16px" bg="rgba(255,255,255,0.04)">SETTINGS</Button>
        <Button justifyContent="flex-start" variant="ghost" color="#f4f7fb" borderRadius="16px" bg="rgba(255,255,255,0.04)" onClick={() => void handleLogout()}>LOGOUT</Button>
      </Stack>

      <Box borderRadius="20px" bg="rgba(255,255,255,0.05)" border="1px solid rgba(255,255,255,0.08)" p="16px">
        <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="rgba(244,247,251,0.46)">Active Session</Text>
        <Flex mt="10px" align="center" gap="12px">
          <Avatar.Root size="md" colorPalette="green" variant="solid">
            <Avatar.Fallback name={admin.displayName}>{adminInitials}</Avatar.Fallback>
          </Avatar.Root>
          <Stack gap="1px">
            <Heading size="sm">{admin.displayName}</Heading>
            <Text color="rgba(244,247,251,0.68)">{admin.email}</Text>
          </Stack>
        </Flex>
        <HStack mt="12px" gap="8px" wrap="wrap">
          <Box px="10px" py="6px" borderRadius="full" bg="rgba(255,255,255,0.08)">{admin.role}</Box>
          <Box px="10px" py="6px" borderRadius="full" bg="rgba(31,146,87,0.18)">{admin.permissions.length} permissions</Box>
        </HStack>
      </Box>
    </Box>
  );
}