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

export function buildFinanceCapitalPulseLanes(overview: FinanceOverview): CapitalPulseLane[] {
  return [
    {
      key: "consumer",
      title: "Consumer",
      description: "把今日入金、消费、退款和调用次数放在同一侧，快速判断需求侧是否正常展开。",
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
      title: "Platform",
      description: "平台侧只保留新增手续费和累计收入池，避免把总账判断和经营摘要混成一组。",
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
      title: "Provider",
      description: "把新增收入、提现和可提现空间放到一起，帮助 operator 判断供给侧结算压力。",
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
      description: reconciliationDetail?.chainVaultUsdc ? getFinanceMetricGlossary("chainVault").meta : "当前 Finance 视图尚未接入链上 Vault 余额投影。",
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
      description: treasurySignedDifference === null ? "当前 Finance 视图尚未拿到完整 Treasury 总账差额。" : getFinanceMetricGlossary("treasurySignedDifference").meta,
      hint: getFinanceMetricGlossary("treasurySignedDifference").hint,
    },
    {
      key: "treasury-absolute-delta",
      label: getFinanceMetricGlossary("treasuryAbsoluteDelta").label,
      value: treasuryAbsoluteDelta ?? "待接线",
      description: treasuryAbsoluteDelta === null ? "当前 Finance 视图尚未拿到完整 Treasury 总账绝对偏差。" : getFinanceMetricGlossary("treasuryAbsoluteDelta").meta,
      hint: getFinanceMetricGlossary("treasuryAbsoluteDelta").hint,
    },
    {
      key: "deposit-signed-difference",
      label: getFinanceMetricGlossary("signedDifference").label,
      value: reconciliationDetail?.signedDifferenceUsdc ?? "待接线",
      description: reconciliationDetail?.signedDifferenceUsdc ? getFinanceMetricGlossary("signedDifference").meta : "当前 Finance 视图尚未接入充值对账带方向偏差。",
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
      description: "当前使用 consumer wallet available balance 作为 refund 可用余额的 operator proxy。",
      hint: getFinanceMetricGlossary("refundableConsumerBalance").hint,
      pending: false,
    },
    {
      key: "provider-available-to-withdraw",
      label: getFinanceMetricGlossary("providerAvailableToWithdraw").label,
      value: `${formatUsdc(overview.providerAvailableToWithdrawUsdc)} USDC`,
      description: "Provider wallet available balance 的聚合读模型，用于判断可直接发起提现的空间。",
      hint: getFinanceMetricGlossary("providerAvailableToWithdraw").hint,
      pending: false,
    },
    {
      key: "provider-locked-balance",
      label: getFinanceMetricGlossary("providerLockedBalance").label,
      value: `${formatUsdc(overview.providerLockedBalanceUsdc)} USDC`,
      description: "Provider wallet pending + frozen balance 的聚合读模型，用来判断出账队列压力。",
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
