"use client";

import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import {
  DataTable,
  EmptyBlock,
  ListFilterFieldPresets,
  ListFilterFields,
  ListFilterForm,
  ListPaginationBar,
  ListTableSurface,
  MessageBanner,
  StatusChip,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
} from "@/components/console-ui";
import { formatDateTime } from "@/lib/admin-console";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  deleteProviderService,
  forceProbeProviderService,
  listProviderServices,
  updateProviderServiceLifecycle,
  type ProviderServiceItem,
  type ProviderServiceListResponse,
} from "@/services/admin-api";

const controlStatusOptions = [
  { value: "active", label: "active" },
  { value: "inactive", label: "inactive" },
  { value: "suspended", label: "suspended" },
  { value: "draft", label: "draft" },
];

const runtimeStatusOptions = [
  { value: "healthy", label: "healthy" },
  { value: "degraded", label: "degraded" },
  { value: "unhealthy", label: "unhealthy" },
  { value: "stale", label: "stale" },
  { value: "unknown", label: "unknown" },
  { value: "inactive", label: "inactive" },
  { value: "suspended", label: "suspended" },
];

function formatEpochMs(value: number | null | undefined): string {
  if (!value) {
    return "n/a";
  }
  return formatDateTime(new Date(value).toISOString());
}

function targetError(service: ProviderServiceItem): string {
  const failing = service.targets.find((target) => target.error);
  return failing?.error ?? "无最近错误";
}

