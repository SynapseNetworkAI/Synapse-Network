"use client";

import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { DataTable, EmptyBlock, MessageBanner, MetricCard, SearchInput, SentinelStatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th, nativeFieldStyle } from "@/components/console-ui";
import { buildExecutionFailureClusters, buildExecutionMetrics, buildExecutionTargetCards, filterExecutionJobs, getExecutionStatusLabel, getExecutionTone, listExecutionTargets, sortExecutionJobsByPriority } from "@/features/execution/execution-presenters";
import { formatDateTime } from "@/lib/admin-console";
import { useAdminStepUp } from "@/lib/use-admin-step-up";
import { useAdminSession } from "@/lib/use-admin-session";
import { listExecutionJobs, retryExecutionJob, type ExecutionJobItem } from "@/services/admin-api";


export default function ExecutionPage() {
  const { admin, security, token, loading } = useAdminSession();
  const { requestStepUpCode, stepUpModal } = useAdminStepUp({
    enabled: security?.highRiskTotpRequired ?? false,
    issuer: security?.totpIssuer ?? "Synapse Gateway Admin",
  });
  const [jobs, setJobs] = useState<ExecutionJobItem[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [targetFilter, setTargetFilter] = useState("all");
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  const metrics = useMemo(() => buildExecutionMetrics(jobs), [jobs]);
  const failureClusters = useMemo(() => buildExecutionFailureClusters(jobs).slice(0, 4), [jobs]);
  const targetCards = useMemo(() => buildExecutionTargetCards(jobs), [jobs]);
  const targetOptions = useMemo(() => listExecutionTargets(jobs), [jobs]);
  const visibleJobs = useMemo(
    () => sortExecutionJobsByPriority(filterExecutionJobs(jobs, deferredSearch, statusFilter, targetFilter)),
    [deferredSearch, jobs, statusFilter, targetFilter],
  );
  const hotJobs = visibleJobs.slice(0, 4);

  async function loadJobs(activeToken: string) {
    const response = await listExecutionJobs(activeToken, { limit: 50 });
    setJobs(response.items);
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;
    async function load() {
      try {
        await loadJobs(activeToken);
        if (!cancelled) {
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载执行队列失败");
        }
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading || !admin || bootstrapping) {
    return <ControlPlaneLoadingScreen title="Execution Queue Sync" message="正在同步执行任务..." />;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Execution Control"
      title="执行队列"
      description="这里只处理受控命令的失败、重试与追踪，不解释系统健康，也不承担业务分诊。"
    >
      {message ? <MessageBanner kind="success" message={message} /> : null}
      {error ? <MessageBanner kind="error" message={error} /> : null}
      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap="16px">
        <MetricCard label="执行任务总数" value={metrics.totalCount} meta="审批落地后的受控命令" />
        <MetricCard label="失败任务" value={metrics.failedCount} meta={`${metrics.retryableCount} 个仍可重试`} accent="linear-gradient(180deg, rgba(255,243,240,0.98) 0%, rgba(255,232,226,0.96) 100%)" />
        <MetricCard label="处理中任务" value={metrics.inflightCount} meta="排队、执行中或重试中" accent="linear-gradient(180deg, rgba(255,251,244,0.98) 0%, rgba(255,242,226,0.96) 100%)" />
        <MetricCard label="重试耗尽" value={metrics.exhaustedCount} meta={`${metrics.succeededCount} 个已经成功收口`} />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "0.88fr 1.12fr" }} gap="16px">
        <SurfaceCard eyebrow="Failure Clusters" title="失败簇视图" description="这里先回答失败任务是否成簇，便于判断是单个命令异常还是同类执行路径一起退化。">
          <Stack gap="12px">
            {failureClusters.length ? failureClusters.map((cluster) => (
              <Box key={cluster.code} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Stack direction="row" justify="space-between" align="center">
                  <Heading size="sm">{cluster.code}</Heading>
                  <SentinelStatusChip label={`${cluster.count} jobs`} tone={cluster.code === "unknown" ? "gray" : "red"} />
                </Stack>
                <Text mt="8px" color="ink.500">{cluster.jobIds.slice(0, 3).join(" / ")}{cluster.jobIds.length > 3 ? " ..." : ""}</Text>
              </Box>
            )) : (
              <EmptyBlock title="没有失败簇" description="当前执行面没有失败任务，worker 和 controlled command 保持稳定。" />
            )}
            <Box borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
              <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">Execution Guardrail</Text>
              <Text mt="8px" color="ink.500">所有资金或配置推进动作都必须从审批层进入 execution queue，前端只能请求 retry，不能在这里直接替代系统调查或业务分诊。</Text>
            </Box>
          </Stack>
        </SurfaceCard>

        <SurfaceCard eyebrow="Execution Queue" title="执行任务工作台" description="优先暴露失败和重试热点，让 operator 先收敛故障面，再处理尾部成功任务。" stamp={`${visibleJobs.length}/${jobs.length} jobs`}>
          <Grid templateColumns={{ base: "1fr", xl: "minmax(0, 320px) 180px 180px" }} gap="12px" mb="16px">
            <SearchInput value={search} onChange={setSearch} placeholder="搜索 job / approval / error code" />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={nativeFieldStyle}>
              <option value="all">全部状态</option>
              <option value="FAILED">FAILED</option>
              <option value="RUNNING">RUNNING</option>
              <option value="EXECUTING">EXECUTING</option>
              <option value="QUEUED">QUEUED</option>
              <option value="SUCCEEDED">SUCCEEDED</option>
            </select>
            <select value={targetFilter} onChange={(event) => setTargetFilter(event.target.value)} style={nativeFieldStyle}>
              <option value="all">全部目标</option>
              {targetOptions.map((target) => <option key={target} value={target}>{target}</option>)}
            </select>
          </Grid>
          <DataTable>
            <TableHeaderRow>
              <Th>任务</Th>
              <Th>目标</Th>
              <Th>状态</Th>
              <Th>Retry</Th>
              <Th>尝试</Th>
              <Th>动作</Th>
            </TableHeaderRow>
            <TableBody>
              {visibleJobs.map((job) => {
                const retryable = job.status === "FAILED" && job.retryCount < job.maxRetryCount;
                let actionLabel = "Locked";
                if (retryingJobId === job.jobId) {
                  actionLabel = "处理中...";
                } else if (retryable) {
                  actionLabel = "Retry";
                }

                return (
                  <Box as="tr" key={job.jobId}>
                    <Td>
                      <Text fontWeight="700">{job.jobId}</Text>
                      <Text color="ink.500">approval {job.approvalId}</Text>
                    </Td>
                    <Td>
                      <Text>{job.targetSystem}</Text>
                      <Text color="ink.500">{job.executionType}</Text>
                    </Td>
                    <Td>
                      <SentinelStatusChip label={getExecutionStatusLabel(job.status)} tone={getExecutionTone(job.status)} />
                      <Text mt="8px" color="ink.500">updated {formatDateTime(job.updatedAt)}</Text>
                    </Td>
                    <Td>
                      <Text fontWeight="700">{job.retryCount} / {job.maxRetryCount}</Text>
                      <Text color="ink.500">{job.errorCode ?? "last attempt clean"}</Text>
                    </Td>
                    <Td>
                      <Stack gap="6px">
                        {job.attempts.slice(0, 2).map((attempt) => (
                          <Box key={attempt.attemptNo} borderRadius="14px" p="10px" bg="rgba(247,241,233,0.74)">
                            <Text fontWeight="700">attempt #{attempt.attemptNo}</Text>
                            <Text color="ink.500">{attempt.status} · {attempt.errorCode ?? "ok"}</Text>
                          </Box>
                        ))}
                      </Stack>
                    </Td>
                    <Td>
                      <Button
                        size="sm"
                        borderRadius="full"
                        bg={retryable ? "brand.500" : "rgba(15,17,21,0.08)"}
                        color={retryable ? "white" : "ink.500"}
                        _hover={retryable ? { bg: "brand.600" } : undefined}
                        disabled={!retryable || retryingJobId === job.jobId}
                        onClick={async () => {
                          if (!token) {
                            throw new Error("Missing admin token");
                          }
                          setRetryingJobId(job.jobId);
                          setMessage(null);
                          try {
                            const otpCode = await requestStepUpCode({
                              title: "重试执行任务",
                              description: `你正在重试任务 ${job.jobId}，这会重新触发 gateway 内部命令并写入 execution attempt。`,
                              confirmLabel: "确认重试",
                            });
                            const result = await retryExecutionJob(token, job.jobId, otpCode);
                            setMessage(`${result.jobId} 已进入 ${result.status}，retry ${result.retryCount}`);
                            setError(null);
                            await loadJobs(token);
                          } catch (actionError) {
                            setError(actionError instanceof Error ? actionError.message : "重试执行任务失败");
                          } finally {
                            setRetryingJobId(null);
                          }
                        }}
                      >
                        {actionLabel}
                      </Button>
                    </Td>
                  </Box>
                );
              })}
            </TableBody>
          </DataTable>
        </SurfaceCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "0.98fr 1.02fr" }} gap="16px">
        <SurfaceCard eyebrow="Hot Queue" title="待处置热点" description="这里只保留最值得立即处理的失败或重试项，帮助值班人员快速收敛故障面。">
          <Stack gap="12px">
            {hotJobs.length ? hotJobs.map((job) => (
              <Box key={job.jobId} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Stack direction="row" justify="space-between" align="center">
                  <Stack gap="4px">
                    <Heading size="sm">{job.jobId}</Heading>
                    <Text color="ink.500">{job.executionType}{" -> "}{job.targetSystem}</Text>
                  </Stack>
                  <SentinelStatusChip label={getExecutionStatusLabel(job.status)} tone={getExecutionTone(job.status)} />
                </Stack>
                <Text mt="8px" color="ink.500">approval {job.approvalId} · {job.errorMessage ?? "等待 operator 决定是否重试"}</Text>
              </Box>
            )) : (
              <EmptyBlock title="当前没有待处置热点" description="筛选结果为空，或者执行流处于稳定状态。" />
            )}
          </Stack>
        </SurfaceCard>

        <SurfaceCard eyebrow="Target Domains" title="目标系统分布" description="把失败与处理中任务按目标系统切开，快速判断是 adapter 故障、worker 拥塞还是单个命令退化。">
          <Stack gap="12px">
            {targetCards.map((card) => {
              let cardTone: "green" | "orange" | "red" = "green";
              if (card.failedCount > 0) {
                cardTone = "red";
              } else if (card.inflightCount > 0) {
                cardTone = "orange";
              }

              return (
                <Box key={card.key} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                  <Stack direction="row" justify="space-between" align="center">
                    <Heading size="sm">{card.label}</Heading>
                    <SentinelStatusChip label={`${card.totalCount} jobs`} tone={cardTone} />
                  </Stack>
                  <Text mt="8px" color="ink.500">failed {card.failedCount} · inflight {card.inflightCount}</Text>
                </Box>
              );
            })}
          </Stack>
        </SurfaceCard>
      </Grid>
      {stepUpModal}
    </AdminShell>
  );
}