export const RISK_LEVEL = {
  GREEN: "green",
  YELLOW: "yellow",
  RED: "red",
} as const;

export type RiskLevel = typeof RISK_LEVEL[keyof typeof RISK_LEVEL];

const RISK_LEVEL_VALUES = Object.values(RISK_LEVEL) as RiskLevel[];

export function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === "string" && RISK_LEVEL_VALUES.includes(value as RiskLevel);
}

export function parseRiskLevel(value: string): RiskLevel | null {
  return isRiskLevel(value) ? value : null;
}

export function assertRiskLevel(value: string): RiskLevel {
  const parsed = parseRiskLevel(value);
  if (!parsed) {
    throw new Error(`Unknown risk level: ${value}`);
  }
  return parsed;
}