export default function ProviderServicesPage() {
  const { admin, token, loading } = useAdminSession();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [controlStatus, setControlStatus] = useState("all");
  const [runtimeStatus, setRuntimeStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [payload, setPayload] = useState<ProviderServiceListResponse | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const params = useMemo(() => ({
    query: submittedQuery || undefined,
    status: controlStatus === "all" ? undefined : controlStatus,
    runtimeStatus: runtimeStatus === "all" ? undefined : runtimeStatus,
    page,
    pageSize,
  }), [controlStatus, page, pageSize, runtimeStatus, submittedQuery]);

  async function load(activeToken: string) {
    const result = await listProviderServices(activeToken, params);
    setPayload(result);
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;
    async function run() {
      try {
        setError(null);
        const result = await listProviderServices(activeToken, params);
        if (!cancelled) {
          setPayload(result);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载 Provider 服务失败");
        }
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [params, token]);

  async function runAction(service: ProviderServiceItem, action: "probe" | "pause" | "resume" | "suspend" | "delete") {
    if (!token) {
      return;
    }
    setBusyServiceId(service.serviceId);
    setError(null);
    setNotice(null);
    try {
      if (action === "probe") {
        await forceProbeProviderService(token, service.serviceId);
        setNotice(`已触发 ${service.serviceName} 的即时探活。`);
      } else if (action === "delete") {
        await deleteProviderService(token, service.serviceId, "Deleted from provider service control plane.");
        setNotice(`已逻辑删除 ${service.serviceName}。`);
      } else {
        const lifecycleAction = action === "pause" ? "PAUSE" : action === "resume" ? "RESUME" : "SUSPEND";
        await updateProviderServiceLifecycle(token, service.serviceId, {
          action: lifecycleAction,
          note: `${lifecycleAction} from provider service control plane.`,
        });
        setNotice(`已执行 ${lifecycleAction}: ${service.serviceName}`);
      }
      await load(token);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Provider 服务操作失败");
    } finally {
      setBusyServiceId(null);
    }
  }

  if (loading || !admin || bootstrapping) {
    return <ControlPlaneLoadingScreen title="Provider Registry Sync" message="正在同步 Gateway Provider 服务注册表..." />;
  }

  const canSubmitLifecycleAction = admin.permissions.includes("approval:submit");
  const rows = payload?.items ?? [];
  const totalPages = payload?.totalPages ?? 1;
  const totalCount = payload?.totalCount ?? 0;

  return (
    <AdminShell
      admin={admin}
      eyebrow="Provider Registry"
      title="Provider 服务管理"
      description="这里管理注册到 Gateway 的 Provider 服务。控制面状态负责上线/暂停/冻结，运行时健康负责自动摘流和恢复，二者不互相污染。"
    >
      <Stack gap="16px">
        {error ? <MessageBanner kind="error" message={error} /> : null}
        {notice ? <MessageBanner kind="success" message={notice} /> : null}
        <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap="16px">
          <Box borderRadius="24px" bg="rgba(255,255,255,0.92)" border="1px solid rgba(15,17,21,0.06)" p="18px">
            <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">Registered</Text>
            <Heading mt="10px" size="lg">{totalCount}</Heading>
            <Text mt="6px" color="ink.500">非 deleted 服务总数</Text>
          </Box>
          <Box borderRadius="24px" bg="rgba(255,255,255,0.92)" border="1px solid rgba(15,17,21,0.06)" p="18px">
            <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">Auto drain rule</Text>
            <Heading mt="10px" size="md">healthy target required</Heading>
            <Text mt="6px" color="ink.500">无 healthy target 时自动从 discovery / invoke 摘流</Text>
          </Box>
          <Box borderRadius="24px" bg="rgba(255,255,255,0.92)" border="1px solid rgba(15,17,21,0.06)" p="18px">
            <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="ink.500">Slow lane</Text>
            <Heading mt="10px" size="md">reduced probe, not stopped</Heading>
            <Text mt="6px" color="ink.500">长期 unhealthy 会降频探活，但不会自动改 inactive</Text>
          </Box>
        </Grid>

        <ListTableSurface
          eyebrow="Gateway Provider Registry"
          title="服务注册表"
          description="默认展示非 deleted 服务；inactive 停止自动探活，active 不健康会自动摘流并在长期故障后进入 slow lane 降频探活，suspended 保留降频探活但禁止调用。"
          stamp={`第 ${page} / ${totalPages} 页`}
          filter={
            <ListFilterForm
              onSubmit={() => {
                setPage(1);
                setSubmittedQuery(query.trim());
              }}
              onReset={() => {
                setQuery("");
                setSubmittedQuery("");
                setControlStatus("all");
                setRuntimeStatus("all");
                setPage(1);
              }}
              submitLabel="搜索服务"
            >
              <ListFilterFields
                templateColumns={{ base: "1fr", lg: "2fr 1fr 1fr" }}
                fields={[
                  ListFilterFieldPresets.keyword({
                    value: query,
                    onChange: setQuery,
                    placeholder: "搜索 serviceId、服务名、Provider 或 tag",
                  }),
                  ListFilterFieldPresets.status({
                    key: "controlStatus",
                    value: controlStatus,
                    onChange: (value) => {
                      setControlStatus(value);
                      setPage(1);
                    },
                    allLabel: "全部控制状态",
                    options: controlStatusOptions,
                  }),
                  ListFilterFieldPresets.status({
                    key: "runtimeStatus",
                    value: runtimeStatus,
                    onChange: (value) => {
                      setRuntimeStatus(value);
                      setPage(1);
                    },
                    allLabel: "全部运行状态",
                    options: runtimeStatusOptions,
                  }),
                ]}
              />
            </ListFilterForm>
          }
          table={
            rows.length === 0 ? (
              <EmptyBlock title="暂无 Provider 服务" description="当前筛选条件下没有可管理的注册服务。" />
            ) : (
              <DataTable>
                <TableHeaderRow>
                  <Th>服务</Th>
                  <Th>状态</Th>
                  <Th>健康</Th>
                  <Th>Provider</Th>
                  <Th>最近错误</Th>
                  <Th>操作</Th>
                </TableHeaderRow>
                <TableBody>
                  {rows.map((service) => (
                    <Box as="tr" key={service.serviceId}>
                      <Td>
                        <Stack gap="4px">
                          <Text fontWeight="800">{service.serviceName}</Text>
                          <Text color="ink.500" fontSize="13px">{service.serviceId}</Text>
                          <Text color="ink.500" fontSize="13px">{service.summary || "无摘要"}</Text>
                          <Text color="ink.500" fontSize="12px">{service.pricing.amount} {service.pricing.currency} · {service.tags.join(", ") || "no tags"}</Text>
                        </Stack>
                      </Td>
                      <Td>
                        <Stack gap="8px">
                          <StatusChip value={service.controlStatus} />
                          <StatusChip value={service.runtimeStatus} />
                          <Text color="ink.500" fontSize="12px">runtimeAvailable: {service.runtimeAvailable ? "yes" : "no"}</Text>
                        </Stack>
                      </Td>
                      <Td>
                        <Stack gap="4px">
                          <Text fontWeight="700">{service.health.healthyTargets ?? 0}/{service.health.totalTargets ?? 0} healthy</Text>
                          <Text color="ink.500" fontSize="12px">probe tier: {service.probeTier || service.health.probeTier || "normal"}</Text>
                          <Text color="ink.500" fontSize="12px">last checked: {formatEpochMs(service.health.lastCheckedAt)}</Text>
                          <Text color="ink.500" fontSize="12px">stale: {service.health.isStale ? "yes" : "no"}</Text>
                        </Stack>
                      </Td>
                      <Td>
                        <Text fontFamily="mono" fontSize="12px">{service.ownerAddress}</Text>
                      </Td>
                      <Td>
                        <Text color="ink.500" fontSize="13px" maxW="260px">{targetError(service)}</Text>
                      </Td>
                      <Td>
                        <Stack direction={{ base: "column", xl: "row" }} gap="8px" flexWrap="wrap">
                          <Button size="sm" borderRadius="14px" variant="ghost" loading={busyServiceId === service.serviceId} onClick={() => void runAction(service, "probe")}>Force probe</Button>
                          {service.controlStatus === "active" ? (
                            <Button size="sm" borderRadius="14px" variant="ghost" disabled={!canSubmitLifecycleAction} onClick={() => void runAction(service, "pause")}>Pause</Button>
                          ) : (
                            <Button size="sm" borderRadius="14px" variant="ghost" disabled={!canSubmitLifecycleAction} onClick={() => void runAction(service, "resume")}>Resume</Button>
                          )}
                          <Button size="sm" borderRadius="14px" variant="ghost" disabled={!canSubmitLifecycleAction} onClick={() => void runAction(service, "suspend")}>Suspend</Button>
                          <Button size="sm" borderRadius="14px" variant="ghost" color="#8f1d1d" disabled={!canSubmitLifecycleAction || service.controlStatus === "active"} onClick={() => void runAction(service, "delete")}>Delete</Button>
                        </Stack>
                      </Td>
                    </Box>
                  ))}
                </TableBody>
              </DataTable>
            )
          }
          pagination={
            <ListPaginationBar
              pageSize={pageSize}
              pageSizeOptions={[10, 20, 50]}
              totalPages={totalPages}
              totalCount={totalCount}
              currentPage={page}
              canPrevious={page > 1}
              canNext={page < totalPages}
              onPageSizeChange={(nextPageSize) => {
                setPageSize(nextPageSize);
                setPage(1);
              }}
              onPrevious={() => setPage((current) => Math.max(1, current - 1))}
              onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
            />
          }
        />
      </Stack>
    </AdminShell>
  );
}
