"use client";

import { useMemo, useState } from "react";

import type { AdminMenuConfigItem } from "@/services/admin-api";

import {
  createEmptyMenuForm,
  createMenuFormFromItem,
  type MenuFormState,
} from "./menu-config-form";
import {
  buildMenuGateCards,
  buildMenuMetrics,
  buildMenuSections,
  buildMenuVersionCards,
  filterMenuItems,
  sortMenuItemsByTopology,
} from "./menu-presenters";

export function useMenuTopologyViewModel(
  rows: AdminMenuConfigItem[],
  meta: Parameters<typeof buildMenuMetrics>[1],
  deferredSearch: string,
  sectionFilter: string
) {
  const filteredRows = useMemo(
    () =>
      sortMenuItemsByTopology(
        filterMenuItems(rows, deferredSearch, sectionFilter)
      ),
    [deferredSearch, rows, sectionFilter]
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

export function useMenuItemEditor() {
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<AdminMenuConfigItem | null>(
    null
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
    value: MenuFormState[Key]
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
