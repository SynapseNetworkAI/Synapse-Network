import { formatUsdc } from "@/lib/admin-console";
import type { ActivityTrendPoint, ApprovalItem, FinanceOverview } from "@/services/admin-api";
import { getFinanceMetricGlossary } from "@/features/finance/finance-glossary";

type FinanceMetricSurfaceCard = {
  key: string;
  label: string;
  value: string;
  description: string;
  hint: string;
};

type FinancePlaceholderCard = FinanceMetricSurfaceCard & {
  pending: boolean;
};

export type CapitalPulseMetric = {
  key: string;
  label: string;
  value: string;
  hint: string;
};

export type CapitalPulseLane = {
  key: "consumer" | "platform" | "provider";
  title: string;
  description: string;
  items: CapitalPulseMetric[];
};

export type CapitalPulseTrendSeries = {
  key: "primary" | "secondary";
  label: string;
  color: string;
};

export type CapitalPulseTrendDatum = {
  label: string;
  primary: number;
  secondary?: number;
};

export type CapitalPulseTrendLane = {
  key: "consumer" | "platform" | "provider";
  title: string;
  description: string;
  latestLabel: string;
  latestValue: string;
  aggregateLabel: string;
  aggregateValue: string;
  valueType: "count" | "usdc";
  series: CapitalPulseTrendSeries[];
  data: CapitalPulseTrendDatum[];
  supportMetrics: CapitalPulseMetric[];
};

type ReconciliationLike = {
  chainVaultUsdc: string | null;
  signedDifferenceUsdc: string | null;
  ownerLiabilityUsdc: string;
  providerPayableUsdc: string;
  platformFeeBalanceUsdc: string;
};

export function filterFinanceApprovals(items: ApprovalItem[]): ApprovalItem[] {
  return items.filter((item) => item.approvalType.includes("refund") || item.approvalType.includes("withdraw") || item.approvalType.includes("deposit"));
}

export function getVaultDeltaTone(value: string): "green" | "orange" | "red" {
  const delta = Math.abs(Number(value || 0));

  if (delta <= 0.01) {
    return "green";
  }
  if (delta < 100) {
    return "orange";
  }
  return "red";
}

