import type { ProviderWithdrawRecord } from "@/utils/providerWithdrawApi";

type TranslateFn = (
  key: string,
  vars?: Record<string, string | number>,
  fallbackText?: string
) => string;

export function withdrawalStatusLabel(
  status: ProviderWithdrawRecord["status"],
  t: TranslateFn
): string {
  if (status === "APPROVED_AUTO")
    return t("providerSettlements.historyStatusApprovedAuto");
  if (status === "PENDING_MANUAL_REVIEW")
    return t("providerSettlements.historyStatusPendingManualReview");
  if (status === "CANCELLED")
    return t("providerSettlements.historyStatusCancelled");
  if (status === "FAILED_EXPIRED")
    return t("providerSettlements.historyStatusFailedExpired", {}, "Expired");
  if (status === "REQUESTED")
    return t("providerSettlements.historyStatusRequested");
  if (status === "COMPLETED")
    return t("providerSettlements.historyStatusCompleted");
  if (status === "REJECTED")
    return t("providerSettlements.historyStatusRejected");
  return status;
}

export function withdrawalHistoryReasonLabel(
  status: ProviderWithdrawRecord["status"],
  t: TranslateFn
): string {
  if (status === "PENDING_MANUAL_REVIEW") {
    return t("providerSettlements.manualReviewQueued");
  }
  if (status === "CANCELLED" || status === "FAILED_EXPIRED") {
    return t("providerSettlements.expiredTicketReleasedRow");
  }
  if (status === "APPROVED_AUTO") {
    return t("providerSettlements.ticketGenerated");
  }
  if (status === "REJECTED") {
    return t("providerSettlements.historyStatusRejected");
  }
  return "-";
}

export function withdrawalStatusBadgeClass(
  status: ProviderWithdrawRecord["status"]
): string {
  if (status === "COMPLETED")
    return "border-[#22c55e]/30 bg-[#22c55e]/10 text-[#86efac]";
  if (status === "REJECTED")
    return "border-[#ef4444]/30 bg-[#ef4444]/10 text-[#fca5a5]";
  if (status === "CANCELLED" || status === "FAILED_EXPIRED")
    return "border-[#94a3b8]/30 bg-[#94a3b8]/10 text-[#cbd5e1]";
  if (status === "APPROVED_AUTO")
    return "border-[#22c55e]/30 bg-[#22c55e]/10 text-[#bbf7d0]";
  return "border-[#ff9f0a]/30 bg-[#ff9f0a]/10 text-[#ffd7a1]";
}
