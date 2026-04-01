export type BillingCycleWindow = {
  cycleLabel: string;
  daysRemaining: number;
  cycleStartMs: number;
  cycleEndMs: number;
};

function toCycleLabel(cycleStart: Date, cycleEnd: Date): string {
  return `${cycleStart.toLocaleString(undefined, {
    month: "short",
  })} ${cycleStart.getDate()} - ${cycleEnd.toLocaleString(undefined, {
    month: "short",
  })} ${cycleEnd.getDate()}, ${cycleEnd.getFullYear()}`;
}

export function getBillingCycleWindow(now = new Date()): BillingCycleWindow {
  const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const cycleEndExclusive = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const msPerDay = 1000 * 60 * 60 * 24;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return {
    cycleLabel: toCycleLabel(cycleStart, cycleEnd),
    daysRemaining: Math.max(
      0,
      Math.round((cycleEnd.getTime() - todayStart.getTime()) / msPerDay)
    ),
    cycleStartMs: cycleStart.getTime(),
    cycleEndMs: cycleEndExclusive.getTime() - 1,
  };
}

export function calculateSpendRatio(
  currentSpend: number,
  billingCycleCap: number | null
): number | null {
  if (!billingCycleCap || billingCycleCap <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, (currentSpend / billingCycleCap) * 100));
}
