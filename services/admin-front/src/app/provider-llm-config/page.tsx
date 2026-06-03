"use client";

import {
  Badge,
  Box,
  Button,
  Grid,
  Heading,
  HStack,
  Link,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import {
  DataTable,
  EmptyBlock,
  ListTableSurface,
  MessageBanner,
  StatusChip,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
} from "@/components/console-ui";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  createProviderLlmRolloutRequest,
  getProviderLlmConfig,
  type ProviderLlmConfigSnapshot,
  type ProviderLlmModelConfig,
  type ProviderLlmPricingReview,
  type ProviderLlmRolloutState,
  type ProviderLlmVendorConfig,
} from "@/services/provider-llm-config-api";

function findRollout(
  rollouts: ProviderLlmRolloutState[],
  serviceId: string
): ProviderLlmRolloutState | null {
  return rollouts.find((rollout) => rollout.serviceId === serviceId) ?? null;
}

export default function ProviderLlmConfigPage() {
  const { admin, token, loading } = useAdminSession();
  const { snapshot, bootstrapping, error, setError } = useProviderLlmSnapshot(token);
  const { busyServiceId, notice, requestRollout } = useLlmRolloutActions(token, setError);
  const readyAdmin = getReadyAdmin(admin, loading, bootstrapping);

  if (!readyAdmin) {
    return (
      <ControlPlaneLoadingScreen
        title="Provider LLM Config"
        message="正在同步上游模型目录和生产上线闸门..."
      />
    );
  }

  return (
    <ProviderLlmConfigContent
      admin={readyAdmin}
      snapshot={snapshot}
      error={error}
      notice={notice}
      busyServiceId={busyServiceId}
      onRequestRollout={requestRollout}
    />
  );
}

function getReadyAdmin(
  admin: ReturnType<typeof useAdminSession>["admin"],
  loading: boolean,
  bootstrapping: boolean
): ReturnType<typeof useAdminSession>["admin"] {
  if (loading || bootstrapping) {
    return null;
  }
  return admin;
}

function ProviderLlmConfigContent({
  admin,
  snapshot,
  error,
  notice,
  busyServiceId,
  onRequestRollout,
}: {
  admin: NonNullable<ReturnType<typeof useAdminSession>["admin"]>;
  snapshot: ProviderLlmConfigSnapshot | null;
  error: string | null;
  notice: string | null;
  busyServiceId: string | null;
  onRequestRollout: (model: ProviderLlmModelConfig, action: string) => void;
}) {
  const models = snapshot?.models ?? [];
  const rollouts = snapshot?.rolloutStates ?? [];
  return (
    <AdminShell
      admin={admin}
      eyebrow="Provider LLM Control"
      title="LLM 配置治理"
      description="管理 OpenAI-compatible 上游供应商、模型目录、价格复核和环境 rollout request。API key 只显示 secret reference，不进入注册表明文配置。"
    >
      <Stack gap="16px">
        {error ? <MessageBanner kind="error" message={error} /> : null}
        {notice ? <MessageBanner kind="success" message={notice} /> : null}

        <RolloutMetrics snapshot={snapshot} />
        <VendorTable vendors={snapshot?.vendors ?? []} />
        <ModelCatalogTable
          models={models}
          rollouts={rollouts}
          busyServiceId={busyServiceId}
          onRequestRollout={requestRollout}
        />
      </Stack>
    </AdminShell>
  );
}

