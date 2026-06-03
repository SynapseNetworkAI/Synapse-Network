"use client";

import { Button, Flex, Grid } from "@chakra-ui/react";
import type { FormEvent } from "react";
import { useDeferredValue, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ConfirmActionModal } from "@/components/confirm-action-modal";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { useAdminStepUp } from "@/lib/use-admin-step-up";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  createAdminMenuItem,
  deleteAdminMenuItem,
  publishAdminMenuConfig,
  updateAdminMenuItem,
  type AdminMenuConfigItem,
} from "@/services/admin-api";

import { MenuConfigEditorModal } from "./menu-config-editor-modal";
import {
  buildCreateMenuItemPayload,
  buildMenuItemDraftPayload,
  createEmptyMenuForm,
  createMenuFormFromItem,
  type MenuFormState,
} from "./menu-config-form";
import {
  MenuGateAndDiscipline,
  MenuMetricGrid,
  MenuVersionSignals,
} from "./menu-config-summary";
import { MenuTopologyTable } from "./menu-config-table";
import {
  buildMenuGateCards,
  buildMenuMetrics,
  buildMenuSections,
  buildMenuVersionCards,
  filterMenuItems,
  sortMenuItemsByTopology,
} from "./menu-presenters";
import { useMenuConfigDraft } from "./use-menu-config-draft";

export function MenuConfigWorkspace() {
  const { admin, security, token, loading } = useAdminSession();
  const { requestStepUpCode, stepUpModal } = useAdminStepUp({
    enabled: security?.highRiskTotpRequired ?? false,
    issuer: security?.totpIssuer ?? "Synapse Gateway Admin",
  });
  const draft = useMenuConfigDraft(token);
  const editor = useMenuItemEditor();
  const [search, setSearch] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [pendingDeleteRow, setPendingDeleteRow] =
    useState<AdminMenuConfigItem | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const viewModel = useMenuTopologyViewModel(
    draft.rows,
    draft.meta,
    deferredSearch,
    sectionFilter,
  );

  if (loading || !admin || draft.bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="Menu Topology Compose"
        message="正在生成菜单配置视图..."
      />
    );
  }

  const canManage = admin.role === "super_admin";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      draft.setError("Missing admin token");
      return;
    }
    draft.clearNotices();
    try {
      const response = editor.editingRow
        ? await updateAdminMenuItem(
            token,
            editor.editingRow.itemId,
            buildMenuItemDraftPayload(editor.form),
          )
        : await createAdminMenuItem(
            token,
            buildCreateMenuItemPayload(editor.form),
          );
      draft.applyResponse(response);
      draft.setMessage(
        editor.editingRow ? "菜单项草稿已更新。" : "菜单项草稿已创建。",
      );
      editor.closeModal();
    } catch (submitError) {
      draft.setError(
        submitError instanceof Error ? submitError.message : "提交菜单项失败",
      );
    }
  }

  async function confirmDeleteRow() {
    const row = pendingDeleteRow;
    if (!row || !canManage || !token) {
      return;
    }
    draft.clearNotices();
    try {
      setDeletingItemId(row.itemId);
      draft.applyResponse(await deleteAdminMenuItem(token, row.itemId));
      draft.setMessage(`菜单项 ${row.label} 已从草稿中删除。`);
      setPendingDeleteRow(null);
    } catch (deleteError) {
      draft.setError(
        deleteError instanceof Error ? deleteError.message : "删除菜单项失败",
      );
    } finally {
      setDeletingItemId(null);
    }
  }

  async function handlePublish() {
    if (!canManage || !token) {
      return;
    }
    draft.clearNotices();
    try {
      const otpCode = await requestStepUpCode({
        title: "发布菜单配置",
        description:
          "你正在把当前 draft 菜单树切换成全局 published 版本，这会影响所有管理员的导航入口。",
        confirmLabel: "确认发布",
      });
      draft.applyResponse(await publishAdminMenuConfig(token, otpCode));
      draft.setMessage(
        "published 菜单配置已更新。所有管理员将读取新的导航树。",
      );
    } catch (publishError) {
      draft.setError(
        publishError instanceof Error
          ? publishError.message
          : "发布菜单配置失败",
      );
    }
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Menu Topology"
      title="菜单配置工作台"
      description="配置中心持久化在 gateway-admin，并区分 draft 与 published 两个阶段，菜单变更不再是浏览器本地状态。"
      actions={
        <MenuConfigActions
          canManage={canManage}
          onPublish={() => void handlePublish()}
          onCreate={editor.openCreateModal}
        />
      }
    >
      <MenuConfigNotices message={draft.message} error={draft.error} />
      <MenuMetricGrid metrics={viewModel.metrics} />
      <Grid templateColumns={{ base: "1fr", xl: "0.9fr 1.1fr" }} gap="16px">
        <MenuVersionSignals cards={viewModel.versionCards} meta={draft.meta} />
        <MenuTopologyTable
          rows={viewModel.filteredRows}
          sections={viewModel.sections}
          search={search}
          sectionFilter={sectionFilter}
          stamp={viewModel.stamp}
          canManage={canManage}
          onSearchChange={setSearch}
          onSectionFilterChange={setSectionFilter}
          onEdit={editor.openEditModal}
          onDelete={setPendingDeleteRow}
        />
      </Grid>
      <MenuGateAndDiscipline cards={viewModel.gateCards} />
      <MenuConfigEditorModal
        open={editor.isModalOpen}
        editingRow={editor.editingRow}
        form={editor.form}
        topologyRows={viewModel.topologyRows}
        onClose={editor.closeModal}
        onSubmit={(event) => void handleSubmit(event)}
        onFieldChange={editor.updateField}
      />
      <ConfirmActionModal
        open={pendingDeleteRow !== null}
        title="删除菜单项"
        description={
          pendingDeleteRow
            ? `确认删除菜单项 ${pendingDeleteRow.label} 吗？`
            : ""
        }
        contextLabel={pendingDeleteRow?.itemId}
        confirmLabel="确认删除"
        tone="danger"
        loading={
          pendingDeleteRow !== null &&
          deletingItemId === pendingDeleteRow.itemId
        }
        onCancel={() => setPendingDeleteRow(null)}
        onConfirm={confirmDeleteRow}
      />
      {stepUpModal}
    </AdminShell>
  );
}

