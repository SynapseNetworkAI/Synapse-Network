import type { StatusTone } from "./status-tone";

export const RISK_LEVEL = {
  GREEN: "green",
  YELLOW: "yellow",
  RED: "red",
} as const;

export type RiskLevel = typeof RISK_LEVEL[keyof typeof RISK_LEVEL];

const RISK_LEVEL_VALUES = Object.values(RISK_LEVEL) as RiskLevel[];

const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  green: "GREEN",
  yellow: "YELLOW",
  red: "RED",
};

const RISK_LEVEL_TONES: Record<RiskLevel, StatusTone> = {
  green: "green",
  yellow: "orange",
  red: "red",
};

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

export function riskLevelLabel(level: RiskLevel): string {
  return RISK_LEVEL_LABELS[level];
}

export function riskLevelTone(level: RiskLevel): StatusTone {
  return RISK_LEVEL_TONES[level];
}
