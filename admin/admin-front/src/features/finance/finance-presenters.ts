import type { ActivityTrendPoint, ApprovalItem, FinanceOverview } from "@/services/admin-api";

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
      label: "Owner liability",
      value: overview.ownerLiabilityUsdc,
      description: "买家侧应付余额读模型",
    },
    {
      key: "provider-payable",
      label: "Provider payable",
      value: overview.providerPayableUsdc,
      description: "待结算给 provider 的应付池",
    },
    {
      key: "platform-fee",
      label: "Platform fee pool",
      value: overview.platformFeeBalanceUsdc,
      description: "平台手续费累计余额",
    },
  ];
}
