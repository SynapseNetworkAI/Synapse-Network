"use client";

import {
  Box,
  Button,
  Grid,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import {
  MessageBanner,
  MetricCard,
  SurfaceCard,
  nativeFieldStyle,
} from "@/components/console-ui";
import { formatDateTime } from "@/lib/admin-console";
import { useAdminSession } from "@/lib/use-admin-session";
import { useAdminStepUp } from "@/lib/use-admin-step-up";
import {
  getConfigOverview,
  publishBusinessPolicyConfig,
  updateBusinessPolicyConfig,
  type BusinessPolicyConfigResponse,
  type BusinessPolicyOverviewResponse,
  type BusinessPolicyPayload,
  type ConfigOverviewEnvItem,
} from "@/services/admin-api";

type EditablePath =
  | "finance.platformFeeRate"
  | "finance.gatewayRoutingTaxUsdc"
  | "finance.consumerWithdrawFeeUsdc"
  | "finance.consumerDepositMinUsdc"
  | "consumerWithdraw.minUsdc"
  | "consumerWithdraw.manualReviewThresholdUsdc"
  | "consumerWithdraw.maxDailyCount"
  | "consumerWithdraw.maturitySeconds"
  | "risk.withdrawalAutoSingleLimitUsdc"
  | "risk.withdrawalAuto24hLimitUsdc"
  | "risk.withdrawalWindowHours"
  | "reconciliation.alertDeltaUsdc";

type ConfigFieldDefinition = {
  path: EditablePath;
  label: string;
  hint: string;
};

const fieldGroups: Array<{
  title: string;
  description: string;
  fields: ConfigFieldDefinition[];
}> = [
  {
    title: "Finance",
    description: "平台费率、路由税和默认资金参数。",
    fields: [
      {
        path: "finance.platformFeeRate",
        label: "Platform Fee Rate",
        hint: "0 到 1 之间的小数，例如 0.100000。",
      },
      {
        path: "finance.gatewayRoutingTaxUsdc",
        label: "Gateway Routing Tax",
        hint: "每次调用的固定税额，单位 USDC。",
      },
      {
        path: "finance.consumerWithdrawFeeUsdc",
        label: "Consumer Withdraw Fee",
        hint: "Consumer 提现固定手续费，单位 USDC。",
      },
      {
        path: "finance.consumerDepositMinUsdc",
        label: "Consumer Deposit Min",
        hint: "Consumer 充值最小金额，单位 USDC。",
      },
    ],
  },
  {
    title: "Consumer Withdraw",
    description: "自动审核、成熟期和小额提现治理。",
    fields: [
      {
        path: "consumerWithdraw.minUsdc",
        label: "Withdraw Min",
        hint: "Consumer 提现最小金额，单位 USDC。",
      },
      {
        path: "consumerWithdraw.manualReviewThresholdUsdc",
        label: "Manual Review Threshold",
        hint: "达到该阈值后自动进入人工审核。",
      },
      {
        path: "consumerWithdraw.maxDailyCount",
        label: "Max Daily Count",
        hint: "24 小时内允许自动通过的最大笔数。",
      },
      {
        path: "consumerWithdraw.maturitySeconds",
        label: "Maturity Seconds",
        hint: "资金成熟期秒数；prod 不允许被关掉。",
      },
    ],
  },
  {
    title: "Risk",
    description: "Provider 出金自动处理窗口与限额。",
    fields: [
      {
        path: "risk.withdrawalAutoSingleLimitUsdc",
        label: "Auto Single Limit",
        hint: "单笔自动通过上限，单位 USDC。",
      },
      {
        path: "risk.withdrawalAuto24hLimitUsdc",
        label: "Auto 24h Limit",
        hint: "24 小时自动通过累计上限，单位 USDC。",
      },
      {
        path: "risk.withdrawalWindowHours",
        label: "Withdrawal Window Hours",
        hint: "统计自动通过累计金额的窗口时长。",
      },
    ],
  },
  {
    title: "Reconciliation",
    description: "对账 drift 告警阈值。",
    fields: [
      {
        path: "reconciliation.alertDeltaUsdc",
        label: "Alert Delta",
        hint: "链上 vault 与 ledger 差额告警阈值，单位 USDC。",
      },
    ],
  },
];

function clonePolicy(policy: BusinessPolicyPayload): BusinessPolicyPayload {
  return JSON.parse(JSON.stringify(policy)) as BusinessPolicyPayload;
}

function getFieldValue(policy: BusinessPolicyPayload, path: EditablePath): string {
  const [section, key] = path.split(".");
  const scoped = policy[section as keyof BusinessPolicyPayload] as Record<
    string,
    string | number
  >;
  return String(scoped[key] ?? "");
}

function setFieldValue(
  policy: BusinessPolicyPayload,
  path: EditablePath,
  value: string
): BusinessPolicyPayload {
  const next = clonePolicy(policy);
  const [section, key] = path.split(".");
  const scoped = next[section as keyof BusinessPolicyPayload] as Record<
    string,
    string | number
  >;
  scoped[key] = key === "maxDailyCount" || key === "maturitySeconds" || key === "withdrawalWindowHours"
    ? Number(value)
    : value;
  return next;
}

function flattenEnvSummary(
  envSummary: Record<string, Record<string, ConfigOverviewEnvItem>> | undefined
): Array<{ section: string; key: string; item: ConfigOverviewEnvItem }> {
  if (!envSummary) {
    return [];
  }
  return Object.entries(envSummary).flatMap(([section, entries]) =>
    Object.entries(entries).map(([key, item]) => ({ section, key, item }))
  );
}

function buildMetaStamp(config: BusinessPolicyConfigResponse | null): string {
  if (!config) {
    return "not-loaded";
  }
  return `draft v${config.meta.draftVersion} / published v${config.meta.publishedVersion}`;
}

export default function ConfigCenterPage() {
  const { admin, security, token, loading } = useAdminSession();
  const { requestStepUpCode, stepUpModal } = useAdminStepUp({
    enabled: security?.highRiskTotpRequired ?? false,
    issuer: security?.totpIssuer ?? "Synapse Gateway Admin",
  });
  const [overview, setOverview] = useState<BusinessPolicyOverviewResponse | null>(
    null
  );
  const [draftPolicy, setDraftPolicy] = useState<BusinessPolicyPayload | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const canManage = admin?.role === "super_admin";
  const runtimeSummaryRows = useMemo(
    () => flattenEnvSummary(overview?.runtime?.envSummary),
    [overview]
  );

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;

    async function load() {
      try {
        const nextOverview = await getConfigOverview(activeToken);
        if (cancelled) {
          return;
        }
        setOverview(nextOverview);
        setDraftPolicy(clonePolicy(nextOverview.draft.policy));
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "加载配置中心失败"
          );
        }
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading || !admin || bootstrapping || !draftPolicy) {
    return (
      <ControlPlaneLoadingScreen
        title="Business Policy Sync"
        message="正在同步业务策略配置与运行时来源..."
      />
    );
  }

  if (!overview) {
    return (
      <AdminShell
        admin={admin}
        eyebrow="Ops Controls"
        title="配置中心"
        description="业务参数配置中心暂时不可用。"
      >
        <MessageBanner
          kind="error"
          message={error ?? "配置中心运行视图暂时不可用。"}
        />
      </AdminShell>
    );
  }

  async function refreshOverview() {
    if (!token) {
      return;
    }
    const nextOverview = await getConfigOverview(token);
    setOverview(nextOverview);
    setDraftPolicy(clonePolicy(nextOverview.draft.policy));
  }

  async function handleSaveDraft() {
    if (!token || !draftPolicy || !canManage) {
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateBusinessPolicyConfig(token, draftPolicy);
      setOverview((current) =>
        current
          ? {
              ...current,
              draft: updated,
            }
          : current
      );
      setDraftPolicy(clonePolicy(updated.policy));
      setMessage("业务参数草稿已保存。");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "保存草稿失败"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!token || !canManage) {
      return;
    }
    setPublishing(true);
    setError(null);
    setMessage(null);
    try {
      const otpCode = await requestStepUpCode({
        title: "发布业务参数配置",
        description: "发布后 Gateway 会在短 TTL 内切到新的 published 业务策略。",
        confirmLabel: "发布配置",
      });
      const published = await publishBusinessPolicyConfig(token, otpCode);
      await refreshOverview();
      setMessage(
        `业务参数已发布，Gateway 运行时来源=${published.runtime.source ?? "unknown"}。`
      );
    } catch (publishError) {
      if (publishError instanceof Error) {
        setError(publishError.message);
      } else {
        setError("发布配置失败");
      }
    } finally {
      setPublishing(false);
    }
  }

  const draftStamp = buildMetaStamp(overview.draft);
  const runtimeSource =
    overview.runtime?.businessPolicy?.source ??
    overview.runtime?.error?.code ??
    "unknown";

  return (
    <AdminShell
      admin={admin}
      eyebrow="Ops Controls"
      title="配置中心"
      description="这期只把业务策略参数纳入数据库配置中心：draft 可编辑，publish 后生效，infra 和 secret 配置仍保持只读。"
    >
      <Stack gap="16px">
        {error ? <MessageBanner kind="error" message={error} /> : null}
        {message ? <MessageBanner kind="success" message={message} /> : null}

        <Grid
          templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }}
          gap="16px"
        >
          <MetricCard
            label="Draft vs Published"
            value={overview.draft.meta.isDirty ? "Dirty" : "Clean"}
            meta={draftStamp}
          />
          <MetricCard
            label="Runtime Source"
            value={runtimeSource}
            meta={
              overview.runtime.businessPolicy?.updatedAt
                ? `runtime updated ${formatDateTime(
                    overview.runtime.businessPolicy.updatedAt
                  )}`
                : "runtime snapshot not stamped"
            }
          />
          <MetricCard
            label="Access"
            value={canManage ? "Writable" : "Read only"}
            meta={
              canManage
                ? "super_admin can edit draft and publish"
                : "platform_ops_admin can inspect draft, published and runtime"
            }
          />
        </Grid>

        <SurfaceCard
          eyebrow="Business Policy Draft"
          title="业务参数草稿"
          description="保存只更新 draft；真正影响 Gateway 运行时决策的只有 published。"
          stamp={draftStamp}
          actions={
            <Stack direction={{ base: "column", md: "row" }} gap="10px">
              <Button
                data-testid="business-policy-save-draft"
                colorScheme="green"
                onClick={() => void handleSaveDraft()}
                disabled={!canManage || saving}
              >
                保存草稿
              </Button>
              <Button
                data-testid="business-policy-publish"
                variant="outline"
                onClick={() => void handlePublish()}
                disabled={!canManage || publishing}
              >
                发布生效
              </Button>
            </Stack>
          }
        >
          <Stack gap="18px">
            {fieldGroups.map((group) => (
              <Box
                key={group.title}
                borderRadius="20px"
                border="1px solid rgba(15,17,21,0.08)"
                bg="rgba(255,255,255,0.72)"
                p="18px"
              >
                <Text fontWeight="700" color="ink.900">
                  {group.title}
                </Text>
                <Text mt="4px" color="ink.500">
                  {group.description}
                </Text>
                <Grid
                  templateColumns={{ base: "1fr", xl: "repeat(2, 1fr)" }}
                  gap="14px"
                  mt="14px"
                >
                  {group.fields.map((field) => (
                    <Box key={field.path}>
                      <Text fontSize="13px" fontWeight="600" color="ink.700">
                        {field.label}
                      </Text>
                      <Text mt="4px" fontSize="12px" color="ink.500">
                        {field.hint}
                      </Text>
                      <Input
                        data-testid={`business-policy-field-${field.path}`}
                        mt="8px"
                        value={getFieldValue(draftPolicy, field.path)}
                        onChange={(event) =>
                          setDraftPolicy((current) =>
                            current
                              ? setFieldValue(
                                  current,
                                  field.path,
                                  event.target.value
                                )
                              : current
                          )
                        }
                        disabled={!canManage}
                        style={nativeFieldStyle}
                      />
                    </Box>
                  ))}
                </Grid>
              </Box>
            ))}
          </Stack>
        </SurfaceCard>

        <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap="16px">
          <SurfaceCard
            eyebrow="Published Snapshot"
            title="已发布业务参数"
            description="这是控制面记账的 published 快照；Gateway 运行时会以它为优先来源，并在异常时 fallback 到 env/default。"
          >
            <Text color="ink.500">
              published by {overview.published.meta.publishedBy ?? "unknown"} at{" "}
              {overview.published.meta.publishedAt
                ? formatDateTime(overview.published.meta.publishedAt)
                : "n/a"}
            </Text>
            <Box
              as="pre"
              mt="14px"
              p="14px"
              borderRadius="18px"
              bg="rgba(12,16,20,0.92)"
              color="white"
              fontSize="12px"
              overflowX="auto"
            >
              {JSON.stringify(overview.published.policy, null, 2)}
            </Box>
          </SurfaceCard>

          <SurfaceCard
            eyebrow="Runtime / Infra Summary"
            title="运行时与只读基础设施配置"
            description="RPC、DSN、Webhook secret、KMS 等继续留在 env 或 Secret Manager；这里只做来源与 configured 状态总览。"
          >
            <Stack gap="10px">
              {runtimeSummaryRows.map((row) => (
                <Box
                  key={`${row.section}.${row.key}`}
                  borderRadius="18px"
                  border="1px solid rgba(15,17,21,0.08)"
                  p="14px"
                >
                  <Text fontSize="12px" textTransform="uppercase" color="ink.500">
                    {row.section}
                  </Text>
                  <Text mt="4px" fontWeight="700" color="ink.900">
                    {row.key}
                  </Text>
                  <Text mt="6px" color="ink.500">
                    source={row.item.source}
                    {typeof row.item.configured === "boolean"
                      ? ` · configured=${String(row.item.configured)}`
                      : ""}
                    {row.item.value !== undefined
                      ? ` · value=${String(row.item.value)}`
                      : ""}
                  </Text>
                </Box>
              ))}
            </Stack>
          </SurfaceCard>
        </Grid>
      </Stack>
      {stepUpModal}
    </AdminShell>
  );
}
