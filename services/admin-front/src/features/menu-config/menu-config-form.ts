import type { AdminMenuConfigItem } from "@/services/admin-api";

export type MenuFormState = {
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

export function createEmptyMenuForm(): MenuFormState {
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

export function createMenuFormFromItem(
  item: AdminMenuConfigItem
): MenuFormState {
  return {
    itemId: item.itemId,
    sectionId: item.sectionId,
    sectionLabel: item.sectionLabel,
    sectionDescription: item.sectionDescription,
    label: item.label,
    href: item.href ?? "",
    description: item.description,
    parentItemId: item.parentItemId ?? "",
    nodeType: item.nodeType,
    iconKey: item.iconKey,
    requiredRoles: item.requiredRoles.join(", "),
    requiredPermissions: item.requiredPermissions.join(", "),
    sortOrder: String(item.sortOrder),
    keywords: item.keywords.join(", "),
  };
}

export function parseMenuCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildMenuItemDraftPayload(form: MenuFormState) {
  return {
    sectionId: form.sectionId.trim(),
    sectionLabel: form.sectionLabel.trim(),
    sectionDescription: form.sectionDescription.trim(),
    label: form.label.trim(),
    href: form.nodeType === "page" ? form.href.trim() || null : null,
    description: form.description.trim(),
    parentItemId: form.parentItemId.trim() || null,
    nodeType: form.nodeType,
    iconKey: form.iconKey.trim() || undefined,
    requiredRoles: parseMenuCsv(form.requiredRoles),
    requiredPermissions: parseMenuCsv(form.requiredPermissions),
    sortOrder: form.sortOrder ? Number(form.sortOrder) : undefined,
    keywords: parseMenuCsv(form.keywords),
  };
}

export function buildCreateMenuItemPayload(form: MenuFormState) {
  return {
    itemId: form.itemId.trim(),
    ...buildMenuItemDraftPayload(form),
  };
}
