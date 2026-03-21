"use client";

import { Box, Button, Flex, Grid, Input, Stack, Text } from "@chakra-ui/react";
import { FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { DataTable, FieldBlock, MessageBanner, MetricCard, OverlayPanel, SearchInput, SentinelStatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th, nativeFieldStyle } from "@/components/console-ui";
import { buildMenuGateCards, buildMenuMetrics, buildMenuSections, buildMenuVersionCards, filterMenuItems, sortMenuItemsByTopology } from "@/features/menu-config/menu-presenters";
import { formatDateTime } from "@/lib/admin-console";
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
  parentItemId: string;
  nodeType: "category" | "page" | "panel";
  iconKey: string;
  requiredRoles: string;
  requiredPermissions: string;
  sortOrder: string;
  keywords: string;
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
    parentItemId: "",
    nodeType: "page",
    iconKey: "",
    requiredRoles: "",
    requiredPermissions: "",
    sortOrder: "",
    keywords: "",
  };
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
  const [bootstrapping, setBootstrapping] = useState(true);
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
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载菜单配置失败");
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

  const filteredRows = useMemo(() => sortMenuItemsByTopology(filterMenuItems(rows, deferredSearch, sectionFilter)), [deferredSearch, rows, sectionFilter]);
  const sections = useMemo(() => buildMenuSections(rows), [rows]);
  const topologyRows = useMemo(() => sortMenuItemsByTopology(rows), [rows]);
  const metrics = useMemo(() => buildMenuMetrics(rows, meta), [rows, meta]);
  const versionCards = useMemo(() => buildMenuVersionCards(meta), [meta]);
  const gateCards = useMemo(() => buildMenuGateCards(rows), [rows]);

  if (loading || !admin || bootstrapping) {
    return <main className="state-screen">正在生成菜单配置视图...</main>;
  }

  const canManage = admin.role === "super_admin";
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
      href: row.href ?? "",
      description: row.description,
      parentItemId: row.parentItemId ?? "",
      nodeType: row.nodeType,
      iconKey: row.iconKey,
      requiredRoles: row.requiredRoles.join(", "),
      requiredPermissions: row.requiredPermissions.join(", "),
      sortOrder: String(row.sortOrder),
      keywords: row.keywords.join(", "),
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    try {
      if (!token) {
        throw new Error("Missing admin token");
      }
      const payload = {
        sectionId: form.sectionId.trim(),
        sectionLabel: form.sectionLabel.trim(),
        sectionDescription: form.sectionDescription.trim(),
        label: form.label.trim(),
        href: form.nodeType === "page" ? (form.href.trim() || null) : null,
        description: form.description.trim(),
        parentItemId: form.parentItemId.trim() || null,
        nodeType: form.nodeType,
        iconKey: form.iconKey.trim() || undefined,
        requiredRoles: parseCsv(form.requiredRoles),
        requiredPermissions: parseCsv(form.requiredPermissions),
        sortOrder: form.sortOrder ? Number(form.sortOrder) : undefined,
        keywords: parseCsv(form.keywords),
      };
      const response = editingRow
        ? await updateAdminMenuItem(token, editingRow.itemId, payload)
        : await createAdminMenuItem(token, { itemId: form.itemId.trim(), ...payload });
      setRows(response.items);
      setMeta(response.meta);
      setMessage(editingRow ? "菜单项草稿已更新。" : "菜单项草稿已创建。");
      closeDrawer();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交菜单项失败");
    }
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
      setRows(response.items);
      setMeta(response.meta);
      setMessage("published 菜单配置已更新。所有管理员将读取新的导航树。");
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "发布菜单配置失败");
    }
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Menu Topology"
      title="菜单配置工作台"
      description="配置中心持久化在 gateway-admin，并区分 draft 与 published 两个阶段，菜单变更不再是浏览器本地状态。"
      actions={
        <Flex gap="10px">
          {canManage ? <Button variant="outline" borderRadius="full" onClick={() => void handlePublish()}>发布 published</Button> : null}
          {canManage ? <Button borderRadius="full" bg="brand.500" color="white" _hover={{ bg: "brand.600" }} onClick={openCreateDrawer}>创建菜单项</Button> : null}
        </Flex>
      }
    >
      {message ? <MessageBanner kind="success" message={message} /> : null}
      {error ? <MessageBanner kind="error" message={error} /> : null}

      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap="16px">
        <MetricCard label="Draft routes" value={metrics.totalItems} meta={`${metrics.sectionCount} sections`} />
        <MetricCard label="Role-gated items" value={metrics.gatedByRoleCount} meta={`${metrics.gatedByPermissionCount} permission-gated`} />
        <MetricCard label="Dual-gated items" value={metrics.multiGatedCount} meta="roles + permissions both required" accent="linear-gradient(180deg, rgba(255,251,244,0.98) 0%, rgba(255,242,226,0.96) 100%)" />
        <MetricCard label="Publish state" value={metrics.isDirty ? "DIRTY" : "SYNCED"} meta={metrics.isDirty ? "draft ahead of published" : "draft matches published"} />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "0.9fr 1.1fr" }} gap="16px">
        <SurfaceCard eyebrow="Version Signals" title="草稿与发布状态" description="导航治理的关键不是编辑动作本身，而是编辑版本和生效版本必须被明确区分。">
          <Stack gap="12px">
            {versionCards.map((card) => (
              <Box key={card.key} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Stack direction="row" justify="space-between" align="center">
                  <Text fontWeight="700">{card.label}</Text>
                  <SentinelStatusChip label={card.value} tone={card.tone} />
                </Stack>
                <Text mt="8px" color="ink.500">{card.description}</Text>
              </Box>
            ))}
            <Box borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
              <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">Topology Guardrail</Text>
              <Text mt="8px" color="ink.500">`draft` 负责持续编辑，`published` 负责全站生效。只有显式 publish 才能切换管理员看到的真实导航树。</Text>
              <Text mt="8px" color="ink.500">updated {formatDateTime(meta?.updatedAt ?? null)} · published {formatDateTime(meta?.publishedAt ?? null)}</Text>
            </Box>
          </Stack>
        </SurfaceCard>

      <SurfaceCard eyebrow="Draft Menu Tree" title="服务端菜单拓扑" description="只编辑草稿版本。发布后，AdminShell 和普通管理员才会读取新的 visible 菜单配置。" stamp={stamp}>
        <Grid templateColumns={{ base: "1fr", md: "320px 220px" }} gap="12px" mb="16px">
          <SearchInput value={search} onChange={setSearch} placeholder="搜索 label / href / section / keyword" />
          <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)} style={nativeFieldStyle}>
            <option value="all">全部分组</option>
            {sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
          </select>
        </Grid>
        <DataTable>
          <TableHeaderRow>
            <Th>菜单项</Th>
            <Th>分组</Th>
            <Th>地址</Th>
            <Th>角色限制</Th>
            <Th>权限限制</Th>
            <Th>操作</Th>
          </TableHeaderRow>
          <TableBody>
            {filteredRows.map((row) => (
              <Box as="tr" key={row.itemId}>
                <Td>
                  <Text fontWeight="700">{row.label}</Text>
                  <Text color="ink.500">{row.itemId}</Text>
                  <Text color="ink.500">{row.description}</Text>
                </Td>
                <Td>
                  <Text fontWeight="700">{row.sectionLabel}</Text>
                  <Text color="ink.500">{row.nodeType} · parent {row.parentItemId ?? "root"}</Text>
                  <Text color="ink.500">{row.sectionDescription}</Text>
                </Td>
                <Td>
                  <Text>{row.href ?? "-"}</Text>
                  <Text color="ink.500">icon {row.iconKey} · keywords {row.keywords.join(", ") || "-"}</Text>
                </Td>
                <Td>{row.requiredRoles.length > 0 ? row.requiredRoles.join(", ") : "公开"}</Td>
                <Td>{row.requiredPermissions.length > 0 ? row.requiredPermissions.join(", ") : "无额外权限"}</Td>
                <Td>
                  <Flex gap="8px" wrap="wrap">
                    <Button size="sm" borderRadius="full" onClick={() => openEditDrawer(row)} disabled={!canManage}>编辑</Button>
                    <Button size="sm" borderRadius="full" variant="outline" onClick={() => void handleDelete(row)} disabled={!canManage}>删除</Button>
                  </Flex>
                </Td>
              </Box>
            ))}
          </TableBody>
        </DataTable>
      </SurfaceCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "0.96fr 1.04fr" }} gap="16px">
        <SurfaceCard eyebrow="Section Gates" title="分组级门禁" description="按 section 看角色门禁和权限门禁密度，能更快发现哪一层导航过宽或过窄。">
          <Stack gap="12px">
            {gateCards.map((card) => (
              <Box key={card.key} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Stack direction="row" justify="space-between" align="center">
                  <Text fontWeight="700">{card.label}</Text>
                  <SentinelStatusChip label={`${card.totalCount} items`} tone={card.permissionGateCount > 0 ? "orange" : "gray"} />
                </Stack>
                <Text mt="8px" color="ink.500">role gates {card.roleGateCount} · permission gates {card.permissionGateCount}</Text>
              </Box>
            ))}
          </Stack>
        </SurfaceCard>

        <SurfaceCard eyebrow="Publish Discipline" title="发布纪律" description="菜单切换会影响所有管理员的入口，不应该在未确认草稿质量时直接全站生效。">
          <Stack gap="12px">
            {[
              ["草稿治理", "Toolbar + Table + Drawer 只面向 draft 工作，保证改动先收敛到待发布版本。"],
              ["全站生效", "published 是 AdminShell 和普通管理员真正读取的导航树，发布动作必须有高风险确认。"],
              ["可追溯", "create / update / delete / publish 都应该落管理员审计事件，配置中心不是浏览器本地状态。"],
            ].map(([title, description]) => (
              <Box key={title} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Text fontWeight="700">{title}</Text>
                <Text mt="8px" color="ink.500">{description}</Text>
              </Box>
            ))}
          </Stack>
        </SurfaceCard>
      </Grid>

      <OverlayPanel open={isDrawerOpen} title={editingRow ? "编辑菜单项" : "创建菜单项"} description="draft 菜单树由 backend 托管；发布后会影响所有管理员的可见导航。" onClose={closeDrawer}>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <Stack gap="16px">
            <FieldBlock label="Item Id">
              <Input value={form.itemId} onChange={(event) => updateField("itemId", event.target.value)} disabled={editingRow !== null} borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" />
            </FieldBlock>
            <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="16px">
              <FieldBlock label="Section Id"><Input value={form.sectionId} onChange={(event) => updateField("sectionId", event.target.value)} borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" /></FieldBlock>
              <FieldBlock label="Section Label"><Input value={form.sectionLabel} onChange={(event) => updateField("sectionLabel", event.target.value)} borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" /></FieldBlock>
            </Grid>
            <FieldBlock label="Section Description"><Input value={form.sectionDescription} onChange={(event) => updateField("sectionDescription", event.target.value)} borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" /></FieldBlock>
            <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="16px">
              <FieldBlock label="Node Type">
                <select value={form.nodeType} onChange={(event) => updateField("nodeType", event.target.value as MenuFormState["nodeType"])} style={nativeFieldStyle}>
                  <option value="category">category</option>
                  <option value="page">page</option>
                  <option value="panel">panel</option>
                </select>
              </FieldBlock>
              <FieldBlock label="Parent Item">
                <select value={form.parentItemId} onChange={(event) => updateField("parentItemId", event.target.value)} style={nativeFieldStyle}>
                  <option value="">root</option>
                  {topologyRows
                    .filter((row) => row.itemId !== form.itemId)
                    .map((row) => <option key={row.itemId} value={row.itemId}>{row.label} ({row.itemId})</option>)}
                </select>
              </FieldBlock>
            </Grid>
            <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="16px">
              <FieldBlock label="Label"><Input value={form.label} onChange={(event) => updateField("label", event.target.value)} borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" /></FieldBlock>
              <FieldBlock label="Href"><Input value={form.href} onChange={(event) => updateField("href", event.target.value)} placeholder={form.nodeType === "page" ? "/menu-path" : "category / panel 节点留空"} borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" /></FieldBlock>
            </Grid>
            <FieldBlock label="Description"><Input value={form.description} onChange={(event) => updateField("description", event.target.value)} borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" /></FieldBlock>
            <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="16px">
              <FieldBlock label="Icon Key"><Input value={form.iconKey} onChange={(event) => updateField("iconKey", event.target.value)} placeholder="CT / OV / 01" borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" /></FieldBlock>
              <FieldBlock label="Keywords"><Input value={form.keywords} onChange={(event) => updateField("keywords", event.target.value)} placeholder="overview, runtime" borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" /></FieldBlock>
            </Grid>
            <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="16px">
              <FieldBlock label="Required Roles"><Input value={form.requiredRoles} onChange={(event) => updateField("requiredRoles", event.target.value)} placeholder="super_admin, reviewer" borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" /></FieldBlock>
              <FieldBlock label="Required Permissions"><Input value={form.requiredPermissions} onChange={(event) => updateField("requiredPermissions", event.target.value)} placeholder="approval:read" borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" /></FieldBlock>
            </Grid>
            <FieldBlock label="Sort Order"><Input value={form.sortOrder} onChange={(event) => updateField("sortOrder", event.target.value)} type="number" borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" /></FieldBlock>
            <Button type="submit" bg="brand.500" color="white" borderRadius="18px" h="52px" _hover={{ bg: "brand.600" }}>
              {editingRow ? "保存菜单项" : "创建菜单项"}
            </Button>
          </Stack>
        </form>
      </OverlayPanel>

      {stepUpModal}
    </AdminShell>
  );
}
