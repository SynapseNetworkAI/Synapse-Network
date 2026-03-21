"use client";

import { Box, Grid, Heading, HStack, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import type { ReactNode } from "react";

import { MessageBanner, SentinelStatusChip, SurfaceCard } from "@/components/console-ui";
import { buildDiagnosticActionCards, buildDiagnosticSignalCards, getDiagnosticTone } from "@/features/diagnostics/diagnostic-presenters";
import { formatDateTime } from "@/lib/admin-console";
import type { DashboardDiagnostics } from "@/services/admin-api";

type DiagnosticsPanelProps = Readonly<{
  eyebrow: string;
  title: string;
  descriptionFallback: string;
  diagnostics: DashboardDiagnostics | null;
  error?: string | null;
  primaryAction?: ReactNode;
  statusHint?: string;
  extraContent?: ReactNode;
  signalColumnsMd?: number;
  actionColumnsMd?: number;
  cardRadius?: string;
  cardPadding?: string;
  cardBackground?: string;
  cardBorder?: string;
  signalHeadingSize?: "sm" | "md" | "lg";
}>;

export function DiagnosticsPanel({
  eyebrow,
  title,
  descriptionFallback,
  diagnostics,
  error,
  primaryAction,
  statusHint,
  extraContent,
  signalColumnsMd = 2,
  actionColumnsMd = 3,
  cardRadius = "22px",
  cardPadding = "18px",
  cardBackground = "#f7f9fc",
  cardBorder = "1px solid rgba(15,17,21,0.06)",
  signalHeadingSize = "md",
}: DiagnosticsPanelProps) {
  const diagnosticTone = getDiagnosticTone(diagnostics?.overallStatus);
  const diagnosticStamp = diagnostics?.checkedAt ? `Checked ${formatDateTime(diagnostics.checkedAt)}` : "diagnostic pending";
  const signalCards = buildDiagnosticSignalCards(diagnostics?.signals ?? []);
  const actionCards = buildDiagnosticActionCards(diagnostics?.actions ?? []);

  return (
    <SurfaceCard eyebrow={eyebrow} title={title} description={diagnostics?.summary ?? descriptionFallback} stamp={diagnosticStamp}>
      <Stack gap="14px">
        <HStack gap="10px" wrap="wrap">
          {primaryAction}
          <SentinelStatusChip label={diagnostics?.overallStatus ?? "pending"} tone={diagnosticTone} />
        </HStack>
        {statusHint ? <Text color="ink.500">{statusHint}</Text> : null}
        {error ? <MessageBanner kind="error" message={error} /> : null}
        {signalCards.length > 0 ? (
          <Grid templateColumns={{ base: "1fr", md: `repeat(${signalColumnsMd}, 1fr)` }} gap="12px">
            {signalCards.map((signal) => (
              <Box key={signal.key} borderRadius={cardRadius} p={cardPadding} bg={cardBackground} border={cardBorder}>
                <HStack justify="space-between" align="flex-start" gap="12px">
                  <Stack gap="6px">
                    <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">{signal.label}</Text>
                    <Heading size={signalHeadingSize}>{signal.value}</Heading>
                  </Stack>
                  <SentinelStatusChip label={signal.status} tone={signal.tone} />
                </HStack>
                <Text mt="8px" color="ink.500">{signal.detail}</Text>
              </Box>
            ))}
          </Grid>
        ) : null}
        {actionCards.length > 0 ? (
          <Grid templateColumns={{ base: "1fr", md: `repeat(${actionColumnsMd}, 1fr)` }} gap="12px">
            {actionCards.map((action) => (
              <Link key={action.key} href={action.href}>
                <Box borderRadius={cardRadius} p={cardPadding} bg={cardBackground} border={cardBorder} h="100%">
                  <HStack justify="space-between" align="flex-start" gap="12px">
                    <Heading size="sm">{action.label}</Heading>
                    <SentinelStatusChip label={action.status} tone={action.tone} />
                  </HStack>
                  <Text mt="8px" color="ink.500">{action.detail}</Text>
                </Box>
              </Link>
            ))}
          </Grid>
        ) : null}
        {extraContent}
      </Stack>
    </SurfaceCard>
  );
}