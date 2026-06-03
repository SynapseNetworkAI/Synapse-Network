import type {
  BusinessPolicyOverviewResponse,
  BusinessPolicyPayload,
  ConfigOverviewEnvItem,
} from "@/services/admin-api";

export type EditablePolicyPath =
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

export type ConfigFieldDefinition = {
  path: EditablePolicyPath;
  label: string;
  hint: string;
  unit: string;
  riskNote?: string;
};

export type ConfigFieldGroup = {
  id: "finance" | "consumerWithdraw" | "risk" | "reconciliation";
  title: string;
  description: string;
  fields: ConfigFieldDefinition[];
};

export type RuntimeSummaryRow = {
  section: string;
  key: string;
  source: string;
  configured: boolean | null;
  displayValue: string;
  sensitive: boolean;
};

export const policyFieldGroups: ConfigFieldGroup[] = [
  {
    id: "finance",
    title: "Finance",
    description: "平台费率、路由税和 Consumer 充值/提现费用。",
    fields: [
      {
        path: "finance.platformFeeRate",
        label: "Platform Fee Rate",
        hint: "平台抽成比例，保留 0 到 1 之间的小数字符串。",
        unit: "ratio",
        riskNote: "直接影响平台收入分配。",
      },
      {
        path: "finance.gatewayRoutingTaxUsdc",
        label: "Gateway Routing Tax",
        hint: "每次调用的固定路由税。",
        unit: "USDC",
      },
      {
        path: "finance.consumerWithdrawFeeUsdc",
        label: "Consumer Withdraw Fee",
        hint: "Consumer 提现固定手续费。",
        unit: "USDC",
      },
      {
        path: "finance.consumerDepositMinUsdc",
        label: "Consumer Deposit Min",
        hint: "Consumer 充值最小金额。",
        unit: "USDC",
      },
    ],
  },
  {
    id: "consumerWithdraw",
    title: "Consumer Withdraw",
    description: "Consumer 出金的最小金额、审核阈值、次数和成熟期。",
    fields: [
      {
        path: "consumerWithdraw.minUsdc",
        label: "Withdraw Min",
        hint: "Consumer 提现最小金额。",
        unit: "USDC",
      },
      {
        path: "consumerWithdraw.manualReviewThresholdUsdc",
        label: "Manual Review Threshold",
        hint: "达到该阈值后进入人工审核。",
        unit: "USDC",
        riskNote: "调高会减少人工审核，但会放大出金风险。",
      },
      {
        path: "consumerWithdraw.maxDailyCount",
        label: "Max Daily Count",
        hint: "24 小时内允许自动通过的最大笔数。",
        unit: "count",
      },
      {
        path: "consumerWithdraw.maturitySeconds",
        label: "Maturity Seconds",
        hint: "资金成熟期秒数；生产环境不应关闭。",
        unit: "seconds",
        riskNote: "过低会削弱充值确认后的风险缓冲。",
      },
    ],
  },
  {
    id: "risk",
    title: "Risk",
    description: "Provider/Consumer 出金自动处理窗口与限额。",
    fields: [
      {
        path: "risk.withdrawalAutoSingleLimitUsdc",
        label: "Auto Single Limit",
        hint: "单笔自动通过上限。",
        unit: "USDC",
      },
      {
        path: "risk.withdrawalAuto24hLimitUsdc",
        label: "Auto 24h Limit",
        hint: "24 小时自动通过累计上限。",
        unit: "USDC",
      },
      {
        path: "risk.withdrawalWindowHours",
        label: "Withdrawal Window Hours",
        hint: "统计自动通过累计金额的窗口时长。",
        unit: "hours",
      },
    ],
  },
  {
    id: "reconciliation",
    title: "Reconciliation",
    description: "对账 drift 告警阈值。",
    fields: [
      {
        path: "reconciliation.alertDeltaUsdc",
        label: "Alert Delta",
        hint: "链上 vault 与 ledger 差额告警阈值。",
        unit: "USDC",
        riskNote: "过高会延迟暴露资金差异。",
      },
    ],
  },
];

export function clonePolicy(
  policy: BusinessPolicyPayload
): BusinessPolicyPayload {
  return JSON.parse(JSON.stringify(policy)) as BusinessPolicyPayload;
}

export function canManageBusinessPolicy(
  role: string | null | undefined
): boolean {
  return role === "super_admin";
}

export function getPolicyFieldValue(
  policy: BusinessPolicyPayload,
  path: EditablePolicyPath
): string {
  const [section, key] = path.split(".");
  const scoped = policy[section as keyof BusinessPolicyPayload] as Record<
    string,
    string | number
  >;
  return String(scoped[key] ?? "");
}

