"use client";

import {
  Box,
  Button,
  Grid,
  HStack,
  Heading,
  Stack,
  Text,
} from "@chakra-ui/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { AdminShell } from "@/components/admin-shell";
import {
  DataTable,
  SentinelStatusChip,
  SurfaceCard,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
} from "@/components/console-ui";
import {
  buildDistributionItems,
  type AnalyticsSignalCard,
} from "@/features/dashboard/analytics-presenters";
import { formatDateTime, formatUsdc } from "@/lib/admin-console";
import type {
  AdminProfile,
  AnalyticsDistributionItem,
  AnalyticsMoneyFlow,
  AnalyticsRiskHealth,
  AnalyticsWindow,
} from "@/services/admin-api";

export type AnalyticsScreenProps = {
  admin: AdminProfile;
  token: string;
};

type AnalyticsResource<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

export const ANALYTICS_WINDOWS: AnalyticsWindow[] = ["24h", "7d", "30d"];

function resolveWindowParam<TWindow extends string>(
  value: string | null,
  windows: readonly TWindow[],
  fallback: TWindow
): TWindow {
  return windows.includes(value as TWindow) ? (value as TWindow) : fallback;
}

export function useQueryBackedWindow<TWindow extends string>(
  windows: readonly TWindow[],
  fallback: TWindow
): [TWindow, (value: TWindow) => void] {
  const searchParams = useSearchParams();
  const queryWindow = searchParams.get("window");
  const [windowValue, setWindowValue] = useState<TWindow>(() =>
    resolveWindowParam(queryWindow, windows, fallback)
  );

  useEffect(() => {
    setWindowValue(resolveWindowParam(queryWindow, windows, fallback));
  }, [fallback, queryWindow, windows]);

  return [windowValue, setWindowValue];
}

export function useAnalyticsResource<T, TWindow extends string>(
  token: string,
  windowValue: TWindow,
  fetcher: (token: string, windowValue: TWindow) => Promise<T>,
  errorMessage: string
): AnalyticsResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcher(token, windowValue)
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : errorMessage);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [errorMessage, fetcher, token, windowValue]);

  return { data, loading, error };
}

function resolveStatusLabel(tone: AnalyticsSignalCard["tone"]): string {
  if (tone === "red") {
    return "Degraded";
  }
  if (tone === "orange") {
    return "Monitor";
  }
  if (tone === "green") {
    return "Nominal";
  }
  return "Pending";
}

function AnalyticsWindowSwitcher<TWindow extends string>({
  windows,
  value,
  onChange,
}: Readonly<{
  windows: readonly TWindow[];
  value: TWindow;
  onChange: (value: TWindow) => void;
}>) {
  return (
    <>
      {windows.map((item) => (
        <Button
          key={item}
          borderRadius="full"
          variant={value === item ? "solid" : "ghost"}
          bg={value === item ? "#0f1115" : undefined}
          color={value === item ? "#f4f7fb" : undefined}
          onClick={() => onChange(item)}
        >
          {item}
        </Button>
      ))}
    </>
  );
}

export function AnalyticsPageShell<TWindow extends string>({
  admin,
  eyebrow,
  title,
  description,
  windows,
  windowValue,
  onWindowChange,
  children,
  extraActions,
}: Readonly<{
  admin: AdminProfile;
  eyebrow: string;
  title: string;
  description: string;
  windows: readonly TWindow[];
  windowValue: TWindow;
  onWindowChange: (value: TWindow) => void;
  children: ReactNode;
  extraActions?: ReactNode;
}>) {
  return (
    <AdminShell
      admin={admin}
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={
        <>
          <AnalyticsWindowSwitcher
            windows={windows}
            value={windowValue}
            onChange={onWindowChange}
          />
          {extraActions}
          <Link href="/dashboard/analytics">
            <Button borderRadius="full" variant="ghost">
              Analytics 总览
            </Button>
          </Link>
        </>
      }
    >
      {children}
    </AdminShell>
  );
}

export function SignalGrid({
  cards,
}: Readonly<{ cards: AnalyticsSignalCard[] }>) {
  return (
    <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap="12px">
      {cards.map((card) => (
        <Box
          key={card.key}
          borderRadius="22px"
          p="16px"
          bg="#f7f9fc"
          border="1px solid rgba(15,17,21,0.06)"
        >
          <HStack justify="space-between" align="flex-start" gap="10px">
            <Stack gap="4px">
              <Text
                fontSize="11px"
                letterSpacing="0.16em"
                textTransform="uppercase"
                color="ink.500"
              >
                {card.label}
              </Text>
              <Heading size="md" letterSpacing="-0.03em">
                {card.value}
              </Heading>
            </Stack>
            <SentinelStatusChip
              label={resolveStatusLabel(card.tone)}
              tone={card.tone}
            />
          </HStack>
          <Text mt="10px" color="ink.500">
            {card.detail}
          </Text>
        </Box>
      ))}
    </Grid>
  );
}

export function AnalyticsEmptyState({ label }: Readonly<{ label: string }>) {
  return (
    <Box
      borderRadius="20px"
      p="18px"
      bg="#f7f9fc"
      border="1px dashed rgba(15,17,21,0.16)"
    >
      <Text fontWeight="800">{label}</Text>
      <Text mt="6px" color="ink.500">
        当前窗口没有足够事件形成稳定视图，等待后端聚合或切换更长时间窗口。
      </Text>
    </Box>
  );
}

