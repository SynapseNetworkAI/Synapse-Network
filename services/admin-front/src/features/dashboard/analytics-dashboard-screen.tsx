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
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import {
  DataTable,
  MessageBanner,
  SentinelStatusChip,
  SurfaceCard,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
} from "@/components/console-ui";
import {
  buildConsumerFunnelSteps,
  buildConsumerFunnelSummaryCards,
  buildDataQualityLagCards,
  buildDataQualitySchemaIssueRows,
  buildDataQualitySignalCards,
  buildDistributionItems,
  buildInvocationSignalCards,
  buildInvocationVolumeCards,
  buildMoneyFlowContextCards,
  buildMoneyFlowSignalCards,
  buildProviderSettlementCards,
  buildProviderSignalCards,
  buildRiskContextCards,
  buildRiskSignalCards,
  summarizeCriticalFreshness,
  summarizeSourceCoverage,
  type AnalyticsSignalCard,
} from "@/features/dashboard/analytics-presenters";
import { formatDateTime, formatUsdc } from "@/lib/admin-console";
import type {
  AdminProfile,
  AnalyticsConsumerFunnel,
  AnalyticsDataQuality,
  AnalyticsDataQualityWindow,
  AnalyticsDistributionItem,
  AnalyticsInvocationRevenue,
  AnalyticsMoneyFlow,
  AnalyticsProviderRevenue,
  AnalyticsRiskHealth,
  AnalyticsWindow,
} from "@/services/admin-api";
import {
  getAnalyticsConsumerFunnel,
  getAnalyticsDataQuality,
  getAnalyticsInvocationRevenue,
  getAnalyticsMoneyFlow,
  getAnalyticsProviderRevenue,
  getAnalyticsRiskHealth,
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
const DATA_QUALITY_WINDOWS: AnalyticsDataQualityWindow[] = ["1h", "24h"];

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

function LoadingOrError({
  loading,
  error,
  loadingTitle,
}: Readonly<{
  loading: boolean;
  error: string | null;
  loadingTitle: string;
}>) {
  if (loading) {
    return (
      <ControlPlaneLoadingScreen
        title={loadingTitle}
        message="正在读取 ClickHouse 聚合与 gateway-admin 投影..."
      />
    );
  }
  if (error) {
    return <MessageBanner kind="error" message={error} />;
  }
  return null;
}

function DistributionTable({
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

function DepositFailureSamplesTable({
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

function BudgetBlocksPanel({
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

function BudgetBlockSamplesTable({
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

export function AnalyticsInvocationRevenueScreen({
  admin,
  token,
}: Readonly<AnalyticsScreenProps>) {
  const [windowValue, setWindowValue] = useQueryBackedWindow(
    ANALYTICS_WINDOWS,
    "24h"
  );
  const {
    data: invocation,
    loading,
    error,
  } = useAnalyticsResource(
    token,
    windowValue,
    getAnalyticsInvocationRevenue,
    "Invocation revenue failed to load"
  );
  const primaryCards = useMemo(
    () => buildInvocationSignalCards(invocation),
    [invocation]
  );
  const volumeCards = useMemo(
    () => buildInvocationVolumeCards(invocation),
    [invocation]
  );

  if (loading && !invocation) {
    return (
      <ControlPlaneLoadingScreen
        title="Invocation Revenue Sync"
        message="正在读取调用收入聚合..."
      />
    );
  }

  return (
    <AnalyticsPageShell
      admin={admin}
      eyebrow="Invocation Revenue"
      title="调用与收入"
      description="Gateway 收入 source of truth：quote、invoke、GMV、失败归因和延迟。"
      windows={ANALYTICS_WINDOWS}
      windowValue={windowValue}
      onWindowChange={setWindowValue}
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <SignalGrid cards={[...primaryCards, ...volumeCards]} />
      <SurfaceCard
        eyebrow="Trend"
        title="调用收入趋势"
        description="按后端 bucket 展示 completed、failed、GMV 和 provider net。"
      >
        {invocation?.trend.length ? (
          <DataTable>
            <TableHeaderRow>
              <Th>Bucket</Th>
              <Th>Completed</Th>
              <Th>Failed</Th>
              <Th>GMV</Th>
              <Th>Platform Fee</Th>
              <Th>Provider Net</Th>
            </TableHeaderRow>
            <TableBody>
              {invocation.trend.map((point) => (
                <tr key={point.bucket}>
                  <Td>{point.bucket}</Td>
                  <Td>{point.invokeCompleted}</Td>
                  <Td>{point.invokeFailed}</Td>
                  <Td>{formatUsdc(point.gmvUsdc)} USDC</Td>
                  <Td>{formatUsdc(point.platformFeeUsdc)} USDC</Td>
                  <Td>{formatUsdc(point.providerNetUsdc)} USDC</Td>
                </tr>
              ))}
            </TableBody>
          </DataTable>
        ) : (
          <AnalyticsEmptyState label="当前窗口暂无调用收入趋势" />
        )}
      </SurfaceCard>
      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
        <DistributionTable
          title="Failure Stage"
          items={invocation?.failureStages ?? []}
        />
        <DistributionTable
          title="Error Code"
          items={invocation?.errorCodes ?? []}
        />
      </Grid>
    </AnalyticsPageShell>
  );
}

export function AnalyticsProviderRevenueScreen({
  admin,
  token,
}: Readonly<AnalyticsScreenProps>) {
  const [windowValue, setWindowValue] = useQueryBackedWindow(
    ANALYTICS_WINDOWS,
    "24h"
  );
  const {
    data: provider,
    loading,
    error,
  } = useAnalyticsResource(
    token,
    windowValue,
    getAnalyticsProviderRevenue,
    "Provider revenue failed to load"
  );
  const cards = useMemo(
    () => [
      ...buildProviderSignalCards(provider),
      ...buildProviderSettlementCards(provider),
    ],
    [provider]
  );

  if (loading && !provider) {
    return (
      <ControlPlaneLoadingScreen
        title="Provider Revenue Sync"
        message="正在读取 Provider 收益与结算聚合..."
      />
    );
  }

  return (
    <AnalyticsPageShell
      admin={admin}
      eyebrow="Provider Revenue"
      title="Provider 收益"
      description="观察 Provider 是否真的赚到钱，以及从收入到结算完成是否堵塞。"
      windows={ANALYTICS_WINDOWS}
      windowValue={windowValue}
      onWindowChange={setWindowValue}
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <SignalGrid cards={cards} />
      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
        <SurfaceCard
          eyebrow="Settlement Funnel"
          title="结算 funnel"
          description="provider_revenue_received 到 settlement claim 完成的转化。"
        >
          {provider?.settlementFunnel.length ? (
            <DataTable>
              <TableHeaderRow>
                <Th>Event</Th>
                <Th>Count</Th>
                <Th>Amount</Th>
                <Th>Conversion</Th>
              </TableHeaderRow>
              <TableBody>
                {provider.settlementFunnel.map((item) => (
                  <tr key={item.eventName}>
                    <Td>{item.label}</Td>
                    <Td>{item.count}</Td>
                    <Td>{formatUsdc(item.amountUsdc)} USDC</Td>
                    <Td>{Math.round(item.conversionRate * 1000) / 10}%</Td>
                  </tr>
                ))}
              </TableBody>
            </DataTable>
          ) : (
            <AnalyticsEmptyState label="当前窗口暂无结算 funnel" />
          )}
        </SurfaceCard>
        <SurfaceCard
          eyebrow="Top Providers"
          title="Top providers"
          description="按 gross / net / invoke count 观察头部 Provider。"
        >
          {provider?.topProviders.length ? (
            <DataTable>
              <TableHeaderRow>
                <Th>Provider</Th>
                <Th>Service</Th>
                <Th>Gross</Th>
                <Th>Net</Th>
                <Th>Invokes</Th>
              </TableHeaderRow>
              <TableBody>
                {provider.topProviders.map((item) => (
                  <tr key={`${item.providerId}-${item.serviceId}`}>
                    <Td>{item.providerId}</Td>
                    <Td>{item.serviceId}</Td>
                    <Td>{formatUsdc(item.grossUsdc)} USDC</Td>
                    <Td>{formatUsdc(item.providerNetUsdc)} USDC</Td>
                    <Td>{item.invokeCount}</Td>
                  </tr>
                ))}
              </TableBody>
            </DataTable>
          ) : (
            <AnalyticsEmptyState label="当前窗口暂无 Top providers" />
          )}
        </SurfaceCard>
      </Grid>
    </AnalyticsPageShell>
  );
}

export function AnalyticsMoneyFlowScreen({
  admin,
  token,
}: Readonly<AnalyticsScreenProps>) {
  const [windowValue, setWindowValue] = useQueryBackedWindow(
    ANALYTICS_WINDOWS,
    "24h"
  );
  const {
    data: money,
    loading,
    error,
  } = useAnalyticsResource(
    token,
    windowValue,
    getAnalyticsMoneyFlow,
    "Money flow failed to load"
  );
  const cards = useMemo(
    () => [
      ...buildMoneyFlowSignalCards(money),
      ...buildMoneyFlowContextCards(money),
    ],
    [money]
  );

  if (loading && !money) {
    return (
      <ControlPlaneLoadingScreen
        title="Money Flow Sync"
        message="正在读取充值、提现、退款与 ledger context..."
      />
    );
  }

  return (
    <AnalyticsPageShell
      admin={admin}
      eyebrow="Money Flow"
      title="资金流"
      description="充值、提现、退款、确认延迟与财务投影同屏观察。"
      windows={ANALYTICS_WINDOWS}
      windowValue={windowValue}
      onWindowChange={setWindowValue}
      extraActions={
        <Link href="/finance/reconciliation">
          <Button borderRadius="full" variant="ghost">
            对账明细
          </Button>
        </Link>
      }
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <SignalGrid cards={cards} />
      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
        <DistributionTable
          title="Deposit Errors"
          items={money?.depositErrors ?? []}
        />
        <DistributionTable
          title="Withdrawal Errors"
          items={money?.withdrawalErrors ?? []}
        />
      </Grid>
      <DepositFailureSamplesTable money={money} />
    </AnalyticsPageShell>
  );
}

export function AnalyticsRiskHealthScreen({
  admin,
  token,
}: Readonly<AnalyticsScreenProps>) {
  const [windowValue, setWindowValue] = useQueryBackedWindow(
    ANALYTICS_WINDOWS,
    "24h"
  );
  const searchParams = useSearchParams();
  const {
    data: risk,
    loading,
    error,
  } = useAnalyticsResource(
    token,
    windowValue,
    getAnalyticsRiskHealth,
    "Risk health failed to load"
  );
  const cards = useMemo(
    () => [...buildRiskSignalCards(risk), ...buildRiskContextCards(risk)],
    [risk]
  );
  const focusBudgetBlocks = searchParams.get("focus") === "budget_blocked";

  if (loading && !risk) {
    return (
      <ControlPlaneLoadingScreen
        title="Risk Health Sync"
        message="正在读取风控规则、预算拦截和 Provider 健康..."
      />
    );
  }

  return (
    <AnalyticsPageShell
      admin={admin}
      eyebrow="Risk Health"
      title="风控健康"
      description="把风控规则、预算拦截、Provider 降级和退款原因压缩成值班信号。"
      windows={ANALYTICS_WINDOWS}
      windowValue={windowValue}
      onWindowChange={setWindowValue}
      extraActions={
        <Link href="/risk">
          <Button borderRadius="full" variant="ghost">
            风控工作台
          </Button>
        </Link>
      }
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <SignalGrid cards={cards} />
      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
        <DistributionTable title="Risk Rules" items={risk?.riskRules ?? []} />
        <DistributionTable
          title="Refund Reasons"
          items={risk?.refundReasons ?? []}
        />
      </Grid>
      <Grid templateColumns={{ base: "1fr", xl: "1.15fr 0.85fr" }} gap="16px">
        <BudgetBlocksPanel risk={risk} highlighted={focusBudgetBlocks} />
        <BudgetBlockSamplesTable risk={risk} />
      </Grid>
      <SurfaceCard
        eyebrow="Provider Health"
        title="Degraded providers"
        description="provider_health_degraded 事件里的 provider / service / reason。"
      >
        {risk?.degradedProviders.length ? (
          <DataTable>
            <TableHeaderRow>
              <Th>Provider</Th>
              <Th>Service</Th>
              <Th>Count</Th>
              <Th>Reason</Th>
            </TableHeaderRow>
            <TableBody>
              {risk.degradedProviders.map((item) => (
                <tr key={`${item.providerId}-${item.serviceId}`}>
                  <Td>{item.providerId}</Td>
                  <Td>{item.serviceId}</Td>
                  <Td>{item.count}</Td>
                  <Td>{item.reason}</Td>
                </tr>
              ))}
            </TableBody>
          </DataTable>
        ) : (
          <AnalyticsEmptyState label="当前窗口暂无 degraded providers" />
        )}
      </SurfaceCard>
    </AnalyticsPageShell>
  );
}
