export type DeductionStatus = "accepted" | "succeeded" | "refunded" | "failed";

export const DEDUCTION_STATUS_OPTIONS = ["all", "accepted", "succeeded", "refunded", "failed"] as const;

export type DeductionStatusFilter = (typeof DEDUCTION_STATUS_OPTIONS)[number];