function formatBucketLabel(bucketDate: string): string {
  const date = new Date(bucketDate);
  if (Number.isNaN(date.getTime())) {
    return bucketDate;
  }
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

export function buildTrendChartData(points: ActivityTrendPoint[]) {
  return points.map((point) => ({
    label: formatBucketLabel(point.bucketDate),
    deposit: Number(point.depositUsdc || 0),
    charge: Number(point.chargeUsdc || 0),
    refund: Number(point.refundUsdc || 0),
    withdrawal: Number(point.withdrawalUsdc || 0),
    netFlow: Number(point.netFlowUsdc || 0),
  }));
}

function sumNumeric(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function buildCapitalPulseTrendLanes(
  overview: FinanceOverview,
  points: ActivityTrendPoint[],
): CapitalPulseTrendLane[] {
  const latestPoint = points.at(-1);
  const latestInvocationCount = latestPoint?.invocationCount ?? overview.todayInvocationCount;
  const sevenDayInvocationCount = sumNumeric(points.map((point) => point.invocationCount));
  const latestPlatformFee = Number(latestPoint?.platformFeeEarnedUsdc ?? overview.todayPlatformFeeEarnedUsdc ?? 0);
  const sevenDayPlatformFee = sumNumeric(points.map((point) => Number(point.platformFeeEarnedUsdc ?? 0)));
  const latestProviderEarned = Number(latestPoint?.providerEarnedUsdc ?? overview.todayProviderEarnedUsdc ?? 0);
  const sevenDayProviderEarned = sumNumeric(points.map((point) => Number(point.providerEarnedUsdc ?? 0)));

  return [
    {
      key: "consumer",
      title: "用户侧变化",
      description: "看今天的调用和消费是否活跃，帮助判断资金变化是不是来自真实业务。",
      latestLabel: "最近一天调用次数",
      latestValue: String(latestInvocationCount),
      aggregateLabel: "七天累计调用次数",
      aggregateValue: String(sevenDayInvocationCount),
      valueType: "count",
      series: [
        {
          key: "primary",
          label: getFinanceMetricGlossary("todayInvocationCount").label,
          color: "#0f1115",
        },
      ],
      data: points.map((point) => ({
        label: formatBucketLabel(point.bucketDate),
        primary: point.invocationCount,
      })),
      supportMetrics: [
        {
          key: "consumer-charge-support",
          label: getFinanceMetricGlossary("todayCharge").label,
          value: `${formatUsdc(overview.todayChargeUsdc)} USDC`,
          hint: getFinanceMetricGlossary("todayCharge").hint,
        },
        {
          key: "consumer-refund-support",
          label: getFinanceMetricGlossary("todayRefund").label,
          value: `${formatUsdc(overview.todayRefundUsdc)} USDC`,
          hint: getFinanceMetricGlossary("todayRefund").hint,
        },
      ],
    },
    {
      key: "platform",
      title: "平台收入变化",
      description: "看平台今天新增了多少收入，也看最近一周收入有没有持续变化。",
      latestLabel: "最近一天新增收入",
      latestValue: `${formatUsdc(latestPlatformFee)} USDC`,
      aggregateLabel: "七天累计新增收入",
      aggregateValue: `${formatUsdc(sevenDayPlatformFee)} USDC`,
      valueType: "usdc",
      series: [
        {
          key: "primary",
          label: getFinanceMetricGlossary("todayPlatformFeeEarned").label,
          color: "#f36a1d",
        },
        {
          key: "secondary",
          label: getFinanceMetricGlossary("todayCharge").label,
          color: "#0f1115",
        },
      ],
      data: points.map((point) => ({
        label: formatBucketLabel(point.bucketDate),
        primary: Number(point.platformFeeEarnedUsdc ?? 0),
        secondary: Number(point.chargeUsdc ?? 0),
      })),
      supportMetrics: [
        {
          key: "platform-income-support",
          label: getFinanceMetricGlossary("platformIncome").label,
          value: `${formatUsdc(overview.platformFeeBalanceUsdc)} USDC`,
          hint: getFinanceMetricGlossary("platformIncome").hint,
        },
        {
          key: "platform-charge-support",
          label: getFinanceMetricGlossary("todayCharge").label,
          value: `${formatUsdc(overview.todayChargeUsdc)} USDC`,
          hint: getFinanceMetricGlossary("todayCharge").hint,
        },
      ],
    },
    {
      key: "provider",
      title: "服务商收支变化",
      description: "看服务商最近收入和提现情况，帮助判断当前结算和出款压力。",
      latestLabel: "最近一天新增收入",
      latestValue: `${formatUsdc(latestProviderEarned)} USDC`,
      aggregateLabel: "七天累计新增收入",
      aggregateValue: `${formatUsdc(sevenDayProviderEarned)} USDC`,
      valueType: "usdc",
      series: [
        {
          key: "primary",
          label: getFinanceMetricGlossary("todayProviderEarned").label,
          color: "#1f9257",
        },
        {
          key: "secondary",
          label: getFinanceMetricGlossary("todayWithdrawal").label,
          color: "#b83131",
        },
      ],
      data: points.map((point) => ({
        label: formatBucketLabel(point.bucketDate),
        primary: Number(point.providerEarnedUsdc ?? 0),
        secondary: Number(point.withdrawalUsdc ?? 0),
      })),
      supportMetrics: [
        {
          key: "provider-available-support",
          label: getFinanceMetricGlossary("providerAvailableToWithdraw").label,
          value: `${formatUsdc(overview.providerAvailableToWithdrawUsdc)} USDC`,
          hint: getFinanceMetricGlossary("providerAvailableToWithdraw").hint,
        },
        {
          key: "provider-withdrawal-support",
          label: getFinanceMetricGlossary("todayWithdrawal").label,
          value: `${formatUsdc(overview.todayWithdrawalUsdc)} USDC`,
          hint: getFinanceMetricGlossary("todayWithdrawal").hint,
        },
      ],
    },
  ];
}

export function buildFinanceCapitalPulseLanes(overview: FinanceOverview): CapitalPulseLane[] {
  return [
    {
      key: "consumer",
      title: "用户侧",
      description: "看今天用户充值、消费和退款的情况，先判断用户侧业务是否正常。",
      items: [
        {
          key: "today-deposit",
          label: getFinanceMetricGlossary("todayDeposit").label,
          value: `${formatUsdc(overview.todayDepositUsdc)} USDC`,
          hint: getFinanceMetricGlossary("todayDeposit").hint,
        },
        {
          key: "today-charge",
          label: getFinanceMetricGlossary("todayCharge").label,
          value: `${formatUsdc(overview.todayChargeUsdc)} USDC`,
          hint: getFinanceMetricGlossary("todayCharge").hint,
        },
        {
          key: "today-refund",
          label: getFinanceMetricGlossary("todayRefund").label,
          value: `${formatUsdc(overview.todayRefundUsdc)} USDC`,
          hint: getFinanceMetricGlossary("todayRefund").hint,
        },
        {
          key: "today-invocation-count",
          label: getFinanceMetricGlossary("todayInvocationCount").label,
          value: String(overview.todayInvocationCount),
          hint: getFinanceMetricGlossary("todayInvocationCount").hint,
        },
      ],
    },
    {
      key: "platform",
      title: "平台侧",
      description: "看今天平台新增收入和当前累计收入，方便快速了解经营结果。",
      items: [
        {
          key: "today-platform-fee-earned",
          label: getFinanceMetricGlossary("todayPlatformFeeEarned").label,
          value: `${formatUsdc(overview.todayPlatformFeeEarnedUsdc)} USDC`,
          hint: getFinanceMetricGlossary("todayPlatformFeeEarned").hint,
        },
        {
          key: "platform-income",
          label: getFinanceMetricGlossary("platformIncome").label,
          value: `${formatUsdc(overview.platformFeeBalanceUsdc)} USDC`,
          hint: getFinanceMetricGlossary("platformIncome").hint,
        },
      ],
    },
    {
      key: "provider",
      title: "服务商侧",
      description: "看服务商今天收入、提现和可提现余额，方便判断当前付款压力。",
      items: [
        {
          key: "today-provider-earned",
          label: getFinanceMetricGlossary("todayProviderEarned").label,
          value: `${formatUsdc(overview.todayProviderEarnedUsdc)} USDC`,
          hint: getFinanceMetricGlossary("todayProviderEarned").hint,
        },
        {
          key: "today-withdrawal",
          label: getFinanceMetricGlossary("todayWithdrawal").label,
          value: `${formatUsdc(overview.todayWithdrawalUsdc)} USDC`,
          hint: getFinanceMetricGlossary("todayWithdrawal").hint,
        },
        {
          key: "pending-withdrawals",
          label: getFinanceMetricGlossary("pendingWithdrawals").label,
          value: String(overview.pendingWithdrawalCount),
          hint: getFinanceMetricGlossary("pendingWithdrawals").hint,
        },
        {
          key: "provider-available-to-withdraw",
          label: getFinanceMetricGlossary("providerAvailableToWithdraw").label,
          value: `${formatUsdc(overview.providerAvailableToWithdrawUsdc)} USDC`,
          hint: getFinanceMetricGlossary("providerAvailableToWithdraw").hint,
        },
      ],
    },
  ];
}

export function buildFinanceExposureCards(overview: FinanceOverview) {
  return [
    {
      key: "owner-liability",
      label: getFinanceMetricGlossary("ownerLiability").label,
      value: overview.ownerLiabilityUsdc,
      description: getFinanceMetricGlossary("ownerLiability").meta,
      hint: getFinanceMetricGlossary("ownerLiability").hint,
    },
    {
      key: "provider-payable",
      label: getFinanceMetricGlossary("providerPayable").label,
      value: overview.providerPayableUsdc,
      description: getFinanceMetricGlossary("providerPayable").meta,
      hint: getFinanceMetricGlossary("providerPayable").hint,
    },
    {
      key: "platform-fee",
      label: getFinanceMetricGlossary("platformIncome").label,
      value: overview.platformFeeBalanceUsdc,
      description: getFinanceMetricGlossary("platformIncome").meta,
      hint: getFinanceMetricGlossary("platformIncome").hint,
    },
  ];
}

function toNumber(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

export function buildFinanceTreasuryCoreCards(
  overview: FinanceOverview,
  reconciliationDetail: ReconciliationLike | null,
): FinanceMetricSurfaceCard[] {
  return [
    {
      key: "chain-vault",
      label: getFinanceMetricGlossary("chainVault").label,
      value: reconciliationDetail?.chainVaultUsdc ?? "待接线",
      description: reconciliationDetail?.chainVaultUsdc ? getFinanceMetricGlossary("chainVault").meta : "当前还没有拿到这项余额数据。",
      hint: getFinanceMetricGlossary("chainVault").hint,
    },
    {
      key: "owner-liability",
      label: getFinanceMetricGlossary("ownerLiability").label,
      value: overview.ownerLiabilityUsdc,
      description: getFinanceMetricGlossary("ownerLiability").meta,
      hint: getFinanceMetricGlossary("ownerLiability").hint,
    },
    {
      key: "provider-payable",
      label: getFinanceMetricGlossary("providerPayable").label,
      value: overview.providerPayableUsdc,
      description: getFinanceMetricGlossary("providerPayable").meta,
      hint: getFinanceMetricGlossary("providerPayable").hint,
    },
    {
      key: "platform-income",
      label: getFinanceMetricGlossary("platformIncome").label,
      value: overview.platformFeeBalanceUsdc,
      description: getFinanceMetricGlossary("platformIncome").meta,
      hint: getFinanceMetricGlossary("platformIncome").hint,
    },
  ];
}

export function buildFinanceDeltaCards(
  overview: FinanceOverview,
  reconciliationDetail: ReconciliationLike | null,
): FinanceMetricSurfaceCard[] {
  const chainVault = toNumber(reconciliationDetail?.chainVaultUsdc);
  const ownerLiability = toNumber(overview.ownerLiabilityUsdc);
  const providerPayable = toNumber(overview.providerPayableUsdc);
  const platformIncome = toNumber(overview.platformFeeBalanceUsdc);
  const treasurySignedDifference = reconciliationDetail?.chainVaultUsdc === null || reconciliationDetail === null
    ? null
    : (chainVault - (ownerLiability + providerPayable + platformIncome)).toFixed(2);
  const treasuryAbsoluteDelta = treasurySignedDifference === null ? null : Math.abs(Number(treasurySignedDifference)).toFixed(2);

  return [
    {
      key: "treasury-signed-difference",
      label: getFinanceMetricGlossary("treasurySignedDifference").label,
      value: treasurySignedDifference ?? "待接线",
      description: treasurySignedDifference === null ? "当前还没有拿到这项差异数据。" : getFinanceMetricGlossary("treasurySignedDifference").meta,
      hint: getFinanceMetricGlossary("treasurySignedDifference").hint,
    },
    {
      key: "treasury-absolute-delta",
      label: getFinanceMetricGlossary("treasuryAbsoluteDelta").label,
      value: treasuryAbsoluteDelta ?? "待接线",
      description: treasuryAbsoluteDelta === null ? "当前还没有拿到这项差异数据。" : getFinanceMetricGlossary("treasuryAbsoluteDelta").meta,
      hint: getFinanceMetricGlossary("treasuryAbsoluteDelta").hint,
    },
    {
      key: "deposit-signed-difference",
      label: getFinanceMetricGlossary("signedDifference").label,
      value: reconciliationDetail?.signedDifferenceUsdc ?? "待接线",
      description: reconciliationDetail?.signedDifferenceUsdc ? getFinanceMetricGlossary("signedDifference").meta : "当前还没有拿到这项差异数据。",
      hint: getFinanceMetricGlossary("signedDifference").hint,
    },
    {
      key: "deposit-absolute-delta",
      label: getFinanceMetricGlossary("absoluteDelta").label,
      value: overview.vaultLedgerDeltaUsdc,
      description: getFinanceMetricGlossary("absoluteDelta").meta,
      hint: getFinanceMetricGlossary("absoluteDelta").hint,
    },
  ];
}

export function buildFinanceFlowVolumeCards(overview: FinanceOverview): FinanceMetricSurfaceCard[] {
  return [
    {
      key: "today-deposit",
      label: getFinanceMetricGlossary("todayDeposit").label,
      value: overview.todayDepositUsdc,
      description: getFinanceMetricGlossary("todayDeposit").meta,
      hint: getFinanceMetricGlossary("todayDeposit").hint,
    },
    {
      key: "today-charge",
      label: getFinanceMetricGlossary("todayCharge").label,
      value: overview.todayChargeUsdc,
      description: getFinanceMetricGlossary("todayCharge").meta,
      hint: getFinanceMetricGlossary("todayCharge").hint,
    },
    {
      key: "today-refund",
      label: getFinanceMetricGlossary("todayRefund").label,
      value: overview.todayRefundUsdc,
      description: getFinanceMetricGlossary("todayRefund").meta,
      hint: getFinanceMetricGlossary("todayRefund").hint,
    },
    {
      key: "today-withdrawal",
      label: getFinanceMetricGlossary("todayWithdrawal").label,
      value: overview.todayWithdrawalUsdc,
      description: getFinanceMetricGlossary("todayWithdrawal").meta,
      hint: getFinanceMetricGlossary("todayWithdrawal").hint,
    },
  ];
}

export function buildFinancePressureCards(overview: FinanceOverview): FinancePlaceholderCard[] {
  return [
    {
      key: "refundable-consumer-balance",
      label: getFinanceMetricGlossary("refundableConsumerBalance").label,
      value: `${formatUsdc(overview.refundableConsumerBalanceUsdc)} USDC`,
      description: "当前可用于退款处理的用户余额。",
      hint: getFinanceMetricGlossary("refundableConsumerBalance").hint,
      pending: false,
    },
    {
      key: "provider-available-to-withdraw",
      label: getFinanceMetricGlossary("providerAvailableToWithdraw").label,
      value: `${formatUsdc(overview.providerAvailableToWithdrawUsdc)} USDC`,
      description: "服务商当前可以发起提现的金额。",
      hint: getFinanceMetricGlossary("providerAvailableToWithdraw").hint,
      pending: false,
    },
    {
      key: "provider-locked-balance",
      label: getFinanceMetricGlossary("providerLockedBalance").label,
      value: `${formatUsdc(overview.providerLockedBalanceUsdc)} USDC`,
      description: "服务商当前已在处理中或暂时锁定的金额。",
      hint: getFinanceMetricGlossary("providerLockedBalance").hint,
      pending: false,
    },
    {
      key: "pending-withdrawals",
      label: getFinanceMetricGlossary("pendingWithdrawals").label,
      value: String(overview.pendingWithdrawalCount),
      description: getFinanceMetricGlossary("pendingWithdrawals").meta,
      hint: getFinanceMetricGlossary("pendingWithdrawals").hint,
      pending: false,
    },
    {
      key: "pending-deposits",
      label: getFinanceMetricGlossary("pendingDeposits").label,
      value: String(overview.pendingDepositCount),
      description: getFinanceMetricGlossary("pendingDeposits").meta,
      hint: getFinanceMetricGlossary("pendingDeposits").hint,
      pending: false,
    },
  ];
}
