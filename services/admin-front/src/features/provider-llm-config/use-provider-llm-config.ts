"use client";

import { useEffect, useState } from "react";

import {
  createProviderLlmRolloutRequest,
  getProviderLlmConfig,
  type ProviderLlmConfigSnapshot,
  type ProviderLlmModelConfig,
} from "@/services/provider-llm-config-api";

import {
  buildProviderLlmRolloutNote,
  formatProviderLlmRolloutNotice,
  getProviderLlmServiceId,
  resolveProviderLlmRolloutEnvironment,
  type ProviderLlmRolloutAction,
} from "./provider-llm-config-presenters";

export function useProviderLlmConfig(token: string | null) {
  const { bootstrapping, error, setError, snapshot } =
    useProviderLlmSnapshot(token);
  const { busyServiceId, notice, requestRollout } =
    useProviderLlmRolloutActions(token, setError);

  return {
    bootstrapping,
    busyServiceId,
    error,
    notice,
    requestRollout,
    snapshot,
  };
}

function useProviderLlmSnapshot(token: string | null) {
  const [snapshot, setSnapshot] = useState<ProviderLlmConfigSnapshot | null>(
    null
  );
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    setError(null);
    void loadProviderLlmSnapshot({
      isCancelled: () => cancelled,
      setBootstrapping,
      setError,
      setSnapshot,
    });
    return () => {
      cancelled = true;
    };
  }, [setBootstrapping, setError, setSnapshot, token]);

  return { bootstrapping, error, setError, snapshot };
}

async function loadProviderLlmSnapshot({
  isCancelled,
  setBootstrapping,
  setError,
  setSnapshot,
}: Readonly<{
  isCancelled: () => boolean;
  setBootstrapping: (value: boolean) => void;
  setError: (message: string | null) => void;
  setSnapshot: (snapshot: ProviderLlmConfigSnapshot | null) => void;
}>) {
  try {
    const result = await getProviderLlmConfig();
    if (!isCancelled()) {
      setSnapshot(result);
    }
  } catch (loadError) {
    if (!isCancelled()) {
      setError(errorMessage(loadError, "加载 LLM 配置失败"));
    }
  } finally {
    if (!isCancelled()) {
      setBootstrapping(false);
    }
  }
}

function useProviderLlmRolloutActions(
  token: string | null,
  setError: (message: string | null) => void
) {
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function requestRollout(
    model: ProviderLlmModelConfig,
    action: ProviderLlmRolloutAction
  ) {
    if (!token) {
      return;
    }

    const serviceId = getProviderLlmServiceId(model);
    setBusyServiceId(serviceId);
    setError(null);
    setNotice(null);
    try {
      const result = await createProviderLlmRolloutRequest({
        serviceId,
        environment: resolveProviderLlmRolloutEnvironment(action),
        action,
        note: buildProviderLlmRolloutNote(action),
      });
      setNotice(formatProviderLlmRolloutNotice(result));
    } catch (actionError) {
      setError(errorMessage(actionError, "LLM rollout request 失败"));
    } finally {
      setBusyServiceId(null);
    }
  }

  return { busyServiceId, notice, requestRollout };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
