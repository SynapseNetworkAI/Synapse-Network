"use client";

import { useEffect, useMemo, useState } from "react";

import {
  deleteProviderService,
  forceProbeProviderService,
  listProviderServices,
  updateProviderServiceLifecycle,
  type ProviderServiceItem,
  type ProviderServiceListResponse,
} from "@/services/admin-api";

import {
  buildProviderServiceActionNotice,
  buildProviderServiceLifecycleNote,
  buildProviderServiceListParams,
  PROVIDER_SERVICE_DEFAULT_FILTERS,
  resolveProviderServiceLifecycleAction,
  type ProviderServiceAction,
  type ProviderServiceFilters,
} from "./provider-service-presenters";

export function useProviderServices(token: string | null) {
  const pagination = useProviderServicePagination();
  const filterState = useProviderServiceFilters(pagination.resetPage);
  const [payload, setPayload] = useState<ProviderServiceListResponse | null>(
    null
  );
  const [bootstrapping, setBootstrapping] = useState(true);
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const params = useMemo(
    () =>
      buildProviderServiceListParams({
        filters: filterState.filters,
        page: pagination.page,
        pageSize: pagination.pageSize,
      }),
    [filterState.filters, pagination.page, pagination.pageSize]
  );

  useProviderServicesLoader({
    params,
    setBootstrapping,
    setError,
    setPayload,
    token,
  });

  async function refresh() {
    if (!token) {
      return;
    }
    setPayload(await listProviderServices(token, params));
  }

  async function runAction(
    service: ProviderServiceItem,
    action: ProviderServiceAction
  ) {
    if (!token) {
      return;
    }
    await submitProviderServiceAction({
      action,
      refresh,
      service,
      setBusyServiceId,
      setError,
      setNotice,
      token,
    });
  }

  return {
    bootstrapping,
    busyServiceId,
    error,
    filters: filterState.filters,
    items: payload?.items ?? [],
    notice,
    page: pagination.page,
    pageSize: pagination.pageSize,
    resetFilters: filterState.resetFilters,
    runAction,
    setFilter: filterState.setFilter,
    setPage: pagination.setPage,
    setPageSize: pagination.setPageSize,
    submitFilters: filterState.submitFilters,
    totalCount: payload?.totalCount ?? 0,
    totalPages: payload?.totalPages ?? 1,
  };
}

function useProviderServicePagination() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(20);

  return {
    page,
    pageSize,
    resetPage: () => setPage(1),
    setPage,
    setPageSize: (nextPageSize: number) => {
      setPageSizeState(nextPageSize);
      setPage(1);
    },
  };
}

function useProviderServiceFilters(resetPage: () => void) {
  const [filters, setFilters] = useState<ProviderServiceFilters>(
    PROVIDER_SERVICE_DEFAULT_FILTERS
  );

  return {
    filters,
    resetFilters: () => {
      setFilters(PROVIDER_SERVICE_DEFAULT_FILTERS);
      resetPage();
    },
    setFilter: <Key extends keyof ProviderServiceFilters>(
      key: Key,
      value: ProviderServiceFilters[Key]
    ) => {
      setFilters((current) => ({ ...current, [key]: value }));
      if (key !== "query") {
        resetPage();
      }
    },
    submitFilters: () => {
      resetPage();
      setFilters((current) => ({
        ...current,
        submittedQuery: current.query.trim(),
      }));
    },
  };
}

function useProviderServicesLoader({
  params,
  setBootstrapping,
  setError,
  setPayload,
  token,
}: Readonly<{
  params: Parameters<typeof listProviderServices>[1];
  setBootstrapping: (value: boolean) => void;
  setError: (value: string | null) => void;
  setPayload: (value: ProviderServiceListResponse | null) => void;
  token: string | null;
}>) {
  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    void loadProviderServices({
      isCancelled: () => cancelled,
      params,
      setBootstrapping,
      setError,
      setPayload,
      token,
    });
    return () => {
      cancelled = true;
    };
  }, [params, setBootstrapping, setError, setPayload, token]);
}

async function loadProviderServices({
  isCancelled,
  params,
  setBootstrapping,
  setError,
  setPayload,
  token,
}: Readonly<{
  isCancelled: () => boolean;
  params: Parameters<typeof listProviderServices>[1];
  setBootstrapping: (value: boolean) => void;
  setError: (value: string | null) => void;
  setPayload: (value: ProviderServiceListResponse | null) => void;
  token: string;
}>) {
  try {
    setError(null);
    const result = await listProviderServices(token, params);
    if (!isCancelled()) {
      setPayload(result);
    }
  } catch (loadError) {
    if (!isCancelled()) {
      setError(errorMessage(loadError, "加载 Provider 服务失败"));
    }
  } finally {
    if (!isCancelled()) {
      setBootstrapping(false);
    }
  }
}

async function submitProviderServiceAction({
  action,
  refresh,
  service,
  setBusyServiceId,
  setError,
  setNotice,
  token,
}: Readonly<{
  action: ProviderServiceAction;
  refresh: () => Promise<void>;
  service: ProviderServiceItem;
  setBusyServiceId: (value: string | null) => void;
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
  token: string;
}>) {
  setBusyServiceId(service.serviceId);
  setError(null);
  setNotice(null);
  try {
    await executeProviderServiceAction(token, service.serviceId, action);
    setNotice(buildProviderServiceActionNotice(service, action));
    await refresh();
  } catch (actionError) {
    setError(errorMessage(actionError, "Provider 服务操作失败"));
  } finally {
    setBusyServiceId(null);
  }
}

async function executeProviderServiceAction(
  token: string,
  serviceId: string,
  action: ProviderServiceAction
): Promise<void> {
  if (action === "probe") {
    await forceProbeProviderService(token, serviceId);
    return;
  }
  if (action === "delete") {
    await deleteProviderService(
      token,
      serviceId,
      "Deleted from provider service control plane."
    );
    return;
  }

  const lifecycleAction = resolveProviderServiceLifecycleAction(action);
  if (!lifecycleAction) {
    return;
  }
  await updateProviderServiceLifecycle(token, serviceId, {
    action: lifecycleAction,
    note: buildProviderServiceLifecycleNote(lifecycleAction),
  });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
