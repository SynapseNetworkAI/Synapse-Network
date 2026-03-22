"use client";

import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";

import { toneFromStatus, toneStyles } from "@/lib/admin-console";

export const nativeFieldStyle: CSSProperties = {
  width: "100%",
  minHeight: "48px",
  padding: "0 14px",
  borderRadius: "14px",
  border: "1px solid rgba(99, 92, 82, 0.18)",
  background: "rgba(255,255,255,0.86)",
  color: "#1d1a17",
  outline: "none",
  fontSize: "14px",
};

export const nativeTextAreaStyle: CSSProperties = {
  ...nativeFieldStyle,
  padding: "12px 14px",
  minHeight: "120px",
};

export function SurfaceCard({ eyebrow, title, description, stamp, actions, children }: Readonly<{
  eyebrow?: string;
  title?: string;
  description?: string;
  stamp?: string;
  actions?: ReactNode;
  children: ReactNode;
}>) {
  return (
    <Box bg="rgba(255,255,255,0.92)" border="1px solid rgba(15,17,21,0.06)" borderRadius="28px" boxShadow="panel" p={{ base: "20px", md: "24px" }}>
      {(eyebrow || title || description || stamp || actions) ? (
        <Box mb="18px">
          <Stack direction={{ base: "column", lg: "row" }} justify="space-between" align={{ base: "flex-start", lg: "center" }} gap="16px">
            <Stack gap="4px">
              {eyebrow ? <Text fontSize="11px" letterSpacing="0.22em" textTransform="uppercase" color="signal.700">{eyebrow}</Text> : null}
              {title ? <Heading size="md" color="ink.900" letterSpacing="-0.02em">{title}</Heading> : null}
              {description ? <Text color="ink.500" maxW="3xl">{description}</Text> : null}
            </Stack>
            <Stack direction={{ base: "column", md: "row" }} gap="10px" align={{ base: "stretch", md: "center" }}>
              {stamp ? <Badge borderRadius="full" px="12px" py="6px" bg="rgba(31,146,87,0.10)" color="signal.700" border="1px solid rgba(31,146,87,0.18)">{stamp}</Badge> : null}
              {actions}
            </Stack>
          </Stack>
        </Box>
      ) : null}
      {children}
    </Box>
  );
}

export function MetricCard({
  label,
  value,
  meta,
  accent,
  href,
  actionLabel,
}: Readonly<{
  label: ReactNode;
  value: string | number;
  meta?: ReactNode;
  accent?: string;
  href?: string;
  actionLabel?: string;
}>) {
  const card = (
    <Box
      borderRadius="26px"
      p="18px"
      bg={accent ?? "linear-gradient(180deg, #ffffff 0%, #f3f6fa 100%)"}
      border="1px solid rgba(15,17,21,0.06)"
      minH="154px"
      overflow="visible"
      position="relative"
      transition="transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease"
      _hover={href ? { transform: "translateY(-2px)", boxShadow: "0 16px 40px rgba(15,17,21,0.08)", borderColor: "rgba(31,146,87,0.24)" } : undefined}
    >
      <Box position="absolute" inset="0" overflow="hidden" borderRadius="inherit" pointerEvents="none">
        <Box position="absolute" right="-20px" top="-24px" w="96px" h="96px" borderRadius="full" bg="rgba(31,146,87,0.06)" />
      </Box>
      <Box position="relative" zIndex={1} fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">{label}</Box>
      <Heading position="relative" zIndex={1} mt="18px" size="2xl" color="ink.900" letterSpacing="-0.04em">{value}</Heading>
      {meta ? <Text position="relative" zIndex={1} mt="10px" color="ink.500">{meta}</Text> : null}
      {href ? <Text position="relative" zIndex={1} mt="12px" fontWeight="700" color="signal.700">{actionLabel ?? "查看明细"}</Text> : null}
    </Box>
  );

  if (!href) {
    return card;
  }

  return (
    <Link href={href} style={{ display: "block", textDecoration: "none" }}>
      {card}
    </Link>
  );
}

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
        border="1px solid rgba(99,92,82,0.18)"
        bg="rgba(255,255,255,0.72)"
        color="ink.500"
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
        borderRadius="14px"
        border="1px solid rgba(15,17,21,0.10)"
        bg="rgba(255,255,255,0.98)"
        boxShadow="0 16px 42px rgba(23, 19, 17, 0.12)"
        pointerEvents="none"
        opacity={open ? 1 : 0}
        visibility={open ? "visible" : "hidden"}
        transition="opacity 140ms ease, transform 140ms ease, visibility 140ms ease"
        transform={open ? "translateX(-50%) translateY(0)" : "translateX(-50%) translateY(6px)"}
        zIndex={20}
      >
        <Box
          position="absolute"
          left="50%"
          bottom="-6px"
          w="12px"
          h="12px"
          transform="translateX(-50%) rotate(45deg)"
          bg="rgba(255,255,255,0.98)"
          borderRight="1px solid rgba(15,17,21,0.10)"
          borderBottom="1px solid rgba(15,17,21,0.10)"
        />
        <Text fontSize="12px" lineHeight="1.55" textTransform="none" letterSpacing="normal" color="ink.700">{content}</Text>
      </Box>
    </Box>
  );
}

