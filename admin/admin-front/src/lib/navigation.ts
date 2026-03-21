import type { AdminMenuConfigItem } from "@/services/admin-api";


export type AdminNavNode = {
  id: string;
  href: string;
  label: string;
  description: string;
  badge?: string;
};

export type AdminNavSection = {
  id: string;
  label: string;
  description: string;
  children: AdminNavNode[];
};

const navVisualMap: Record<string, { icon: string; kicker: string }> = {
  dashboard: { icon: "DB", kicker: "overview rail" },
  users: { icon: "US", kicker: "operator registry" },
  "role-permissions": { icon: "RP", kicker: "policy matrix" },
  "menu-config": { icon: "MC", kicker: "shell topology" },
  execution: { icon: "EX", kicker: "job stream" },
  approvals: { icon: "AP", kicker: "decision queue" },
  "withdrawal-reviews": { icon: "WR", kicker: "manual payout" },
  finance: { icon: "FN", kicker: "money rail" },
  risk: { icon: "RK", kicker: "threat desk" },
  system: { icon: "SY", kicker: "runtime health" },
  audit: { icon: "AU", kicker: "action ledger" },
};

export function getNavVisual(itemId: string): { icon: string; kicker: string } {
  return navVisualMap[itemId] ?? { icon: "SN", kicker: "control module" };
}


export function buildAdminNavigation(items: AdminMenuConfigItem[]): AdminNavSection[] {
  if (items.length === 0) {
    return [];
  }

  const sections = new Map<string, AdminNavSection>();

  items
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .forEach((item) => {
      const currentSection = sections.get(item.sectionId);
      const node: AdminNavNode = {
        id: item.itemId,
        href: item.href,
        label: item.label,
        description: item.description,
      };

      if (currentSection) {
        currentSection.children.push(node);
        return;
      }

      sections.set(item.sectionId, {
        id: item.sectionId,
        label: item.sectionLabel,
        description: item.sectionDescription,
        children: [node],
      });
    });

  return Array.from(sections.values());
}
