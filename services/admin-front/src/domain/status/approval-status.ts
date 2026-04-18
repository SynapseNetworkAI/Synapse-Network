import type { StatusTone } from "./status-tone";

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

const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  DRAFT: "草稿",
  SUBMITTED: "待分派",
  UNDER_REVIEW: "审核中",
  APPROVED_PENDING_EXECUTION: "待执行",
  EXECUTING: "执行中",
  EXECUTED: "已执行",
  REJECTED: "已拒绝",
  CANCELLED: "已取消",
  FAILED: "执行失败",
  EXPIRED: "已过期",
};

const APPROVAL_STATUS_TONES: Record<ApprovalStatus, StatusTone> = {
  DRAFT: "gray",
  SUBMITTED: "orange",
  UNDER_REVIEW: "orange",
  APPROVED_PENDING_EXECUTION: "orange",
  EXECUTING: "orange",
  EXECUTED: "green",
  REJECTED: "red",
  CANCELLED: "gray",
  FAILED: "red",
  EXPIRED: "gray",
};

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

export function approvalStatusLabel(status: ApprovalStatus): string {
  return APPROVAL_STATUS_LABELS[status];
}

export function approvalStatusTone(status: ApprovalStatus): StatusTone {
  return APPROVAL_STATUS_TONES[status];
}

export function isApprovalAwaitingReviewStatus(status: ApprovalStatus): boolean {
  return status === APPROVAL_STATUS.SUBMITTED || status === APPROVAL_STATUS.UNDER_REVIEW;
}

export function isApprovalTerminalStatus(status: ApprovalStatus): boolean {
  return status === APPROVAL_STATUS.EXECUTED
    || status === APPROVAL_STATUS.REJECTED
    || status === APPROVAL_STATUS.CANCELLED
    || status === APPROVAL_STATUS.FAILED
    || status === APPROVAL_STATUS.EXPIRED;
}