export function DistributionTable({
  title,
  items,
}: Readonly<{ title: string; items: AnalyticsDistributionItem[] }>) {
  const rows = useMemo(() => buildDistributionItems(items), [items]);
  return (
    <SurfaceCard
      eyebrow="Distribution"
      title={title}
      description="按 count / value / rate 展示后端聚合分布，帮助定位异常来源。"
    >
      {rows.length ? (
        <DataTable>
          <TableHeaderRow>
            <Th>Label</Th>
            <Th>Count</Th>
            <Th>Value</Th>
            <Th>Rate</Th>
          </TableHeaderRow>
          <TableBody>
            {rows.map((item) => (
              <tr key={item.key}>
                <Td>{item.label}</Td>
                <Td>{item.count}</Td>
                <Td>{item.value}</Td>
                <Td>{item.rate}</Td>
              </tr>
            ))}
          </TableBody>
        </DataTable>
      ) : (
        <AnalyticsEmptyState label={`${title} 暂无分布数据`} />
      )}
    </SurfaceCard>
  );
}

export function DepositFailureSamplesTable({
  money,
}: Readonly<{ money: AnalyticsMoneyFlow | null }>) {
  const samples = money?.depositFailureSamples ?? [];
  return (
    <SurfaceCard
      eyebrow="Samples"
      title="Recent failed deposits"
      description="展示 deposit_failed 的最近样本，帮助确认失败原因、环境和关联 trace。"
    >
      {samples.length ? (
        <DataTable>
          <TableHeaderRow>
            <Th>Time</Th>
            <Th>Error</Th>
            <Th>Amount</Th>
            <Th>Env</Th>
            <Th>Correlation / Tx</Th>
          </TableHeaderRow>
          <TableBody>
            {samples.map((item, index) => (
              <tr key={`${item.timestamp}-${item.errorCode}-${index}`}>
                <Td>{formatDateTime(item.timestamp)}</Td>
                <Td>{item.errorCode}</Td>
                <Td>{formatUsdc(item.amountUsdc)} USDC</Td>
                <Td>{item.env}</Td>
                <Td>{item.correlationId || item.txHash || "n/a"}</Td>
              </tr>
            ))}
          </TableBody>
        </DataTable>
      ) : (
        <AnalyticsEmptyState label="当前窗口暂无 failed deposit 样本" />
      )}
    </SurfaceCard>
  );
}

export function BudgetBlocksPanel({
  risk,
  highlighted,
}: Readonly<{
  risk: AnalyticsRiskHealth | null;
  highlighted: boolean;
}>) {
  const blocks = risk?.budgetBlocks ?? [];
  return (
    <Box
      id="budget-blocked"
      borderRadius="32px"
      p={highlighted ? "3px" : "0"}
      bg={
        highlighted
          ? "linear-gradient(135deg, rgba(243,106,29,0.68), rgba(31,146,87,0.34))"
          : "transparent"
      }
      boxShadow={highlighted ? "0 0 0 6px rgba(243,106,29,0.10)" : undefined}
      transition="box-shadow 180ms ease, background 180ms ease"
    >
      <SurfaceCard
        eyebrow="Budget Blocks"
        title="Budget blocked breakdown"
        description="按 error_code / service_id / surface 展示预算拦截来源，点击总览告警会聚焦到这里。"
        stamp={highlighted ? "Focused from alert" : undefined}
      >
        {blocks.length ? (
          <DataTable>
            <TableHeaderRow>
              <Th>Error</Th>
              <Th>Service</Th>
              <Th>Surface</Th>
              <Th>Count</Th>
              <Th>Required</Th>
              <Th>Available</Th>
              <Th>Gap</Th>
            </TableHeaderRow>
            <TableBody>
              {blocks.map((item) => (
                <tr key={item.key}>
                  <Td>{item.errorCode}</Td>
                  <Td>{item.serviceId}</Td>
                  <Td>{item.surface}</Td>
                  <Td>{item.count}</Td>
                  <Td>{formatUsdc(item.requiredUsdc)} USDC</Td>
                  <Td>{formatUsdc(item.availableUsdc)} USDC</Td>
                  <Td>{formatUsdc(item.gapUsdc)} USDC</Td>
                </tr>
              ))}
            </TableBody>
          </DataTable>
        ) : (
          <AnalyticsEmptyState label="当前窗口暂无 budget_blocked 聚合" />
        )}
      </SurfaceCard>
    </Box>
  );
}

export function BudgetBlockSamplesTable({
  risk,
}: Readonly<{ risk: AnalyticsRiskHealth | null }>) {
  const samples = risk?.budgetBlockSamples ?? [];
  return (
    <SurfaceCard
      eyebrow="Samples"
      title="Recent budget block samples"
      description="最近 budget_blocked 事件样本，保留 correlationId 用于回查链路。"
    >
      {samples.length ? (
        <DataTable>
          <TableHeaderRow>
            <Th>Time</Th>
            <Th>Error</Th>
            <Th>Service</Th>
            <Th>Required</Th>
            <Th>Available</Th>
            <Th>Correlation</Th>
          </TableHeaderRow>
          <TableBody>
            {samples.map((item, index) => (
              <tr key={`${item.timestamp}-${item.correlationId}-${index}`}>
                <Td>{formatDateTime(item.timestamp)}</Td>
                <Td>{item.errorCode}</Td>
                <Td>{item.serviceId}</Td>
                <Td>{formatUsdc(item.requiredUsdc)} USDC</Td>
                <Td>{formatUsdc(item.availableUsdc)} USDC</Td>
                <Td>{item.correlationId || "n/a"}</Td>
              </tr>
            ))}
          </TableBody>
        </DataTable>
      ) : (
        <AnalyticsEmptyState label="当前窗口暂无 budget_blocked 样本" />
      )}
    </SurfaceCard>
  );
}
