import { Box, Button, Stack, Text } from "@chakra-ui/react";

import {
  DataTable,
  EmptyBlock,
  ListPaginationBar,
  ListTableSurface,
  StatusChip,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
} from "@/components/console-ui";
import type { ProviderServiceItem } from "@/services/admin-api";

import { ProviderServiceFilterForm } from "./provider-service-filters";
import {
  canDeleteProviderService,
  formatProviderServiceEpochMs,
  getProviderServiceTargetError,
  PROVIDER_SERVICE_PAGE_SIZE_OPTIONS,
  type ProviderServiceAction,
} from "./provider-service-presenters";
import type { useProviderServices } from "./use-provider-services";

type ProviderServicesState = ReturnType<typeof useProviderServices>;

export function ProviderServiceRegistry({
  canSubmitLifecycleAction,
  providerServices,
}: Readonly<{
  canSubmitLifecycleAction: boolean;
  providerServices: ProviderServicesState;
}>) {
  return (
    <ListTableSurface
      eyebrow="Gateway Provider Registry"
      title="服务注册表"
      description="默认展示非 deleted 服务；inactive 停止自动探活，active 不健康会自动摘流并在长期故障后进入 slow lane 降频探活，suspended 保留降频探活但禁止调用。"
      stamp={`第 ${providerServices.page} / ${providerServices.totalPages} 页`}
      filter={<ProviderServiceFilters providerServices={providerServices} />}
      table={
        <ProviderServiceTable
          busyServiceId={providerServices.busyServiceId}
          canSubmitLifecycleAction={canSubmitLifecycleAction}
          rows={providerServices.items}
          onAction={providerServices.runAction}
        />
      }
      pagination={
        <ProviderServicePagination providerServices={providerServices} />
      }
    />
  );
}

function ProviderServiceFilters({
  providerServices,
}: Readonly<{ providerServices: ProviderServicesState }>) {
  return (
    <ProviderServiceFilterForm
      filters={providerServices.filters}
      setFilter={providerServices.setFilter}
      onSubmit={providerServices.submitFilters}
      onReset={providerServices.resetFilters}
    />
  );
}

function ProviderServiceTable({
  busyServiceId,
  canSubmitLifecycleAction,
  onAction,
  rows,
}: Readonly<{
  busyServiceId: string | null;
  canSubmitLifecycleAction: boolean;
  onAction: (
    service: ProviderServiceItem,
    action: ProviderServiceAction
  ) => void;
  rows: ProviderServiceItem[];
}>) {
  if (rows.length === 0) {
    return (
      <EmptyBlock
        title="暂无 Provider 服务"
        description="当前筛选条件下没有可管理的注册服务。"
      />
    );
  }

  return (
    <DataTable>
      <TableHeaderRow>
        <Th>服务</Th>
        <Th>状态</Th>
        <Th>健康</Th>
        <Th>并发保护</Th>
        <Th>Provider</Th>
        <Th>最近错误</Th>
        <Th>操作</Th>
      </TableHeaderRow>
      <TableBody>
        {rows.map((service) => (
          <ProviderServiceRow
            key={service.serviceId}
            busy={busyServiceId === service.serviceId}
            canSubmitLifecycleAction={canSubmitLifecycleAction}
            service={service}
            onAction={onAction}
          />
        ))}
      </TableBody>
    </DataTable>
  );
}

function ProviderServiceRow({
  busy,
  canSubmitLifecycleAction,
  onAction,
  service,
}: Readonly<{
  busy: boolean;
  canSubmitLifecycleAction: boolean;
  onAction: (
    service: ProviderServiceItem,
    action: ProviderServiceAction
  ) => void;
  service: ProviderServiceItem;
}>) {
  return (
    <Box as="tr">
      <ProviderServiceIdentityCell service={service} />
      <ProviderServiceStatusCell service={service} />
      <ProviderServiceHealthCell service={service} />
      <ProviderServiceConcurrencyCell service={service} />
      <Td>
        <Text fontFamily="mono" fontSize="12px">
          {service.ownerAddress}
        </Text>
      </Td>
      <Td>
        <Text color="ink.500" fontSize="13px" maxW="260px">
          {getProviderServiceTargetError(service)}
        </Text>
      </Td>
      <ProviderServiceActionCell
        busy={busy}
        canSubmitLifecycleAction={canSubmitLifecycleAction}
        service={service}
        onAction={onAction}
      />
    </Box>
  );
}

function ProviderServiceIdentityCell({
  service,
}: Readonly<{ service: ProviderServiceItem }>) {
  return (
    <Td>
      <Stack gap="4px">
        <Text fontWeight="800">{service.serviceName}</Text>
        <Text color="ink.500" fontSize="13px">
          {service.serviceId}
        </Text>
        <Text color="ink.500" fontSize="13px">
          {service.summary || "无摘要"}
        </Text>
        <Text color="ink.500" fontSize="12px">
          {service.pricing.amount} {service.pricing.currency} ·{" "}
          {service.tags.join(", ") || "no tags"}
        </Text>
      </Stack>
    </Td>
  );
}

