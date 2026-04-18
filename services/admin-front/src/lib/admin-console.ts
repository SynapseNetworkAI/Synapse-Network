export type MoneyString = string;

const MONEY_SCALE = 6;
const SIGNED_MONEY_PATTERN = /^-?\d+(?:\.\d{1,6})?$/;

export function formatUsdc(value: string | number | null | undefined): string {
  const raw = typeof value === "number" ? value.toString() : String(value ?? "0").trim();
  if (!SIGNED_MONEY_PATTERN.test(raw)) {
    return "0.00";
  }
  const negative = raw.startsWith("-");
  const normalized = negative ? raw.slice(1) : raw;
  const [wholeRaw, fracRaw = ""] = normalized.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const fraction = `${fracRaw}00`.slice(0, 2);
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${groupedWhole}.${fraction}`;
}

function normalizeMoneyString(value: string | number | null | undefined): string {
  const raw = typeof value === "number" ? value.toString() : String(value ?? "0").trim();
  if (!SIGNED_MONEY_PATTERN.test(raw)) {
    return "0";
  }
  const negative = raw.startsWith("-");
  const normalized = negative ? raw.slice(1) : raw;
  const [wholeRaw, fractionRaw = ""] = normalized.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionRaw.slice(0, MONEY_SCALE).replace(/0+$/, "");
  const compact = fraction ? `${whole}.${fraction}` : whole;
  return negative && compact !== "0" ? `-${compact}` : compact;
}

export function parseMoneyStringForChart(value: string | number | null | undefined): number {
  return Number(normalizeMoneyString(value));
}

export function compareMoneyStrings(left: string | number | null | undefined, right: string | number | null | undefined): number {
  const l = normalizeMoneyString(left);
  const r = normalizeMoneyString(right);
  if (l === r) {
    return 0;
  }
  return parseMoneyStringForChart(l) > parseMoneyStringForChart(r) ? 1 : -1;
}

export function addMoneyStrings(values: Array<string | number | null | undefined>): string {
  const total = values.reduce((sum, value) => sum + parseMoneyStringForChart(value), 0);
  return normalizeMoneyString(total.toFixed(MONEY_SCALE));
}

export function subtractMoneyStrings(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): string {
  const delta = parseMoneyStringForChart(left) - parseMoneyStringForChart(right);
  return normalizeMoneyString(delta.toFixed(MONEY_SCALE));
}

export function absMoneyString(value: string | number | null | undefined): string {
  return normalizeMoneyString(Math.abs(parseMoneyStringForChart(value)).toFixed(MONEY_SCALE));
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// Fallback-only visual helper for non-domain system signals.
// Do not use this for finance, approval, withdrawal, or execution business flows.
export function toneFromStatus(status: string | null | undefined): "green" | "orange" | "red" | "gray" {
  const normalized = (status ?? "").toLowerCase();
  if (["healthy", "active", "approved", "completed", "success"].some((item) => normalized.includes(item))) {
    return "green";
  }
  if (["pending", "queued", "review", "warning", "yellow"].some((item) => normalized.includes(item))) {
    return "orange";
  }
  if (["failed", "reject", "disabled", "alert", "red", "error"].some((item) => normalized.includes(item))) {
    return "red";
  }
  return "gray";
}

export function toneStyles(tone: "green" | "orange" | "red" | "gray") {
  switch (tone) {
    case "green":
      return { bg: "rgba(31, 146, 87, 0.12)", color: "#14633d", borderColor: "rgba(31, 146, 87, 0.18)" };
    case "orange":
      return { bg: "rgba(243, 106, 29, 0.12)", color: "#9b430c", borderColor: "rgba(243, 106, 29, 0.18)" };
    case "red":
      return { bg: "rgba(184, 49, 49, 0.12)", color: "#8f1d1d", borderColor: "rgba(184, 49, 49, 0.18)" };
    default:
      return { bg: "rgba(99, 92, 82, 0.10)", color: "#4c463e", borderColor: "rgba(99, 92, 82, 0.18)" };
  }
}

export function inputText(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : "-";
}