function useMenuTopologyViewModel(
  rows: AdminMenuConfigItem[],
  meta: Parameters<typeof buildMenuMetrics>[1],
  deferredSearch: string,
  sectionFilter: string,
) {
  const filteredRows = useMemo(
    () =>
      sortMenuItemsByTopology(
        filterMenuItems(rows, deferredSearch, sectionFilter),
      ),
    [deferredSearch, rows, sectionFilter],
  );
  const sections = useMemo(() => buildMenuSections(rows), [rows]);
  const topologyRows = useMemo(() => sortMenuItemsByTopology(rows), [rows]);
  const metrics = useMemo(() => buildMenuMetrics(rows, meta), [rows, meta]);
  const versionCards = useMemo(() => buildMenuVersionCards(meta), [meta]);
  const gateCards = useMemo(() => buildMenuGateCards(rows), [rows]);
  const stamp = meta
    ? `draft v${meta.draftVersion} / published v${meta.publishedVersion}`
    : `${filteredRows.length}/${rows.length} routes`;

  return {
    filteredRows,
    sections,
    topologyRows,
    metrics,
    versionCards,
    gateCards,
    stamp,
  };
}

function useMenuItemEditor() {
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<AdminMenuConfigItem | null>(
    null,
  );
  const [form, setForm] = useState<MenuFormState>(createEmptyMenuForm());

  function resetForm() {
    setEditingRow(null);
    setForm(createEmptyMenuForm());
  }

  function openCreateModal() {
    resetForm();
    setModalOpen(true);
  }

  function openEditModal(row: AdminMenuConfigItem) {
    setEditingRow(row);
    setForm(createMenuFormFromItem(row));
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    resetForm();
  }

  function updateField<Key extends keyof MenuFormState>(
    key: Key,
    value: MenuFormState[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return {
    isModalOpen,
    editingRow,
    form,
    openCreateModal,
    openEditModal,
    closeModal,
    updateField,
  };
}

function MenuConfigActions({
  canManage,
  onPublish,
  onCreate,
}: Readonly<{
  canManage: boolean;
  onPublish: () => void;
  onCreate: () => void;
}>) {
  if (!canManage) {
    return null;
  }
  return (
    <Flex gap="10px">
      <Button variant="outline" borderRadius="full" onClick={onPublish}>
        发布 published
      </Button>
      <Button
        borderRadius="full"
        bg="brand.500"
        color="white"
        _hover={{ bg: "brand.600" }}
        onClick={onCreate}
      >
        创建菜单项
      </Button>
    </Flex>
  );
}

function MenuConfigNotices({
  message,
  error,
}: Readonly<{ message: string | null; error: string | null }>) {
  return (
    <>
      {message ? <MessageBanner kind="success" message={message} /> : null}
      {error ? <MessageBanner kind="error" message={error} /> : null}
    </>
  );
}
