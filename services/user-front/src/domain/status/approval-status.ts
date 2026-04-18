export const APPROVAL_STATUS = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED_PENDING_EXECUTION: "APPROVED_PENDING_EXECUTION",
  EXECUTING: "EXECUTING",
  EXECUTED: "EXECUTED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
} as const;

export type ApprovalStatus =
  typeof APPROVAL_STATUS[keyof typeof APPROVAL_STATUS];

const APPROVAL_STATUS_VALUES = Object.values(APPROVAL_STATUS) as ApprovalStatus[];

export function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return typeof value === "string" && APPROVAL_STATUS_VALUES.includes(value as ApprovalStatus);
}

export function parseApprovalStatus(value: string): ApprovalStatus | null {
  return isApprovalStatus(value) ? value : null;
}

export function assertApprovalStatus(value: string): ApprovalStatus {
  const parsed = parseApprovalStatus(value);
  if (!parsed) {
    throw new Error(`Unknown approval status: ${value}`);
  }
  return parsed;
}
