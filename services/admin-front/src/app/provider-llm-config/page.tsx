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
import { useEffect, useMemo, useState } from "react";

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
  type ProviderLlmRolloutState,
} from "@/services/admin-api";

function findRollout(
  rollouts: ProviderLlmRolloutState[],
  serviceId: string
): ProviderLlmRolloutState | null {
  return rollouts.find((rollout) => rollout.serviceId === serviceId) ?? null;
}

export default function ProviderLlmConfigPage() {
  const { admin, token, loading } = useAdminSession();
  const [snapshot, setSnapshot] = useState<ProviderLlmConfigSnapshot | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    async function run() {
      try {
        setError(null);
        const result = await getProviderLlmConfig(token);
        if (!cancelled) {
          setSnapshot(result);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载 LLM 配置失败");
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
  }, [token]);

  const models = snapshot?.models ?? [];
  const rollouts = snapshot?.rolloutStates ?? [];
  const pricingBlocked = useMemo(
    () =>
      (snapshot?.pricingReviews ?? []).filter(
        (review) => review.pricingStatus === "operator_review_required"
      ).length,
    [snapshot]
  );

  async function requestRollout(model: ProviderLlmModelConfig, action: string) {
    if (!token) {
      return;
    }
    const serviceId = model.boundServiceIds[0] ?? model.modelId;
    setBusyServiceId(serviceId);
    setError(null);
    setNotice(null);
    try {
      const result = await createProviderLlmRolloutRequest(token, {
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
      setError(actionError instanceof Error ? actionError.message : "LLM rollout request 失败");
    } finally {
      setBusyServiceId(null);
    }
  }

  if (loading || !admin || bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="Provider LLM Config"
        message="正在同步上游模型目录和生产上线闸门..."
      />
    );
  }

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

        <Grid templateColumns={{ base: "1fr", md: "repeat(4, 1fr)" }} gap="16px">
          <MetricCard label="Vendors" value={snapshot?.vendors.length ?? 0} detail="上游供应商" />
          <MetricCard label="Models" value={models.length} detail="绑定 Synapse service" />
          <MetricCard label="Pricing Review" value={pricingBlocked} detail="operator review required" />
          <MetricCard label="Prod Opt-in" value={rollouts.filter((item) => item.prodOptIn).length} detail="生产显式启用" />
        </Grid>

        <ListTableSurface
          eyebrow="Upstream Providers"
          title="上游供应商"
          description="只展示运行态配置引用和 smoke 状态；上游 API key 必须留在 Secret Manager 或部署环境。"
          stamp={`${snapshot?.vendors.length ?? 0} vendors`}
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
                {(snapshot?.vendors ?? []).map((vendor) => (
                  <Box as="tr" key={vendor.providerCode}>
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
                ))}
              </TableBody>
            </DataTable>
          }
        />

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
                  {models.map((model) => {
                    const serviceId = model.boundServiceIds[0] ?? model.modelId;
                    const rollout = findRollout(rollouts, serviceId);
                    const busy = busyServiceId === serviceId;
                    return (
                      <Box as="tr" key={`${model.providerCode}:${model.modelId}`}>
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
                            <Button size="sm" isLoading={busy} onClick={() => void requestRollout(model, "smoke")}>
                              staging smoke
                            </Button>
                            <Button size="sm" colorScheme="orange" isLoading={busy} onClick={() => void requestRollout(model, "prod_enable")}>
                              prod enable
                            </Button>
                          </HStack>
                        </Td>
                      </Box>
                    );
                  })}
                </TableBody>
              </DataTable>
            )
          }
        />
      </Stack>
    </AdminShell>
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