export function MetricLabelWithHint({
  label,
  hint,
}: Readonly<{
  label: string;
  hint: string;
}>) {
  return (
    <Flex align="center" gap="8px" wrap="wrap">
      <Text fontSize="inherit" letterSpacing="inherit" textTransform="inherit" color="inherit">{label}</Text>
      <InlineHintTooltip label={`${label} tip`} content={hint} />
    </Flex>
  );
}

export function StatusChip({ value }: Readonly<{ value: string | null | undefined }>) {
  const styles = toneStyles(toneFromStatus(value));
  return <Badge borderRadius="full" px="10px" py="6px" border="1px solid" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" {...styles}>{value ?? "unknown"}</Badge>;
}

export function SentinelStatusChip({ label, tone }: Readonly<{ label: string; tone: "green" | "orange" | "red" | "gray" }>) {
  return <Badge borderRadius="full" px="10px" py="6px" border="1px solid" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" {...toneStyles(tone)}>{label}</Badge>;
}

export function MessageBanner({ kind, message }: Readonly<{ kind: "error" | "success"; message: string }>) {
  const styles = kind === "error"
    ? { bg: "rgba(184, 49, 49, 0.10)", color: "#7d1e1e", borderColor: "rgba(184, 49, 49, 0.16)" }
    : { bg: "rgba(31, 146, 87, 0.10)", color: "#145638", borderColor: "rgba(31, 146, 87, 0.16)" };
  return <Box borderRadius="18px" border="1px solid" p="14px 16px" {...styles}><Text fontWeight="600">{message}</Text></Box>;
}

export function OverlayPanel({ open, title, description, children, onClose, footer }: Readonly<{ open: boolean; title: string; description: string; children: ReactNode; onClose: () => void; footer?: ReactNode }>) {
  if (!open) {
    return null;
  }
  return (
    <Box position="fixed" inset="0" zIndex={40}>
      <Box position="absolute" inset="0" bg="rgba(20,19,17,0.58)" backdropFilter="blur(8px)" onClick={onClose} />
      <Box position="relative" ml="auto" w={{ base: "100%", md: "640px" }} h="100%" bg="#f7f2ea" borderLeft="1px solid rgba(99,92,82,0.12)" boxShadow="-30px 0 80px rgba(20,19,17,0.18)" p={{ base: "20px", md: "28px" }} overflowY="auto">
        <Stack gap="16px">
          <Stack direction={{ base: "column", md: "row" }} justify="space-between" align={{ base: "flex-start", md: "center" }}>
            <Stack gap="4px">
              <Text fontSize="11px" letterSpacing="0.2em" textTransform="uppercase" color="brand.600">Edit Surface</Text>
              <Heading size="lg">{title}</Heading>
              <Text color="ink.500">{description}</Text>
            </Stack>
            <Button variant="ghost" onClick={onClose}>关闭</Button>
          </Stack>
          {children}
          {footer ? <Box>{footer}</Box> : null}
        </Stack>
      </Box>
    </Box>
  );
}

export function FieldBlock({ label, hint, children }: Readonly<{ label: string; hint?: string; children: ReactNode }>) {
  return (
    <Stack gap="8px">
      <Text fontSize="12px" fontWeight="700" color="ink.700" textTransform="uppercase" letterSpacing="0.12em">{label}</Text>
      {children}
      {hint ? <Text color="ink.500" fontSize="13px">{hint}</Text> : null}
    </Stack>
  );
}

export function SearchInput(props: Readonly<{ value: string; onChange: (value: string) => void; placeholder: string }>) {
  return <Input value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder={props.placeholder} bg="rgba(255,255,255,0.85)" borderRadius="16px" borderColor="rgba(99,92,82,0.16)" _focusVisible={{ borderColor: "brand.400", boxShadow: "0 0 0 3px rgba(243,106,29,0.16)" }} />;
}

export function DataTable({ children }: Readonly<{ children: ReactNode }>) {
  return <Box overflowX="auto" borderRadius="22px" border="1px solid rgba(15,17,21,0.06)" bg="rgba(255,255,255,0.96)"><Box as="table" w="100%" fontSize="14px" style={{ borderCollapse: "collapse" }}>{children}</Box></Box>;
}

export function TableHeaderRow({ children }: Readonly<{ children: ReactNode }>) {
  return <Box as="thead" bg="#f4f7fb" color="ink.500" textTransform="uppercase" letterSpacing="0.12em" fontSize="11px"><Box as="tr">{children}</Box></Box>;
}

export function TableBody({ children }: Readonly<{ children: ReactNode }>) {
  return <Box as="tbody">{children}</Box>;
}

export function Th({ children }: Readonly<{ children: ReactNode }>) {
  return <Box as="th" textAlign="left" px="16px" py="14px" fontWeight="700">{children}</Box>;
}

export function Td({ children }: Readonly<{ children: ReactNode }>) {
  return <Box as="td" px="16px" py="14px" borderTop="1px solid rgba(99,92,82,0.08)" verticalAlign="top">{children}</Box>;
}

export function EmptyBlock({ title, description }: Readonly<{ title: string; description: string }>) {
  return <Grid placeItems="center" minH="180px" textAlign="center" p="24px"><Stack gap="6px" maxW="lg"><Heading size="md">{title}</Heading><Text color="ink.500">{description}</Text></Stack></Grid>;
}