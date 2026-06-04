"use client";

import { Box, Button, Grid, Input, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import {
  MessageBanner,
  MetricCard,
  SurfaceCard,
  nativeFieldStyle,
} from "@/components/console-ui";
import { formatDateTime } from "@/lib/admin-console";
import { useAdminSession } from "@/lib/use-admin-session";
import { useAdminStepUp } from "@/lib/use-admin-step-up";
import {
  publishBusinessPolicyConfig,
  updateBusinessPolicyConfig,
  type BusinessPolicyPayload,
} from "@/services/admin-api";

import {
  buildMetaStamp,
  canManageBusinessPolicy,
  clonePolicy,
  getPolicyFieldValue,
  policyFieldGroups,
  setPolicyFieldValue,
  type ConfigFieldGroup,
} from "./config-center-presenters";
import { useConfigOverview } from "./use-config-overview";

type BusinessPolicyOverview = NonNullable<
  ReturnType<typeof useConfigOverview>["overview"]
>;
type AdminSession = NonNullable<ReturnType<typeof useAdminSession>["admin"]>;
type SecurityPolicy = ReturnType<typeof useAdminSession>["security"];

function buildStepUpOptions(security: SecurityPolicy) {
  return {
    enabled: security?.highRiskTotpRequired ?? false,
    issuer: security?.totpIssuer ?? "Synapse Gateway Admin",
  };
}

function isPolicyViewLoading({
  bootstrapping,
  loading,
}: Readonly<{
  bootstrapping: boolean;
  loading: boolean;
}>) {
  return Boolean(loading || bootstrapping);
}

function policyUnavailableMessage(error: string | null) {
  return error ?? "业务策略配置暂时不可用。";
}

function PolicyTabsBar({
  activeGroupId,
  onSelect,
}: Readonly<{
  activeGroupId: ConfigFieldGroup["id"];
  onSelect: (groupId: ConfigFieldGroup["id"]) => void;
}>) {
  return (
    <Stack direction={{ base: "column", md: "row" }} gap="10px" flexWrap="wrap">
      {policyFieldGroups.map((group) => (
        <Button
          key={group.id}
          data-testid={`business-policy-tab-${group.id}`}
          size="sm"
          borderRadius="999px"
          variant={activeGroupId === group.id ? "solid" : "outline"}
          onClick={() => onSelect(group.id)}
        >
          {group.title}
        </Button>
      ))}
    </Stack>
  );
}

function PolicyFieldPanel({
  canManage,
  draftPolicy,
  group,
  setDraftPolicy,
}: Readonly<{
  canManage: boolean;
  draftPolicy: BusinessPolicyPayload;
  group: ConfigFieldGroup;
  setDraftPolicy: (policy: BusinessPolicyPayload) => void;
}>) {
  return (
    <SurfaceCard
      eyebrow="Business Policy Draft"
      title={group.title}
      description={group.description}
    >
      <Grid templateColumns={{ base: "1fr", xl: "repeat(2, 1fr)" }} gap="14px">
        {group.fields.map((field) => (
          <Box
            key={field.path}
            borderRadius="20px"
            border="1px solid rgba(15,17,21,0.08)"
            bg="rgba(255,255,255,0.72)"
            p="18px"
          >
            <Stack gap="8px">
              <Stack gap="2px">
                <Text fontSize="13px" fontWeight="700" color="ink.800">
                  {field.label}
                </Text>
                <Text fontSize="12px" color="ink.500">
                  {field.hint} 单位：{field.unit}
                </Text>
                {field.riskNote ? (
                  <Text fontSize="12px" color="#8f4a0a">
                    风险提示：{field.riskNote}
                  </Text>
                ) : null}
              </Stack>
              <Input
                data-testid={`business-policy-field-${field.path}`}
                value={getPolicyFieldValue(draftPolicy, field.path)}
                onChange={(event) =>
                  setDraftPolicy(
                    setPolicyFieldValue(
                      draftPolicy,
                      field.path,
                      event.target.value
                    )
                  )
                }
                disabled={!canManage}
                style={nativeFieldStyle}
              />
            </Stack>
          </Box>
        ))}
      </Grid>
    </SurfaceCard>
  );
}

function PolicyOperationBar({
  adminRole,
  canManage,
  isDirty,
  publishedAt,
  publishedVersion,
  saving,
  publishing,
  onSave,
  onPublish,
  draftMeta,
}: Readonly<{
  adminRole: string;
  canManage: boolean;
  isDirty: boolean;
  publishedAt: string | null;
  publishedVersion: number;
  saving: boolean;
  publishing: boolean;
  onSave: () => void;
  onPublish: () => void;
  draftMeta: string;
}>) {
  const publishedLabel = publishedAt
    ? formatDateTime(publishedAt)
    : "not published";
  return (
    <SurfaceCard
      eyebrow="Draft Operation Bar"
      title="草稿与发布状态"
      description="发布属于高风险动作，仍然使用管理员 step-up 保护。"
      actions={
        <Stack direction={{ base: "column", md: "row" }} gap="10px">
          <Button
            data-testid="business-policy-save-draft"
            colorScheme="green"
            onClick={onSave}
            disabled={!canManage || saving}
          >
            {canManage ? "保存草稿" : "只读"}
          </Button>
          <Button
            data-testid="business-policy-publish"
            variant="outline"
            onClick={onPublish}
            disabled={!canManage || publishing}
          >
            发布生效
          </Button>
        </Stack>
      }
    >
      <Grid templateColumns={{ base: "1fr", lg: "repeat(3, 1fr)" }} gap="14px">
        <MetricCard
          label="Dirty State"
          value={isDirty ? "Dirty" : "Clean"}
          meta={draftMeta}
        />
        <MetricCard
          label="Published Version"
          value={`v${publishedVersion}`}
          meta={publishedLabel}
        />
        <MetricCard
          label="Access"
          value={canManage ? "Writable" : "Read only"}
          meta={adminRole}
        />
      </Grid>
    </SurfaceCard>
  );
}

function PolicyMessages({
  canManage,
  error,
  message,
  submitError,
}: Readonly<{
  canManage: boolean;
  error: string | null;
  message: string | null;
  submitError: string | null;
}>) {
  return (
    <>
      {error ? <MessageBanner kind="error" message={error} /> : null}
      {submitError ? (
        <MessageBanner kind="error" message={submitError} />
      ) : null}
      {message ? <MessageBanner kind="success" message={message} /> : null}
      {!canManage ? (
        <MessageBanner
          kind="success"
          message="当前账号为只读配置视图，只有 super_admin 可以保存草稿或发布生效。"
        />
      ) : null}
    </>
  );
}

function useBusinessPolicyDraft(
  overview: ReturnType<typeof useConfigOverview>["overview"]
) {
  const [draftPolicy, setDraftPolicy] = useState<BusinessPolicyPayload | null>(
    null
  );
  useEffect(() => {
    if (overview) {
      setDraftPolicy(clonePolicy(overview.draft.policy));
    }
  }, [overview]);
  return { draftPolicy, setDraftPolicy };
}

function useBusinessPolicyActions({
  canManage,
  draftPolicy,
  refreshOverview,
  requestStepUpCode,
  token,
}: Readonly<{
  canManage: boolean;
  draftPolicy: BusinessPolicyPayload | null;
  refreshOverview: () => Promise<unknown>;
  requestStepUpCode: (options: {
    title: string;
    description: string;
    confirmLabel: string;
  }) => Promise<string | undefined>;
  token: string | null;
}>) {
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSaveDraft() {
    if (!token || !draftPolicy || !canManage) return;
    setSaving(true);
    setSubmitError(null);
    setMessage(null);
    try {
      await updateBusinessPolicyConfig(token, draftPolicy);
      await refreshOverview();
      setMessage("业务参数草稿已保存。");
    } catch (saveError) {
      setSubmitError(
        saveError instanceof Error ? saveError.message : "保存草稿失败"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!token || !canManage) return;
    setPublishing(true);
    setSubmitError(null);
    setMessage(null);
    try {
      const otpCode = await requestStepUpCode({
        title: "发布业务参数配置",
        description:
          "发布后 Gateway 会在短 TTL 内切到新的 published 业务策略。",
        confirmLabel: "发布配置",
      });
      await publishBusinessPolicyConfig(token, otpCode);
      await refreshOverview();
      setMessage("业务参数已发布，Gateway 将读取新的 published 快照。");
    } catch (publishError) {
      setSubmitError(
        publishError instanceof Error ? publishError.message : "发布配置失败"
      );
    } finally {
      setPublishing(false);
    }
  }

  return {
    message,
    publishing,
    saving,
    submitError,
    onPublish: () => void handlePublish(),
    onSave: () => void handleSaveDraft(),
  };
}

export function BusinessPolicyConfigView() {
  const { admin, security, token, loading } = useAdminSession();
  const { bootstrapping, error, overview, refreshOverview } =
    useConfigOverview(token);
  const { requestStepUpCode, stepUpModal } = useAdminStepUp(
    buildStepUpOptions(security)
  );
  const { draftPolicy, setDraftPolicy } = useBusinessPolicyDraft(overview);

  if (!admin) {
    return (
      <ControlPlaneLoadingScreen
        title="业务策略配置加载中"
        message="正在准备 draft 编辑工作台..."
      />
    );
  }
  if (!draftPolicy) {
    return (
      <ControlPlaneLoadingScreen
        title="业务策略配置加载中"
        message="正在准备 draft 编辑工作台..."
      />
    );
  }
  if (isPolicyViewLoading({ bootstrapping, loading })) {
    return (
      <ControlPlaneLoadingScreen
        title="业务策略配置加载中"
        message="正在准备 draft 编辑工作台..."
      />
    );
  }
  if (!overview) {
    return (
      <AdminShell
        admin={admin}
        eyebrow="Ops Controls"
        title="业务策略配置"
        description="业务策略配置暂时不可用。"
      >
        <MessageBanner kind="error" message={policyUnavailableMessage(error)} />
      </AdminShell>
    );
  }
  return (
    <BusinessPolicyEditor
      admin={admin}
      draftPolicy={draftPolicy}
      error={error}
      overview={overview}
      refreshOverview={refreshOverview}
      requestStepUpCode={requestStepUpCode}
      setDraftPolicy={setDraftPolicy}
      stepUpModal={stepUpModal}
      token={token}
    />
  );
}

function BusinessPolicyEditor({
  admin,
  draftPolicy,
  error,
  overview,
  refreshOverview,
  requestStepUpCode,
  setDraftPolicy,
  stepUpModal,
  token,
}: Readonly<{
  admin: AdminSession;
  draftPolicy: BusinessPolicyPayload;
  error: string | null;
  overview: BusinessPolicyOverview;
  refreshOverview: () => Promise<BusinessPolicyOverview | null>;
  requestStepUpCode: (options: {
    title: string;
    description: string;
    confirmLabel: string;
  }) => Promise<string | undefined>;
  setDraftPolicy: (policy: BusinessPolicyPayload) => void;
  stepUpModal: ReactNode;
  token: string | null;
}>) {
  const [activeGroupId, setActiveGroupId] =
    useState<ConfigFieldGroup["id"]>("finance");
  const canManage = canManageBusinessPolicy(admin.role);
  const actions = useBusinessPolicyActions({
    canManage,
    draftPolicy,
    refreshOverview,
    requestStepUpCode,
    token,
  });

  const activeGroup =
    policyFieldGroups.find((group) => group.id === activeGroupId) ??
    policyFieldGroups[0];

  return (
    <AdminShell
      admin={admin}
      eyebrow="Ops Controls"
      title="业务策略配置"
      description="按业务域编辑 draft；保存草稿不影响运行时，发布后才进入 Gateway runtime。"
    >
      <Stack gap="16px">
        <PolicyMessages
          canManage={canManage}
          error={error}
          message={actions.message}
          submitError={actions.submitError}
        />
        <PolicyOperationBar
          adminRole={admin.role}
          canManage={canManage}
          draftMeta={buildMetaStamp(overview.draft)}
          isDirty={overview.draft.meta.isDirty}
          publishedAt={overview.published.meta.publishedAt}
          publishedVersion={overview.published.meta.publishedVersion}
          publishing={actions.publishing}
          saving={actions.saving}
          onPublish={actions.onPublish}
          onSave={actions.onSave}
        />
        <PolicyTabsBar
          activeGroupId={activeGroupId}
          onSelect={setActiveGroupId}
        />
        <PolicyFieldPanel
          canManage={canManage}
          draftPolicy={draftPolicy}
          group={activeGroup}
          setDraftPolicy={setDraftPolicy}
        />
      </Stack>
      {stepUpModal}
    </AdminShell>
  );
}