function ProviderServiceStatusCell({
  service,
}: Readonly<{ service: ProviderServiceItem }>) {
  return (
    <Td>
      <Stack gap="8px">
        <StatusChip value={service.controlStatus} />
        <StatusChip value={service.runtimeStatus} />
        <Text color="ink.500" fontSize="12px">
          runtimeAvailable: {service.runtimeAvailable ? "yes" : "no"}
        </Text>
      </Stack>
    </Td>
  );
}

function ProviderServiceHealthCell({
  service,
}: Readonly<{ service: ProviderServiceItem }>) {
  return (
    <Td>
      <Stack gap="4px">
        <Text fontWeight="700">
          {service.health.healthyTargets ?? 0}/
          {service.health.totalTargets ?? 0} healthy
        </Text>
        <Text color="ink.500" fontSize="12px">
          probe tier:{" "}
          {service.probeTier || service.health.probeTier || "normal"}
        </Text>
        <Text color="ink.500" fontSize="12px">
          last checked:{" "}
          {formatProviderServiceEpochMs(service.health.lastCheckedAt)}
        </Text>
        <Text color="ink.500" fontSize="12px">
          stale: {service.health.isStale ? "yes" : "no"}
        </Text>
      </Stack>
    </Td>
  );
}

function ProviderServiceConcurrencyCell({
  service,
}: Readonly<{ service: ProviderServiceItem }>) {
  return (
    <Td>
      <Stack gap="4px">
        <StatusChip value={service.circuitState} />
        <Text fontWeight="700">
          {service.inFlight}/{service.adaptiveConcurrencyLimit} in flight
        </Text>
        <Text color="ink.500" fontSize="12px">
          queue depth: {service.queueDepth}
        </Text>
        <Text color="ink.500" fontSize="12px">
          p95: {service.latencyP95Ms}ms · error:{" "}
          {(service.errorRate * 100).toFixed(1)}%
        </Text>
        <Text color="ink.500" fontSize="12px">
          adjusted:{" "}
          {formatProviderServiceEpochMs(service.lastConcurrencyAdjustmentAt)}
        </Text>
      </Stack>
    </Td>
  );
}

function ProviderServiceActionCell({
  busy,
  canSubmitLifecycleAction,
  onAction,
  service,
}: Readonly<{
  busy: boolean;
  canSubmitLifecycleAction: boolean;
  onAction: (
    service: ProviderServiceItem,
    action: ProviderServiceAction
  ) => void;
  service: ProviderServiceItem;
}>) {
  return (
    <Td>
      <Stack
        direction={{ base: "column", xl: "row" }}
        gap="8px"
        flexWrap="wrap"
      >
        <ProviderServiceActionButton
          busy={busy}
          label="Force probe"
          onClick={() => onAction(service, "probe")}
        />
        <ProviderServiceLifecycleButton
          canSubmitLifecycleAction={canSubmitLifecycleAction}
          service={service}
          onAction={onAction}
        />
        <ProviderServiceActionButton
          disabled={!canSubmitLifecycleAction}
          label="Suspend"
          onClick={() => onAction(service, "suspend")}
        />
        <ProviderServiceActionButton
          disabled={
            !canSubmitLifecycleAction || !canDeleteProviderService(service)
          }
          label="Delete"
          tone="danger"
          onClick={() => onAction(service, "delete")}
        />
      </Stack>
    </Td>
  );
}

function ProviderServiceLifecycleButton({
  canSubmitLifecycleAction,
  onAction,
  service,
}: Readonly<{
  canSubmitLifecycleAction: boolean;
  onAction: (
    service: ProviderServiceItem,
    action: ProviderServiceAction
  ) => void;
  service: ProviderServiceItem;
}>) {
  const isActive = service.controlStatus === "active";
  return (
    <ProviderServiceActionButton
      disabled={!canSubmitLifecycleAction}
      label={isActive ? "Pause" : "Resume"}
      onClick={() => onAction(service, isActive ? "pause" : "resume")}
    />
  );
}

function ProviderServiceActionButton({
  busy = false,
  disabled = false,
  label,
  onClick,
  tone = "default",
}: Readonly<{
  busy?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  tone?: "danger" | "default";
}>) {
  return (
    <Button
      size="sm"
      borderRadius="14px"
      variant="ghost"
      color={tone === "danger" ? "#8f1d1d" : undefined}
      disabled={disabled}
      loading={busy}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function ProviderServicePagination({
  providerServices,
}: Readonly<{ providerServices: ProviderServicesState }>) {
  return (
    <ListPaginationBar
      pageSize={providerServices.pageSize}
      pageSizeOptions={PROVIDER_SERVICE_PAGE_SIZE_OPTIONS}
      totalPages={providerServices.totalPages}
      totalCount={providerServices.totalCount}
      currentPage={providerServices.page}
      canPrevious={providerServices.page > 1}
      canNext={providerServices.page < providerServices.totalPages}
      onPageSizeChange={providerServices.setPageSize}
      onPrevious={() =>
        providerServices.setPage((current) => Math.max(1, current - 1))
      }
      onNext={() =>
        providerServices.setPage((current) =>
          Math.min(providerServices.totalPages, current + 1)
        )
      }
    />
  );
}
