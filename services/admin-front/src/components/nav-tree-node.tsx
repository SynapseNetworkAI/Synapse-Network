"use client";

import { Box, Button, Flex, Stack, Text } from "@chakra-ui/react";
import { AnimatePresence, motion } from "framer-motion";
import type { KeyboardEvent } from "react";
import type { NavItem } from "@/lib/navigation";

const MotionBox = motion.create(Box);

type NavTreeNodeVisualState = {
  borderColor: string;
  background: string;
};

type NavTreeNodeProps = {
  item: NavItem;
  depth: number;
  expandedIds: Set<string>;
  activePathIds: Set<string>;
  onToggle: (id: string) => void;
  onNavigate: (href: string) => void;
};

function getNodeVisualState(
  isActive: boolean,
  isInActiveTrail: boolean
): NavTreeNodeVisualState {
  if (isActive) {
    return {
      borderColor: "var(--sidebar-ring)",
      background:
        "color-mix(in oklch, var(--sidebar-primary) 18%, transparent)",
    };
  }

  if (isInActiveTrail) {
    return {
      borderColor: "var(--sidebar-border)",
      background: "var(--sidebar-accent)",
    };
  }

  return {
    borderColor: "transparent",
    background: "transparent",
  };
}

function TreeNodeRow({
  item,
  depth,
  hasChildren,
  isExpanded,
  isActive,
  isInActiveTrail,
  onToggle,
  onNavigate,
  navigablePath,
}: Readonly<{
  item: NavItem;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isActive: boolean;
  isInActiveTrail: boolean;
  onToggle: (id: string) => void;
  onNavigate: (href: string) => void;
  navigablePath?: string;
}>) {
  const leftPadding = 14 + depth * 18;
  const visualState = getNodeVisualState(isActive, isInActiveTrail);
  const activateRow = () => {
    if (navigablePath) {
      onNavigate(navigablePath);
      return;
    }
    if (hasChildren) {
      onToggle(item.id);
    }
  };
  const rowIsInteractive = Boolean(navigablePath || hasChildren);
  const rowRole = navigablePath ? "link" : hasChildren ? "button" : undefined;
  const rowCursor = rowIsInteractive ? "pointer" : undefined;
  const rowTabIndex = rowIsInteractive ? 0 : undefined;
  const rowExpanded = hasChildren && !navigablePath ? isExpanded : undefined;
  const handleRowKeyDown = (event: KeyboardEvent) => {
    if (!rowIsInteractive || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    event.preventDefault();
    activateRow();
  };
  const labelContent = (
    <Flex align="center" gap="10px" minW="0" position="relative" zIndex={1}>
      <Flex
        align="center"
        justify="center"
        w="32px"
        h="32px"
        borderRadius="md"
        bg={
          isActive
            ? "color-mix(in oklch, var(--sidebar-primary) 28%, transparent)"
            : "color-mix(in oklch, var(--sidebar-foreground) 8%, transparent)"
        }
        color={
          isActive
            ? "var(--sidebar-primary)"
            : "color-mix(in oklch, var(--sidebar-foreground) 84%, transparent)"
        }
        fontSize="11px"
        fontWeight="900"
        fontFamily="mono"
        letterSpacing="0.08em"
      >
        {item.icon}
      </Flex>
      <Stack gap="1px" minW="0">
        <Text
          fontSize="13px"
          fontWeight="700"
          color={
            isActive
              ? "var(--sidebar-foreground)"
              : "color-mix(in oklch, var(--sidebar-foreground) 88%, transparent)"
          }
          lineClamp={1}
        >
          {item.title}
        </Text>
        {item.description ? (
          <Text
            fontSize="11px"
            color="color-mix(in oklch, var(--sidebar-foreground) 50%, transparent)"
            lineClamp={1}
          >
            {item.description}
          </Text>
        ) : null}
      </Stack>
    </Flex>
  );

  const labelControl = navigablePath ? (
    <a
      href={navigablePath}
      onClick={(event) => {
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onNavigate(navigablePath);
      }}
      data-nav-id={item.id}
      data-nav-path={navigablePath}
      style={{ display: "flex", flex: 1, minWidth: 0, textDecoration: "none" }}
    >
      {labelContent}
    </a>
  ) : (
    <Box cursor={rowCursor ?? "default"} display="flex" flex="1" minW="0">
      {labelContent}
    </Box>
  );

  return (
    <Flex
      align="center"
      justify="space-between"
      gap="12px"
      pl={`${leftPadding}px`}
      pr="12px"
      py="11px"
      borderRadius="md"
      border="1px solid"
      borderColor={visualState.borderColor}
      bg={visualState.background}
      boxShadow={
        isActive
          ? "inset 0 0 0 1px color-mix(in oklch, var(--sidebar-primary) 26%, transparent), 0 0 20px color-mix(in oklch, var(--sidebar-primary) 16%, transparent)"
          : "none"
      }
      position="relative"
      cursor={rowCursor}
      data-nav-row-id={item.id}
      data-nav-row-path={navigablePath}
      role={rowRole}
      tabIndex={rowTabIndex}
      aria-expanded={rowExpanded}
      onClick={activateRow}
      onKeyDown={handleRowKeyDown}
      _hover={{
        bg: isActive
          ? "color-mix(in oklch, var(--sidebar-primary) 20%, transparent)"
          : "var(--sidebar-accent)",
      }}
    >
      <Box
        position="absolute"
        left={`${8 + depth * 18}px`}
        top="6px"
        bottom="6px"
        w="1px"
        bg={depth > 0 ? "var(--sidebar-border)" : "transparent"}
      />
      {labelControl}
      {hasChildren ? (
        <Button
          variant="ghost"
          minW="28px"
          h="28px"
          p="0"
          borderRadius="full"
          color="color-mix(in oklch, var(--sidebar-foreground) 72%, transparent)"
          _hover={{
            bg: "color-mix(in oklch, var(--sidebar-foreground) 8%, transparent)",
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggle(item.id);
          }}
          aria-label={isExpanded ? "Collapse section" : "Expand section"}
        >
          <Box
            transform={isExpanded ? "rotate(90deg)" : "rotate(0deg)"}
            transition="transform 0.18s ease"
          >
            ›
          </Box>
        </Button>
      ) : null}
    </Flex>
  );
}

export function NavTreeNode({
  item,
  depth,
  expandedIds,
  activePathIds,
  onToggle,
  onNavigate,
}: Readonly<NavTreeNodeProps>) {
  const hasChildren = Boolean(item.children?.length);
  const navigablePath = item.nodeType === "category" ? undefined : item.path;
  const isExpanded = expandedIds.has(item.id);
  const isActive = item.path ? activePathIds.has(item.id) : false;
  const isInActiveTrail = activePathIds.has(item.id);

  return (
    <Stack gap="6px">
      <TreeNodeRow
        item={item}
        depth={depth}
        hasChildren={hasChildren}
        isExpanded={isExpanded}
        isActive={isActive}
        isInActiveTrail={isInActiveTrail}
        onToggle={onToggle}
        onNavigate={onNavigate}
        navigablePath={navigablePath}
      />

      <AnimatePresence initial={false}>
        {hasChildren && isExpanded ? (
          <MotionBox
            key={`${item.id}-children`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            overflow="hidden"
          >
            <Stack gap="6px" pt="4px">
              {item.children?.map((child) => (
                <NavTreeNode
                  key={child.id}
                  item={child}
                  depth={depth + 1}
                  expandedIds={expandedIds}
                  activePathIds={activePathIds}
                  onToggle={onToggle}
                  onNavigate={onNavigate}
                />
              ))}
            </Stack>
          </MotionBox>
        ) : null}
      </AnimatePresence>
    </Stack>
  );
}
