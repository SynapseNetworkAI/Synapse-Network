"use client";

import { useEffect, useMemo, useState } from "react";

import { omitDiagnosticSignals } from "@/features/diagnostics/diagnostic-presenters";
import { useDiagnosticsSnapshot } from "@/lib/use-diagnostics-snapshot";
import {
  getOperationsOverview,
  getSystemStatus,
  type OperationsOverview,
  type SystemStatus,
} from "@/services/admin-api";

import { buildRuntimeCards, buildSystemMetrics } from "./system-presenters";

export function useSystemStatus(token: string | null) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [operations, setOperations] = useState<OperationsOverview | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { diagnostics, diagnosticError } = useDiagnosticsSnapshot(token, {
    suppressInitialLoading: true,
    loadErrorMessage: "加载共享诊断快照失败",
  });

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    void loadSystemStatus({
      isCancelled: () => cancelled,
      setBootstrapping,
      setError,
      setOperations,
      setStatus,
      token,
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return {
    bootstrapping,
    diagnosticError,
    error,
    metrics: useMemo(() => {
      if (!status || !operations) {
        return null;
      }
      return buildSystemMetrics(status, operations);
    }, [operations, status]),
    operations,
    runtimeCards: useMemo(() => {
      if (!operations) {
        return [];
      }
      return buildRuntimeCards(operations);
    }, [operations]),
    status,
    systemDiagnostics: useMemo(
      () =>
        omitDiagnosticSignals(diagnostics, ["reconciliation"], {
          actionIds: ["system-center"],
        }),
      [diagnostics]
    ),
  };
}

async function loadSystemStatus({
  isCancelled,
  setBootstrapping,
  setError,
  setOperations,
  setStatus,
  token,
}: Readonly<{
  isCancelled: () => boolean;
  setBootstrapping: (value: boolean) => void;
  setError: (value: string | null) => void;
  setOperations: (value: OperationsOverview) => void;
  setStatus: (value: SystemStatus) => void;
  token: string;
}>) {
  try {
    const [systemStatus, operationsOverview] = await Promise.all([
      getSystemStatus(token),
      getOperationsOverview(token),
    ]);
    if (isCancelled()) {
      return;
    }
    setStatus(systemStatus);
    setOperations(operationsOverview);
  } catch (loadError) {
    if (!isCancelled()) {
      setError(
        loadError instanceof Error ? loadError.message : "加载系统运维模块失败"
      );
    }
  } finally {
    if (!isCancelled()) {
      setBootstrapping(false);
    }
  }
}
