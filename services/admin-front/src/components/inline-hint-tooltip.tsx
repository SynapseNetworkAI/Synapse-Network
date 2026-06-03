"use client";

import { Box, Flex, Text } from "@chakra-ui/react";
import { useState } from "react";

export function InlineHintTooltip({
  label,
  content,
}: Readonly<{
  label: string;
  content: string;
}>) {
  const [open, setOpen] = useState(false);

  return (
    <Box
      position="relative"
      display="inline-flex"
      alignItems="center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <Flex
        tabIndex={0}
        align="center"
        justify="center"
        w="18px"
        h="18px"
        borderRadius="full"
        border="1px solid var(--border)"
        bg="var(--card)"
        color="var(--muted-foreground)"
        fontSize="10px"
        fontWeight="800"
        cursor="help"
        aria-label={label}
        role="button"
      >
        ?
      </Flex>
      <Box
        position="absolute"
        left="50%"
        bottom="calc(100% + 12px)"
        minW="220px"
        maxW="280px"
        px="12px"
        py="10px"
        borderRadius="var(--radius-lg)"
        border="1px solid var(--border)"
        bg="var(--popover)"
        boxShadow="var(--console-shadow)"
        pointerEvents="none"
        opacity={open ? 1 : 0}
        visibility={open ? "visible" : "hidden"}
        transition="opacity 140ms ease, transform 140ms ease, visibility 140ms ease"
        transform={
          open
            ? "translateX(-50%) translateY(0)"
            : "translateX(-50%) translateY(6px)"
        }
        zIndex={20}
      >
        <Box
          position="absolute"
          left="50%"
          bottom="-6px"
          w="12px"
          h="12px"
          transform="translateX(-50%) rotate(45deg)"
          bg="var(--popover)"
          borderRight="1px solid var(--border)"
          borderBottom="1px solid var(--border)"
        />
        <Text
          fontSize="12px"
          lineHeight="1.55"
          textTransform="none"
          letterSpacing="normal"
          color="var(--popover-foreground)"
        >
          {content}
        </Text>
      </Box>
    </Box>
  );
}
