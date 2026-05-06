export type FinanceAuditLogAmountSource = {
  amountDelta?: unknown;
  amount_delta?: unknown;
  amountUsdc?: unknown;
  amount_usdc?: unknown;
  afterBalance?: unknown;
  after_balance?: unknown;
  beforeBalance?: unknown;
  before_balance?: unknown;
  details?: Record<string, unknown>;
};

const AUDIT_AMOUNT_KEYS = [
  "amountUsdc",
  "amount_usdc",
  "requestedAmountUsdc",
  "requested_amount_usdc",
  "withdrawAmountUsdc",
  "withdraw_amount_usdc",
  "consumerWithdrawAmountUsdc",
  "consumer_withdraw_amount_usdc",
  "providerWithdrawAmountUsdc",
  "provider_withdraw_amount_usdc",
  "refundAmountUsdc",
  "refund_amount_usdc",
  "approvedAmountUsdc",
  "approved_amount_usdc",
  "releasedAmountUsdc",
  "released_amount_usdc",
  "netAmountUsdc",
  "net_amount_usdc",
  "grossAmountUsdc",
  "gross_amount_usdc",
  "creditedAmountUsdc",
  "credited_amount_usdc",
  "deltaAmount",
  "delta_amount",
  "amountDelta",
  "amount_delta",
] as const;

function parseAuditMoney(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.abs(value) : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/^\$/, "").replaceAll(",", "");
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
}

function firstPositiveAuditMoney(values: unknown[]): number | null {
  for (const value of values) {
    const parsed = parseAuditMoney(value);
    if (parsed !== null && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function formatAuditMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function directAuditAmount(log: FinanceAuditLogAmountSource): number | null {
  const details = log.details ?? {};
  return firstPositiveAuditMoney([
    log.amountUsdc,
    log.amount_usdc,
    ...AUDIT_AMOUNT_KEYS.map((key) => details[key]),
    log.amountDelta,
    log.amount_delta,
  ]);
}

function firstDefinedAuditValue(values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function resolveAfterBalance(log: FinanceAuditLogAmountSource): unknown {
  const details = log.details ?? {};
  return firstDefinedAuditValue([
    details.afterBalance,
    details.after_balance,
    log.afterBalance,
    log.after_balance,
  ]);
}

function resolveBeforeBalance(log: FinanceAuditLogAmountSource): unknown {
  const details = log.details ?? {};
  return firstDefinedAuditValue([
    details.beforeBalance,
    details.before_balance,
    log.beforeBalance,
    log.before_balance,
  ]);
}

function numericBalanceDiff(
  after: number | null,
  before: number | null
): number | null {
  if (after === null || before === null) {
    return null;
  }

  const diff = Math.abs(after - before);
  return diff > 0 ? diff : null;
}

function auditBalanceDiff(log: FinanceAuditLogAmountSource): number | null {
  return numericBalanceDiff(
    parseAuditMoney(resolveAfterBalance(log)),
    parseAuditMoney(resolveBeforeBalance(log))
  );
}

export function extractAuditAmount(log: FinanceAuditLogAmountSource): string {
  const directAmount = directAuditAmount(log);

  if (directAmount !== null) {
    return formatAuditMoney(directAmount);
  }

  const balanceDiff = auditBalanceDiff(log);
  if (balanceDiff !== null) {
    return formatAuditMoney(balanceDiff);
  }

  return "—";
}
