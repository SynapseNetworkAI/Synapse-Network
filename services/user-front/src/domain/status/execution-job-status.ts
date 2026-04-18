export const EXECUTION_JOB_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

export type ExecutionJobStatus =
  typeof EXECUTION_JOB_STATUS[keyof typeof EXECUTION_JOB_STATUS];

const EXECUTION_JOB_STATUS_VALUES = Object.values(EXECUTION_JOB_STATUS) as ExecutionJobStatus[];

const EXECUTION_JOB_STATUS_ALIASES: Record<string, ExecutionJobStatus> = {
  QUEUED: EXECUTION_JOB_STATUS.PENDING,
  EXECUTING: EXECUTION_JOB_STATUS.RUNNING,
  RETRYING: EXECUTION_JOB_STATUS.RUNNING,
};

export function isExecutionJobStatus(value: unknown): value is ExecutionJobStatus {
  return typeof value === "string" && EXECUTION_JOB_STATUS_VALUES.includes(value as ExecutionJobStatus);
}

export function parseExecutionJobStatus(value: string): ExecutionJobStatus | null {
  if (isExecutionJobStatus(value)) {
    return value;
  }
  return EXECUTION_JOB_STATUS_ALIASES[value] ?? null;
}

export function assertExecutionJobStatus(value: string): ExecutionJobStatus {
  const parsed = parseExecutionJobStatus(value);
  if (!parsed) {
    throw new Error(`Unknown execution job status: ${value}`);
  }
  return parsed;
}
