import type { DashboardDiagnosticAction, DashboardDiagnosticSignal } from "@/services/admin-api";

export function getDiagnosticTone(status: string | null | undefined): "green" | "orange" | "red" | "gray" {
  if (status === "nominal") {
    return "green";
  }
  if (status === "monitoring") {
    return "orange";
  }
  if (status === "degraded") {
    return "red";
  }
  return "gray";
}

export function buildDiagnosticSignalCards(signals: DashboardDiagnosticSignal[]) {
  return signals.map((signal) => ({
    key: signal.signalId,
    label: signal.label,
    value: signal.value,
    detail: signal.detail,
    status: signal.status,
    tone: getDiagnosticTone(signal.status),
  }));
}

export function buildDiagnosticActionCards(actions: DashboardDiagnosticAction[]) {
  return actions.map((action) => ({
    key: action.actionId,
    label: action.label,
    detail: action.detail,
    href: action.href,
    status: action.status,
    tone: getDiagnosticTone(action.status),
  }));
}