export function setPolicyFieldValue(
  policy: BusinessPolicyPayload,
  path: EditablePolicyPath,
  value: string
): BusinessPolicyPayload {
  const next = clonePolicy(policy);
  const [section, key] = path.split(".");
  const scoped = next[section as keyof BusinessPolicyPayload] as Record<
    string,
    string | number
  >;
  scoped[key] = [
    "maxDailyCount",
    "maturitySeconds",
    "withdrawalWindowHours",
  ].includes(key)
    ? Number(value)
    : value;
  return next;
}

export function buildMetaStamp(
  config: BusinessPolicyOverviewResponse["draft"] | null
): string {
  if (!config) {
    return "not-loaded";
  }
  return `draft v${config.meta.draftVersion} / published v${config.meta.publishedVersion}`;
}

export function buildRuntimeSource(
  overview: BusinessPolicyOverviewResponse
): string {
  return (
    overview.runtime?.businessPolicy?.source ??
    overview.runtime?.error?.code ??
    "unknown"
  );
}

export function flattenRuntimeSummary(
  envSummary: Record<string, Record<string, ConfigOverviewEnvItem>> | undefined
): RuntimeSummaryRow[] {
  if (!envSummary) {
    return [];
  }

  return Object.entries(envSummary).flatMap(([section, entries]) =>
    Object.entries(entries).map(([key, item]) => {
      const sensitive = isSensitiveRuntimeKey(key);
      return {
        section,
        key,
        source: item.source,
        configured: item.configured ?? null,
        displayValue: sensitive
          ? configuredLabel(item)
          : String(item.value ?? "n/a"),
        sensitive,
      };
    })
  );
}

export function groupRuntimeRowsBySource(
  rows: RuntimeSummaryRow[]
): Array<{ source: string; rows: RuntimeSummaryRow[] }> {
  const groups = new Map<string, RuntimeSummaryRow[]>();
  for (const row of rows) {
    const source = row.source || "unknown";
    groups.set(source, [...(groups.get(source) ?? []), row]);
  }
  return Array.from(groups.entries())
    .map(([source, nextRows]) => ({ source, rows: nextRows }))
    .sort((left, right) => left.source.localeCompare(right.source));
}

export function buildPolicySnapshotRows(policy: BusinessPolicyPayload): Array<{
  group: string;
  label: string;
  value: string;
  unit: string;
}> {
  return policyFieldGroups.flatMap((group) =>
    group.fields.map((field) => ({
      group: group.title,
      label: field.label,
      value: getPolicyFieldValue(policy, field.path),
      unit: field.unit,
    }))
  );
}

export function buildPolicyDiffRows(
  draft: BusinessPolicyPayload,
  published: BusinessPolicyPayload
): Array<{ label: string; draft: string; published: string; unit: string }> {
  return policyFieldGroups.flatMap((group) =>
    group.fields
      .map((field) => ({
        label: `${group.title} / ${field.label}`,
        draft: getPolicyFieldValue(draft, field.path),
        published: getPolicyFieldValue(published, field.path),
        unit: field.unit,
      }))
      .filter((row) => row.draft !== row.published)
  );
}

export function buildConfigEntryCards() {
  return [
    {
      key: "business-policy",
      title: "业务策略配置",
      description: "按业务域编辑 draft，保存草稿后再发布生效。",
      href: "/config/business-policy",
      actionLabel: "进入编辑",
    },
    {
      key: "runtime",
      title: "运行时来源",
      description: "检查 Gateway 当前读取 published、env 还是 default。",
      href: "/config/runtime",
      actionLabel: "查看来源",
    },
    {
      key: "published",
      title: "已发布快照",
      description: "只读查看 published policy，并对比 draft 差异。",
      href: "/config/published",
      actionLabel: "查看快照",
    },
    {
      key: "menu-config",
      title: "菜单配置",
      description: "菜单树、路由和权限可见性保持独立工作台。",
      href: "/menu-config",
      actionLabel: "打开菜单配置",
    },
  ];
}

function isSensitiveRuntimeKey(key: string): boolean {
  return /secret|token|password|private|dsn|key|kms|webhook/i.test(key);
}

function configuredLabel(item: ConfigOverviewEnvItem): string {
  if (typeof item.configured === "boolean") {
    return item.configured ? "configured" : "not configured";
  }
  return item.value === undefined || item.value === null ? "n/a" : "configured";
}
