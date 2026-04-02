"use client";

import { Box, Button, Flex, Stack, Text } from "@chakra-ui/react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";

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
  onNavigate: () => void;
};

function getNodeVisualState(isActive: boolean, isInActiveTrail: boolean): NavTreeNodeVisualState {
  if (isActive) {
    return {
      borderColor: "rgba(76, 214, 251, 0.4)",
      background: "rgba(34, 211, 238, 0.12)",
    };
  }

  if (isInActiveTrail) {
    return {
      borderColor: "rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.04)",
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
}: Readonly<{
  item: NavItem;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isActive: boolean;
  isInActiveTrail: boolean;
  onToggle: (id: string) => void;
}>) {
  const leftPadding = 14 + depth * 18;
  const visualState = getNodeVisualState(isActive, isInActiveTrail);

  return (
    <Flex
      align="center"
      justify="space-between"
      gap="12px"
      pl={`${leftPadding}px`}
      pr="12px"
      py="11px"
      borderRadius="16px"
      border="1px solid"
      borderColor={visualState.borderColor}
      bg={visualState.background}
      boxShadow={isActive ? "inset 0 0 0 1px rgba(76, 214, 251, 0.18), 0 0 20px rgba(34, 211, 238, 0.12)" : "none"}
      position="relative"
      _hover={{ bg: isActive ? "rgba(34, 211, 238, 0.14)" : "rgba(255,255,255,0.04)" }}
    >
      <Box position="absolute" left={`${8 + depth * 18}px`} top="6px" bottom="6px" w="1px" bg={depth > 0 ? "rgba(255,255,255,0.08)" : "transparent"} />
      <Flex align="center" gap="10px" minW="0" position="relative" zIndex={1}>
        <Flex align="center" justify="center" w="32px" h="32px" borderRadius="10px" bg={isActive ? "rgba(34, 211, 238, 0.18)" : "rgba(255,255,255,0.06)"} color={isActive ? "#b3ebff" : "rgba(244,247,251,0.84)"} fontSize="11px" fontWeight="900" fontFamily="mono" letterSpacing="0.08em">
          {item.icon}
        </Flex>
        <Stack gap="1px" minW="0">
          <Text fontSize="13px" fontWeight="700" color={isActive ? "#f4f7fb" : "rgba(244,247,251,0.88)"} lineClamp={1}>{item.title}</Text>
          {item.description ? <Text fontSize="11px" color="rgba(244,247,251,0.48)" lineClamp={1}>{item.description}</Text> : null}
        </Stack>
      </Flex>
      {hasChildren ? (
        <Button
          variant="ghost"
          minW="28px"
          h="28px"
          p="0"
          borderRadius="full"
          color="rgba(244,247,251,0.72)"
          _hover={{ bg: "rgba(255,255,255,0.08)" }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggle(item.id);
          }}
          aria-label={isExpanded ? "Collapse section" : "Expand section"}
        >
          <Box transform={isExpanded ? "rotate(90deg)" : "rotate(0deg)"} transition="transform 0.18s ease">›</Box>
        </Button>
      ) : null}
    </Flex>
  );
}

export function NavTreeNode({ item, depth, expandedIds, activePathIds, onToggle, onNavigate }: Readonly<NavTreeNodeProps>) {
  const hasChildren = Boolean(item.children?.length);
  const isExpanded = expandedIds.has(item.id);
  const isActive = item.path ? activePathIds.has(item.id) : false;
  const isInActiveTrail = activePathIds.has(item.id);
  const content = <TreeNodeRow item={item} depth={depth} hasChildren={hasChildren} isExpanded={isExpanded} isActive={isActive} isInActiveTrail={isInActiveTrail} onToggle={onToggle} />;

  return (
    <Stack gap="6px">
      {item.path ? (
        <Link href={item.path} onClick={onNavigate}>
          {content}
        </Link>
      ) : (
        <Box onClick={() => hasChildren ? onToggle(item.id) : undefined} cursor={hasChildren ? "pointer" : "default"}>
          {content}
        </Box>
      )}

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