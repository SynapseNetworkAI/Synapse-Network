export const WITHDRAWAL_STATUS = {
  REQUESTED: "REQUESTED",
  APPROVED_AUTO: "APPROVED_AUTO",
  PENDING: "PENDING",
  PENDING_MANUAL_REVIEW: "PENDING_MANUAL_REVIEW",
  REJECTED: "REJECTED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
} as const;

export type WithdrawalStatus =
  typeof WITHDRAWAL_STATUS[keyof typeof WITHDRAWAL_STATUS];

const WITHDRAWAL_STATUS_VALUES = Object.values(WITHDRAWAL_STATUS) as WithdrawalStatus[];

export function isWithdrawalStatus(value: unknown): value is WithdrawalStatus {
  return typeof value === "string" && WITHDRAWAL_STATUS_VALUES.includes(value as WithdrawalStatus);
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
