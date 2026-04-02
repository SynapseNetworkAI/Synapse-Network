"use client";

import { useCallback, useEffect, useState } from "react";

import { getDashboardDiagnostics, type DashboardDiagnostics } from "@/services/admin-api";

type UseDiagnosticsSnapshotOptions = {
  auto?: boolean;
  suppressInitialLoading?: boolean;
  loadErrorMessage?: string;
};

export function useDiagnosticsSnapshot(token: string | null | undefined, options?: UseDiagnosticsSnapshotOptions) {
  const [diagnostics, setDiagnostics] = useState<DashboardDiagnostics | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);

  const loadErrorMessage = options?.loadErrorMessage ?? "加载系统诊断失败";

  const refreshDiagnostics = useCallback(async (nextToken: string, refreshOptions?: { silent?: boolean }) => {
    if (!refreshOptions?.silent) {
      setDiagnosticsLoading(true);
    }
    try {
      const snapshot = await getDashboardDiagnostics(nextToken);
      setDiagnostics(snapshot);
      setDiagnosticError(null);
      return snapshot;
    } catch (loadError) {
      setDiagnosticError(loadError instanceof Error ? loadError.message : loadErrorMessage);
      return null;
    } finally {
      if (!refreshOptions?.silent) {
        setDiagnosticsLoading(false);
      }
    }
  }, [loadErrorMessage]);

  useEffect(() => {
    if (!token || options?.auto === false) {
      return;
    }

    const activeToken = token;

    let cancelled = false;

    async function load() {
      if (!options?.suppressInitialLoading) {
        setDiagnosticsLoading(true);
      }

      try {
        const snapshot = await getDashboardDiagnostics(activeToken);
        if (!cancelled) {
          setDiagnostics(snapshot);
          setDiagnosticError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setDiagnosticError(loadError instanceof Error ? loadError.message : loadErrorMessage);
        }
      } finally {
        if (!cancelled && !options?.suppressInitialLoading) {
          setDiagnosticsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [loadErrorMessage, options?.auto, options?.suppressInitialLoading, token]);

  return {
    diagnostics,
    diagnosticError,
    diagnosticsLoading,
    refreshDiagnostics,
  };
}