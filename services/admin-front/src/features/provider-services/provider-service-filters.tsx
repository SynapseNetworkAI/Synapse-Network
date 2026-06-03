import {
  ListFilterFieldPresets,
  ListFilterFields,
  ListFilterForm,
} from "@/components/console-ui";

import {
  PROVIDER_SERVICE_CONTROL_STATUS_OPTIONS,
  PROVIDER_SERVICE_RUNTIME_STATUS_OPTIONS,
  type ProviderServiceFilters,
} from "./provider-service-presenters";

export function ProviderServiceFilterForm({
  filters,
  onReset,
  onSubmit,
  setFilter,
}: Readonly<{
  filters: ProviderServiceFilters;
  onReset: () => void;
  onSubmit: () => void;
  setFilter: <Key extends keyof ProviderServiceFilters>(
    key: Key,
    value: ProviderServiceFilters[Key]
  ) => void;
}>) {
  return (
    <ListFilterForm
      onSubmit={onSubmit}
      onReset={onReset}
      submitLabel="搜索服务"
    >
      <ListFilterFields
        templateColumns={{ base: "1fr", lg: "2fr 1fr 1fr" }}
        fields={[
          ListFilterFieldPresets.keyword({
            value: filters.query,
            onChange: (value) => setFilter("query", value),
            placeholder: "搜索 serviceId、服务名、Provider 或 tag",
          }),
          ListFilterFieldPresets.status({
            key: "controlStatus",
            value: filters.controlStatus,
            onChange: (value) => setFilter("controlStatus", value),
            allLabel: "全部控制状态",
            options: PROVIDER_SERVICE_CONTROL_STATUS_OPTIONS,
          }),
          ListFilterFieldPresets.status({
            key: "runtimeStatus",
            value: filters.runtimeStatus,
            onChange: (value) => setFilter("runtimeStatus", value),
            allLabel: "全部运行状态",
            options: PROVIDER_SERVICE_RUNTIME_STATUS_OPTIONS,
          }),
        ]}
      />
    </ListFilterForm>
  );
}
