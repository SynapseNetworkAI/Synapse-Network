import type { ActivityTrendPoint, ApprovalItem, FinanceOverview } from "@/services/admin-api";
import { getFinanceMetricGlossary } from "@/features/finance/finance-glossary";

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
