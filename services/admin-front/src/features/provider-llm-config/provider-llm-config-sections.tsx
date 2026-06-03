import {
  Badge,
  Box,
  Button,
  Grid,
  HStack,
  Link as ChakraLink,
  Stack,
  Text,
} from "@chakra-ui/react";

import {
  DataTable,
  EmptyBlock,
  ListTableSurface,
  MetricCard,
  StatusChip,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
} from "@/components/console-ui";
import type {
  ProviderLlmConfigSnapshot,
  ProviderLlmModelConfig,
  ProviderLlmRolloutState,
  ProviderLlmVendorConfig,
} from "@/services/provider-llm-config-api";

import {
  buildProviderLlmRolloutMetrics,
  findProviderLlmRollout,
  getProviderLlmServiceId,
  type ProviderLlmRolloutAction,
} from "./provider-llm-config-presenters";

type RolloutHandler = (
  model: ProviderLlmModelConfig,
  action: ProviderLlmRolloutAction
) => void;

export function ProviderLlmRolloutMetrics({
  snapshot,
}: Readonly<{ snapshot: ProviderLlmConfigSnapshot | null }>) {
  const metrics = buildProviderLlmRolloutMetrics(snapshot);
  return (
    <Grid templateColumns={{ base: "1fr", md: "repeat(4, 1fr)" }} gap="16px">
      <MetricCard label="Vendors" value={metrics.vendors} meta="上游供应商" />
      <MetricCard
        label="Models"
        value={metrics.models}
        meta="绑定 Synapse service"
      />
      <MetricCard
        label="Pricing Review"
        value={metrics.pricingBlocked}
        meta="operator review required"
      />
      <MetricCard
        label="Prod Opt-in"
        value={metrics.prodOptIn}
        meta="生产显式启用"
      />
    </Grid>
  );
}

export function ProviderLlmVendorTable({
  vendors,
}: Readonly<{ vendors: ProviderLlmVendorConfig[] }>) {
  return (
    <ListTableSurface
      eyebrow="Upstream Providers"
      title="上游供应商"
      description="只展示运行态配置引用和 smoke 状态；上游 API key 必须留在 Secret Manager 或部署环境。"
      stamp={`${vendors.length} vendors`}
      filter={null}
      table={
        <DataTable>
          <TableHeaderRow>
            <Th>Provider</Th>
            <Th>Base URL</Th>
            <Th>Secret</Th>
            <Th>Smoke</Th>
            <Th>Docs</Th>
          </TableHeaderRow>
          <TableBody>
            {vendors.map((vendor) => (
              <ProviderLlmVendorRow key={vendor.providerCode} vendor={vendor} />
            ))}
          </TableBody>
        </DataTable>
      }
    />
  );
}

export function ProviderLlmModelCatalogTable({
  busyServiceId,
  models,
  onRequestRollout,
  rollouts,
}: Readonly<{
  busyServiceId: string | null;
  models: ProviderLlmModelConfig[];
  onRequestRollout: RolloutHandler;
  rollouts: ProviderLlmRolloutState[];
}>) {
  return (
    <ListTableSurface
      eyebrow="Model Catalog"
      title="模型目录与上线闸门"
      description="v1 固定 stream=false；生产启用必须先完成价格复核和显式 opt-in。"
      stamp={`${models.length} models`}
      filter={null}
      table={
        models.length === 0 ? (
          <EmptyBlock
            title="暂无模型"
            description="当前没有可治理的 LLM 模型。"
          />
        ) : (
          <DataTable>
            <TableHeaderRow>
              <Th>Model</Th>
              <Th>Service</Th>
              <Th>Capabilities</Th>
              <Th>Pricing</Th>
              <Th>Prod Gate</Th>
              <Th>Actions</Th>
            </TableHeaderRow>
            <TableBody>
              {models.map((model) => (
                <ProviderLlmModelRow
                  key={`${model.providerCode}:${model.modelId}`}
                  busyServiceId={busyServiceId}
                  model={model}
                  rollout={findProviderLlmRollout(
                    rollouts,
                    getProviderLlmServiceId(model)
                  )}
                  onRequestRollout={onRequestRollout}
                />
              ))}
            </TableBody>
          </DataTable>
        )
      }
    />
  );
}

function ProviderLlmVendorRow({
  vendor,
}: Readonly<{ vendor: ProviderLlmVendorConfig }>) {
  return (
    <Box as="tr">
      <Td>
        <Text fontWeight="800">{vendor.displayName}</Text>
        <Text color="ink.500" fontSize="13px">
          {vendor.providerCode}
        </Text>
      </Td>
      <Td>
        <Text fontSize="13px">{vendor.baseUrl}</Text>
      </Td>
      <Td>
        <Badge colorScheme={vendor.secretPresent ? "green" : "orange"}>
          {vendor.secretPresent ? "present" : "missing"}
        </Badge>
        <Text mt="4px" color="ink.500" fontSize="12px">
          {vendor.secretReference}
        </Text>
      </Td>
      <Td>
        <StatusChip value={vendor.lastSmokeStatus} />
      </Td>
      <Td>
        <HStack gap="10px">
          <ChakraLink href={vendor.apiDocsUrl} target="_blank" color="blue.600">
            API
          </ChakraLink>
          <ChakraLink href={vendor.pricingUrl} target="_blank" color="blue.600">
            Pricing
          </ChakraLink>
        </HStack>
      </Td>
    </Box>
  );
}

function ProviderLlmModelRow({
  busyServiceId,
  model,
  onRequestRollout,
  rollout,
}: Readonly<{
  busyServiceId: string | null;
  model: ProviderLlmModelConfig;
  onRequestRollout: RolloutHandler;
  rollout: ProviderLlmRolloutState | null;
}>) {
  const serviceId = getProviderLlmServiceId(model);
  const busy = busyServiceId === serviceId;
  return (
    <Box as="tr">
      <Td>
        <Text fontWeight="800">{model.displayName}</Text>
        <Text color="ink.500" fontSize="13px">
          {model.modelId}
        </Text>
      </Td>
      <Td>
        <Text fontSize="13px">{serviceId}</Text>
      </Td>
      <Td>
        <Stack gap="4px">
          <Text fontSize="13px">
            streaming: {model.supportsStreaming ? "yes" : "no"}
          </Text>
          <Text fontSize="13px">
            tools: {model.supportsToolCalling ? "yes" : "no"}
          </Text>
        </Stack>
      </Td>
      <Td>
        <StatusChip value={model.status} />
      </Td>
      <Td>
        <StatusChip value={rollout?.eligibilityStatus ?? "unknown"} />
        <Text mt="4px" color="ink.500" fontSize="12px">
          prod opt-in: {rollout?.prodOptIn ? "yes" : "no"}
        </Text>
      </Td>
      <Td>
        <HStack gap="8px">
          <Button
            size="sm"
            loading={busy}
            onClick={() => onRequestRollout(model, "smoke")}
          >
            staging smoke
          </Button>
          <Button
            size="sm"
            colorScheme="orange"
            loading={busy}
            onClick={() => onRequestRollout(model, "prod_enable")}
          >
            prod enable
          </Button>
        </HStack>
      </Td>
    </Box>
  );
}
