export function formatUsdc(value: string | number | null | undefined): string {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return "0.00";
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
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