function useProviderLlmSnapshot(token: string | null) {
  const [snapshot, setSnapshot] = useState<ProviderLlmConfigSnapshot | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    setError(null);
    void getProviderLlmConfig()
      .then((result) => {
        if (cancelled) {
          return;
        }
        setSnapshot(result);
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setError(errorMessage(loadError, "加载 LLM 配置失败"));
      })
      .finally(() => {
        if (!cancelled) {
          setBootstrapping(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return { snapshot, bootstrapping, error, setError };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function useLlmRolloutActions(
  token: string | null,
  setError: (message: string | null) => void
) {
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function requestRollout(model: ProviderLlmModelConfig, action: string) {
    if (!token) {
      return;
    }
    const serviceId = model.boundServiceIds[0] ?? model.modelId;
    setBusyServiceId(serviceId);
    setError(null);
    setNotice(null);
    try {
      const result = await createProviderLlmRolloutRequest({
        serviceId,
        environment: action === "prod_enable" ? "prod" : "staging",
        action,
        note: `${action} requested from LLM config control plane.`,
      });
      setNotice(
        result.blockedReason
          ? `${result.serviceId} 已生成 blocked request: ${result.blockedReason}`
          : `${result.serviceId} 已进入 ${result.status} 队列`
      );
    } catch (actionError) {
      setError(errorMessage(actionError, "LLM rollout request 失败"));
    } finally {
      setBusyServiceId(null);
    }
  }

  return { busyServiceId, notice, requestRollout };
}

function RolloutMetrics({ snapshot }: { snapshot: ProviderLlmConfigSnapshot | null }) {
  const metrics = getRolloutMetrics(snapshot);
  return (
    <Grid templateColumns={{ base: "1fr", md: "repeat(4, 1fr)" }} gap="16px">
      <MetricCard label="Vendors" value={metrics.vendors} detail="上游供应商" />
      <MetricCard label="Models" value={metrics.models} detail="绑定 Synapse service" />
      <MetricCard label="Pricing Review" value={metrics.pricingBlocked} detail="operator review required" />
      <MetricCard label="Prod Opt-in" value={metrics.prodOptIn} detail="生产显式启用" />
    </Grid>
  );
}

const EMPTY_ROLLOUT_METRICS = {
  vendors: 0,
  models: 0,
  pricingBlocked: 0,
  prodOptIn: 0,
};

function getRolloutMetrics(snapshot: ProviderLlmConfigSnapshot | null) {
  if (!snapshot) {
    return EMPTY_ROLLOUT_METRICS;
  }
  return {
    vendors: snapshot.vendors.length,
    models: snapshot.models.length,
    pricingBlocked: countPricingBlocked(snapshot.pricingReviews),
    prodOptIn: countProdOptIn(snapshot.rolloutStates),
  };
}

function countPricingBlocked(reviews: ProviderLlmPricingReview[]): number {
  return reviews.filter(isPricingBlocked).length;
}

function countProdOptIn(rollouts: ProviderLlmRolloutState[]): number {
  return rollouts.filter((item) => item.prodOptIn).length;
}

function isPricingBlocked(review: ProviderLlmPricingReview): boolean {
  return review.pricingStatus === "operator_review_required";
}

function VendorTable({ vendors }: { vendors: ProviderLlmVendorConfig[] }) {
  return (
    <ListTableSurface
      eyebrow="Upstream Providers"
      title="上游供应商"
      description="只展示运行态配置引用和 smoke 状态；上游 API key 必须留在 Secret Manager 或部署环境。"
      stamp={`${vendors.length} vendors`}
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
              <VendorRow key={vendor.providerCode} vendor={vendor} />
            ))}
          </TableBody>
        </DataTable>
      }
    />
  );
}

function VendorRow({ vendor }: { vendor: ProviderLlmVendorConfig }) {
  return (
    <Box as="tr">
      <Td>
        <Text fontWeight="800">{vendor.displayName}</Text>
        <Text color="ink.500" fontSize="13px">{vendor.providerCode}</Text>
      </Td>
      <Td><Text fontSize="13px">{vendor.baseUrl}</Text></Td>
      <Td>
        <Badge colorScheme={vendor.secretPresent ? "green" : "orange"}>
          {vendor.secretPresent ? "present" : "missing"}
        </Badge>
        <Text mt="4px" color="ink.500" fontSize="12px">{vendor.secretReference}</Text>
      </Td>
      <Td><StatusChip value={vendor.lastSmokeStatus} /></Td>
      <Td>
        <HStack gap="10px">
          <Link href={vendor.apiDocsUrl} target="_blank" color="blue.600">API</Link>
          <Link href={vendor.pricingUrl} target="_blank" color="blue.600">Pricing</Link>
        </HStack>
      </Td>
    </Box>
  );
}

function ModelCatalogTable({
  models,
  rollouts,
  busyServiceId,
  onRequestRollout,
}: {
  models: ProviderLlmModelConfig[];
  rollouts: ProviderLlmRolloutState[];
  busyServiceId: string | null;
  onRequestRollout: (model: ProviderLlmModelConfig, action: string) => void;
}) {
  return (
    <ListTableSurface
      eyebrow="Model Catalog"
      title="模型目录与上线闸门"
      description="v1 固定 stream=false；生产启用必须先完成价格复核和显式 opt-in。"
      stamp={`${models.length} models`}
      table={
        models.length === 0 ? (
          <EmptyBlock title="暂无模型" description="当前没有可治理的 LLM 模型。" />
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
                <ModelRow
                  key={`${model.providerCode}:${model.modelId}`}
                  model={model}
                  rollout={findRollout(rollouts, model.boundServiceIds[0] ?? model.modelId)}
                  busyServiceId={busyServiceId}
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

function ModelRow({
  model,
  rollout,
  busyServiceId,
  onRequestRollout,
}: {
  model: ProviderLlmModelConfig;
  rollout: ProviderLlmRolloutState | null;
  busyServiceId: string | null;
  onRequestRollout: (model: ProviderLlmModelConfig, action: string) => void;
}) {
  const serviceId = model.boundServiceIds[0] ?? model.modelId;
  const busy = busyServiceId === serviceId;
  return (
    <Box as="tr">
      <Td>
        <Text fontWeight="800">{model.displayName}</Text>
        <Text color="ink.500" fontSize="13px">{model.modelId}</Text>
      </Td>
      <Td><Text fontSize="13px">{serviceId}</Text></Td>
      <Td>
        <Stack gap="4px">
          <Text fontSize="13px">streaming: {model.supportsStreaming ? "yes" : "no"}</Text>
          <Text fontSize="13px">tools: {model.supportsToolCalling ? "yes" : "no"}</Text>
        </Stack>
      </Td>
      <Td><StatusChip value={model.status} /></Td>
      <Td>
        <StatusChip value={rollout?.eligibilityStatus ?? "unknown"} />
        <Text mt="4px" color="ink.500" fontSize="12px">
          prod opt-in: {rollout?.prodOptIn ? "yes" : "no"}
        </Text>
      </Td>
      <Td>
        <HStack gap="8px">
          <Button size="sm" isLoading={busy} onClick={() => onRequestRollout(model, "smoke")}>
            staging smoke
          </Button>
          <Button size="sm" colorScheme="orange" isLoading={busy} onClick={() => onRequestRollout(model, "prod_enable")}>
            prod enable
          </Button>
        </HStack>
      </Td>
    </Box>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <Box borderRadius="8px" bg="rgba(255,255,255,0.94)" border="1px solid rgba(15,17,21,0.08)" p="18px">
      <Text fontSize="11px" textTransform="uppercase" color="ink.500">{label}</Text>
      <Heading mt="8px" size="lg">{value}</Heading>
      <Text mt="6px" color="ink.500" fontSize="13px">{detail}</Text>
    </Box>
  );
}
