import type { StatusTone } from "./status-tone";

export const WITHDRAWAL_STATUS = {
  REQUESTED: "REQUESTED",
  APPROVED_AUTO: "APPROVED_AUTO",
  PENDING_MANUAL_REVIEW: "PENDING_MANUAL_REVIEW",
  REJECTED: "REJECTED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
  FAILED_EXPIRED: "FAILED_EXPIRED",
} as const;

export type WithdrawalStatus =
  (typeof WITHDRAWAL_STATUS)[keyof typeof WITHDRAWAL_STATUS];

const WITHDRAWAL_STATUS_VALUES = Object.values(
  WITHDRAWAL_STATUS
) as WithdrawalStatus[];

const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalStatus, string> = {
  REQUESTED: "已请求",
  APPROVED_AUTO: "已放行",
  PENDING_MANUAL_REVIEW: "待人工审核",
  REJECTED: "已拒绝",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  FAILED: "失败",
  FAILED_EXPIRED: "票据已过期",
};

const WITHDRAWAL_STATUS_TONES: Record<WithdrawalStatus, StatusTone> = {
  REQUESTED: "orange",
  APPROVED_AUTO: "green",
  PENDING_MANUAL_REVIEW: "orange",
  REJECTED: "red",
  COMPLETED: "green",
  CANCELLED: "gray",
  FAILED: "red",
  FAILED_EXPIRED: "red",
};

export function isWithdrawalStatus(value: unknown): value is WithdrawalStatus {
  return (
    typeof value === "string" &&
    WITHDRAWAL_STATUS_VALUES.includes(value as WithdrawalStatus)
  );
}

export function parseWithdrawalStatus(value: string): WithdrawalStatus | null {
  return isWithdrawalStatus(value) ? value : null;
}

export function assertWithdrawalStatus(value: string): WithdrawalStatus {
  const parsed = parseWithdrawalStatus(value);
  if (!parsed) {
    throw new Error(`Unknown withdrawal status: ${value}`);
  }
  return parsed;
}

export function withdrawalStatusLabel(status: WithdrawalStatus): string {
  return WITHDRAWAL_STATUS_LABELS[status];
}

export function withdrawalStatusTone(status: WithdrawalStatus): StatusTone {
  return WITHDRAWAL_STATUS_TONES[status];
}

export function isWithdrawalTerminalStatus(status: WithdrawalStatus): boolean {
  return (
    status === WITHDRAWAL_STATUS.REJECTED ||
    status === WITHDRAWAL_STATUS.COMPLETED ||
    status === WITHDRAWAL_STATUS.CANCELLED ||
    status === WITHDRAWAL_STATUS.FAILED ||
    status === WITHDRAWAL_STATUS.FAILED_EXPIRED
  );
}
