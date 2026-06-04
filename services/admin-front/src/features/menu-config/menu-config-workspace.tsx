"use client";

import { Grid } from "@chakra-ui/react";
import { useDeferredValue, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { useAdminStepUp } from "@/lib/use-admin-step-up";
import { useAdminSession } from "@/lib/use-admin-session";

import {
  MenuConfigActions,
  MenuConfigNotices,
  MenuDeleteConfirmModal,
} from "./menu-config-chrome";
import { MenuConfigEditorModal } from "./menu-config-editor-modal";
import {
  MenuGateAndDiscipline,
  MenuMetricGrid,
  MenuVersionSignals,
} from "./menu-config-summary";
import {
  useMenuItemEditor,
  useMenuTopologyViewModel,
} from "./menu-config-state";
import { MenuTopologyTable } from "./menu-config-table";
import { useMenuConfigMutations } from "./use-menu-config-mutations";
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
  const deferredSearch = useDeferredValue(search);
  const viewModel = useMenuTopologyViewModel(
    draft.rows,
    draft.meta,
    deferredSearch,
    sectionFilter
  );
  const canManage = admin?.role === "super_admin";
  const mutations = useMenuConfigMutations({
    token,
    canManage,
    draft,
    editor,
    requestStepUpCode,
  });

  if (loading || !admin || draft.bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="Menu Topology Compose"
        message="正在生成菜单配置视图..."
      />
    );
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
          onPublish={() => void mutations.publishMenuConfig()}
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
          onDelete={mutations.setPendingDeleteRow}
        />
      </Grid>
      <MenuGateAndDiscipline cards={viewModel.gateCards} />
      <MenuConfigEditorModal
        open={editor.isModalOpen}
        editingRow={editor.editingRow}
        form={editor.form}
        topologyRows={viewModel.topologyRows}
        onClose={editor.closeModal}
        onSubmit={(event) => void mutations.submitItem(event)}
        onFieldChange={editor.updateField}
      />
      <MenuDeleteConfirmModal
        row={mutations.pendingDeleteRow}
        deletingItemId={mutations.deletingItemId}
        onCancel={() => mutations.setPendingDeleteRow(null)}
        onConfirm={mutations.confirmDeleteRow}
      />
      {stepUpModal}
    </AdminShell>
  );
}
