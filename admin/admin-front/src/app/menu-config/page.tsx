"use client";

import { FormEvent, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";

import { AdminShell } from "@/components/admin-shell";
import { CrudDrawer, CrudField, CrudSection, CrudTable, CrudToolbar, CrudToolbarFilters } from "@/components/crud";
import { useAdminStepUp } from "@/lib/use-admin-step-up";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  createAdminMenuItem,
  deleteAdminMenuItem,
  getAdminMenuConfig,
  publishAdminMenuConfig,
  updateAdminMenuItem,
  type AdminMenuConfigItem,
  type AdminMenuConfigMeta,
} from "@/services/admin-api";

type MenuFormState = {
  itemId: string;
  sectionId: string;
  sectionLabel: string;
  sectionDescription: string;
  label: string;
  href: string;
  description: string;
  requiredRoles: string;
  requiredPermissions: string;
  sortOrder: string;
};

function createEmptyMenuForm(): MenuFormState {
  return {
    itemId: "",
    sectionId: "",
    sectionLabel: "",
    sectionDescription: "",
    label: "",
    href: "",
    description: "",
    requiredRoles: "",
    requiredPermissions: "",
    sortOrder: "",
  };
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getMenuSubmitLabel(isPending: boolean, editingRow: AdminMenuConfigItem | null): string {
  if (isPending) {
    return "提交中...";
  }
  if (editingRow) {
    return "保存菜单项";
  }
  return "创建菜单项";
}

export default function MenuConfigPage() {
  const { admin, security, token, loading } = useAdminSession();
  const { requestStepUpCode, stepUpModal } = useAdminStepUp({
    enabled: security?.highRiskTotpRequired ?? false,
    issuer: security?.totpIssuer ?? "Synapse Gateway Admin",
  });
  const [rows, setRows] = useState<AdminMenuConfigItem[]>([]);
  const [meta, setMeta] = useState<AdminMenuConfigMeta | null>(null);
  const [search, setSearch] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<AdminMenuConfigItem | null>(null);
  const [form, setForm] = useState<MenuFormState>(createEmptyMenuForm());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search);

  async function loadMenuConfig(activeToken: string) {
    const response = await getAdminMenuConfig(activeToken, { stage: "draft" });
    setRows(response.items);
    setMeta(response.meta);
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;

    async function load() {
      try {
        const response = await getAdminMenuConfig(activeToken, { stage: "draft" });
        if (!cancelled) {
          setRows(response.items);
          setMeta(response.meta);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载菜单配置失败");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = deferredSearch.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch = !normalizedSearch
        || row.label.toLowerCase().includes(normalizedSearch)
        || row.href.toLowerCase().includes(normalizedSearch)
        || row.sectionLabel.toLowerCase().includes(normalizedSearch);
      const matchesSection = sectionFilter === "all" || row.sectionId === sectionFilter;
      return matchesSearch && matchesSection;
    });
  }, [deferredSearch, rows, sectionFilter]);

  const sections = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    rows.forEach((row) => {
      map.set(row.sectionId, { id: row.sectionId, label: row.sectionLabel });
    });
    return Array.from(map.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [rows]);

  if (loading || !admin) {
    return <main className="state-screen">正在生成菜单配置视图...</main>;
  }

  const canManage = admin.role === "super_admin";
  const submitLabel = getMenuSubmitLabel(isPending, editingRow);
  const stamp = meta ? `draft v${meta.draftVersion} / published v${meta.publishedVersion}` : `${filteredRows.length}/${rows.length} routes`;

  function resetForm() {
    setEditingRow(null);
    setForm(createEmptyMenuForm());
  }

  function openCreateDrawer() {
    resetForm();
    setDrawerOpen(true);
  }

  function openEditDrawer(row: AdminMenuConfigItem) {
    setEditingRow(row);
    setForm({
      itemId: row.itemId,
      sectionId: row.sectionId,
      sectionLabel: row.sectionLabel,
      sectionDescription: row.sectionDescription,
      label: row.label,
      href: row.href,
      description: row.description,
      requiredRoles: row.requiredRoles.join(", "),
      requiredPermissions: row.requiredPermissions.join(", "),
      sortOrder: String(row.sortOrder),
    });
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    resetForm();
  }

  function updateField<Key extends keyof MenuFormState>(key: Key, value: MenuFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        if (!token) {
          throw new Error("Missing admin token");
        }
        const payload = {
          sectionId: form.sectionId.trim(),
          sectionLabel: form.sectionLabel.trim(),
          sectionDescription: form.sectionDescription.trim(),
          label: form.label.trim(),
          href: form.href.trim(),
          description: form.description.trim(),
          requiredRoles: parseCsv(form.requiredRoles),
          requiredPermissions: parseCsv(form.requiredPermissions),
          sortOrder: form.sortOrder ? Number(form.sortOrder) : undefined,
        };
        const response = editingRow
          ? await updateAdminMenuItem(token, editingRow.itemId, payload)
          : await createAdminMenuItem(token, { itemId: form.itemId.trim(), ...payload });
        setRows(response.items);
        setMeta(response.meta);
        setMessage(editingRow ? "菜单项草稿已更新。" : "菜单项草稿已创建。");
        globalThis.setTimeout(() => closeDrawer(), 140);
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "提交菜单项失败");
      }
    });
  }

  async function handleDelete(row: AdminMenuConfigItem) {
    if (!canManage || !token) {
      return;
    }
    const confirmed = globalThis.confirm(`确认删除菜单项 ${row.label} 吗？`);
    if (!confirmed) {
      return;
    }
    setMessage(null);
    setError(null);
    try {
      const response = await deleteAdminMenuItem(token, row.itemId);
      setRows(response.items);
      setMeta(response.meta);
      setMessage(`菜单项 ${row.label} 已从草稿中删除。`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除菜单项失败");
    }
  }

  async function handlePublish() {
    if (!canManage || !token) {
      return;
    }
    setMessage(null);
    setError(null);
    try {
      const otpCode = await requestStepUpCode({
        title: "发布菜单配置",
        description: "你正在把当前 draft 菜单树切换成全局 published 版本，这会影响所有管理员的导航入口。",
        confirmLabel: "确认发布",
      });
      const response = await publishAdminMenuConfig(token, otpCode);
      setMeta(response.meta);
      await loadMenuConfig(token);
      setMessage("菜单配置已发布，新的导航树将对所有管理员生效。");
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "发布菜单配置失败");
    }
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Menu Topology"
      title="菜单配置工作台"
      description="配置中心现在持久化在 gateway-admin，并区分 draft 与 published 两个阶段，菜单变更不再是浏览器本地状态。"
    >
      <CrudSection
        eyebrow="Navigation Registry"
        title="控制面菜单项"
        description="把导航配置改造成真正的服务端配置中心，列表负责管理 draft，发布动作把当前草稿推成全局生效版本。"
        stamp={stamp}
        toolbar={(
          <CrudToolbar>
            <CrudToolbarFilters>
              <CrudField label="搜索菜单项">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 section / label / href" />
              </CrudField>
              <CrudField label="Section" compact>
                <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}>
                  <option value="all">全部分组</option>
                  {sections.map((section) => (
                    <option key={section.id} value={section.id}>{section.label}</option>
                  ))}
                </select>
              </CrudField>
            </CrudToolbarFilters>
            <div className="table-actions">
              {canManage ? (
                <button type="button" className="button button--secondary" onClick={() => void handlePublish()} disabled={!meta?.isDirty}>
                  发布配置
                </button>
              ) : null}
              {canManage ? <button type="button" className="button button--primary crud-toolbar__create" onClick={openCreateDrawer}>+ 新增菜单项</button> : null}
            </div>
          </CrudToolbar>
        )}
        message={message ? <p className="form-message form-message--success">{message}</p> : null}
        error={error ? <p className="form-message form-message--error">{error}</p> : null}
      >
        <CrudTable>
          <table className="admin-table">
            <thead>
              <tr>
                <th>分组</th>
                <th>菜单项</th>
                <th>路由</th>
                <th>权限依赖</th>
                <th>排序</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.itemId}>
                  <td>
                    <strong>{row.sectionLabel}</strong>
                    <div className="table-subtext table-subtext--mono">{row.sectionId}</div>
                  </td>
                  <td>
                    <strong>{row.label}</strong>
                    <div className="table-subtext">{row.description}</div>
                  </td>
                  <td><span className="table-subtext table-subtext--mono">{row.href}</span></td>
                  <td>
                    <div className="pill-row">
                      {row.requiredRoles.map((role) => <span key={role} className="status-pill status-pill--alert">role:{role}</span>)}
                      {row.requiredPermissions.map((permission) => <span key={permission} className="permission-chip">{permission}</span>)}
                      {row.requiredRoles.length === 0 && row.requiredPermissions.length === 0 ? <span className="status-pill status-pill--healthy">public to admin</span> : null}
                    </div>
                  </td>
                  <td><span className="table-subtext table-subtext--mono">{row.sortOrder}</span></td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="ghost-button" onClick={() => openEditDrawer(row)} disabled={!canManage}>编辑</button>
                      <button type="button" className="ghost-button ghost-button--danger" onClick={() => void handleDelete(row)} disabled={!canManage}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CrudTable>
      </CrudSection>

      <CrudDrawer
        open={isDrawerOpen}
        eyebrow={editingRow ? "Edit Menu Item" : "Create Menu Item"}
        title={editingRow ? "编辑菜单项" : "创建菜单项"}
        description="当前抽屉编辑的是服务端 draft。只有点击发布后，AdminShell 才会切换到新的全局菜单版本。"
        onClose={closeDrawer}
      >
        <form className="admin-form crud-drawer__form" onSubmit={handleSubmit}>
          <label>
            <span>Section ID</span>
            <input value={form.sectionId} onChange={(event) => updateField("sectionId", event.target.value)} placeholder="identity-access" />
          </label>
          <label>
            <span>Section Label</span>
            <input value={form.sectionLabel} onChange={(event) => updateField("sectionLabel", event.target.value)} placeholder="身份与权限" />
          </label>
          <label>
            <span>Section Description</span>
            <input value={form.sectionDescription} onChange={(event) => updateField("sectionDescription", event.target.value)} placeholder="分组说明" />
          </label>
          <label>
            <span>Menu ID</span>
            <input value={form.itemId} onChange={(event) => updateField("itemId", event.target.value)} placeholder="menu_item_id" disabled={Boolean(editingRow)} />
          </label>
          <label>
            <span>Label</span>
            <input value={form.label} onChange={(event) => updateField("label", event.target.value)} placeholder="菜单名称" />
          </label>
          <label>
            <span>Href</span>
            <input value={form.href} onChange={(event) => updateField("href", event.target.value)} placeholder="/role-permissions" />
          </label>
          <label>
            <span>Description</span>
            <input value={form.description} onChange={(event) => updateField("description", event.target.value)} placeholder="菜单描述" />
          </label>
          <label>
            <span>Sort Order</span>
            <input value={form.sortOrder} onChange={(event) => updateField("sortOrder", event.target.value)} placeholder="110" inputMode="numeric" />
          </label>
          <label>
            <span>Required Roles</span>
            <input value={form.requiredRoles} onChange={(event) => updateField("requiredRoles", event.target.value)} placeholder="super_admin, platform_ops_admin" />
          </label>
          <label>
            <span>Required Permissions</span>
            <input value={form.requiredPermissions} onChange={(event) => updateField("requiredPermissions", event.target.value)} placeholder="dashboard:read, audit:read" />
          </label>
          <div className="crud-drawer__actions">
            <button type="button" className="button button--secondary" onClick={closeDrawer}>取消</button>
            <button type="submit" className="button button--primary" disabled={isPending}>{submitLabel}</button>
          </div>
        </form>
      </CrudDrawer>
      {stepUpModal}
    </AdminShell>
  );
}
