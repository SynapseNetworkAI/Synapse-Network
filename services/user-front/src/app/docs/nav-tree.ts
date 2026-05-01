import { ROUTE_GROUPS } from "./api-reference/endpoint-data";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  soon?: boolean;
  external?: boolean;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

function navLabel(labels: string[], index: number, fallback: string) {
  return labels[index] || fallback;
}

function nestedNavLabel(labels: string[], index: number, fallback: string) {
  return `↳ ${navLabel(labels, index, fallback)}`;
}

function normalizeSoonItem(item: NavItem): NavItem {
  if (!item.soon) return item;
  return {
    ...item,
    soon: true,
    label: item.label,
    external: item.external || false,
  };
}

// href with no hash = the "page root" item for that route.
// href with hash   = a sub-section anchor on that page.
export function getDocsNavTree(
  sectionLabels: string[],
  itemLabels: string[]
): NavSection[] {
  return [
    {
      id: "overview",
      label: navLabel(sectionLabels, 0, "OVERVIEW"),
      items: [
        {
          id: "introduction",
          label: navLabel(itemLabels, 0, "Introduction"),
          href: "/docs",
        },
        {
          id: "architecture",
          label: navLabel(itemLabels, 1, "Architecture"),
          href: "/docs#architecture",
        },
      ],
    },
    {
      id: "getting-started",
      label: navLabel(sectionLabels, 1, "GETTING STARTED"),
      items: [
        {
          id: "gs-overview",
          label: navLabel(itemLabels, 2, "Overview"),
          href: "/docs/getting-started",
        },
        {
          id: "gs-consumer",
          label: navLabel(itemLabels, 3, "Consumer Guide"),
          href: "/docs/getting-started/consumer",
        },
        {
          id: "gs-c-auth",
          label: nestedNavLabel(itemLabels, 4, "Auth"),
          href: "/docs/getting-started/consumer#step-auth",
        },
        {
          id: "gs-c-deposit",
          label: nestedNavLabel(itemLabels, 5, "Deposit USDC"),
          href: "/docs/getting-started/consumer#step-deposit",
        },
        {
          id: "gs-c-discover",
          label: nestedNavLabel(itemLabels, 6, "Discover Services"),
          href: "/docs/getting-started/consumer#step-discover",
        },
        {
          id: "gs-c-cred",
          label: nestedNavLabel(itemLabels, 7, "Create Credential"),
          href: "/docs/getting-started/consumer#step-credential",
        },
        {
          id: "gs-c-invoke",
          label: nestedNavLabel(itemLabels, 8, "Invoke & Settle"),
          href: "/docs/getting-started/consumer#step-invoke",
        },
        {
          id: "gs-provider",
          label: navLabel(itemLabels, 9, "Provider Guide"),
          href: "/docs/getting-started/provider",
        },
        {
          id: "gs-p-auth",
          label: nestedNavLabel(itemLabels, 4, "Auth"),
          href: "/docs/getting-started/provider#step-auth",
        },
        {
          id: "gs-p-register",
          label: nestedNavLabel(itemLabels, 10, "Register Service"),
          href: "/docs/getting-started/provider#step-register",
        },
        {
          id: "gs-p-secret",
          label: nestedNavLabel(itemLabels, 11, "Provider Secret"),
          href: "/docs/getting-started/provider#step-secret",
        },
        {
          id: "gs-p-status",
          label: nestedNavLabel(itemLabels, 12, "Runtime Status"),
          href: "/docs/getting-started/provider#step-status",
        },
        {
          id: "gs-p-earnings",
          label: nestedNavLabel(itemLabels, 13, "View Earnings"),
          href: "/docs/getting-started/provider#step-earnings",
        },
        {
          id: "gs-p-withdraw",
          label: nestedNavLabel(itemLabels, 14, "Withdraw USDC"),
          href: "/docs/getting-started/provider#step-withdraw",
        },
      ],
    },
    {
      id: "core-concepts",
      label: navLabel(sectionLabels, 2, "CORE CONCEPTS"),
      items: [
        {
          id: "settlement",
          label: navLabel(itemLabels, 15, "How Settlement Works"),
          href: "/docs/concepts#settlement",
        },
        {
          id: "service-registry",
          label: navLabel(itemLabels, 16, "Service Registry"),
          href: "/docs/concepts#service-registry",
        },
        {
          id: "credentials",
          label: navLabel(itemLabels, 17, "Agent Credentials"),
          href: "/docs/concepts#credentials",
        },
        {
          id: "idempotency",
          label: navLabel(itemLabels, 18, "Idempotency"),
          href: "/docs/concepts#idempotency",
        },
      ],
    },
    {
      id: "api-reference",
      label: navLabel(sectionLabels, 3, "API REFERENCE"),
      items: ROUTE_GROUPS.flatMap((g, i) => {
        const groupLabel =
          [
            navLabel(itemLabels, 19, "Auth"),
            navLabel(itemLabels, 20, "Balance"),
            navLabel(itemLabels, 21, "Services"),
            navLabel(itemLabels, 22, "Provider Operations"),
            navLabel(itemLabels, 23, "Agent Invocations"),
            navLabel(itemLabels, 24, "Credentials"),
          ][i] || g.title;
        return [
          {
            id: g.id,
            label: groupLabel,
            href: `/docs/api-reference#${g.id}`,
          },
          ...g.routes.map((r) => ({
            id: `api-${r.id}`,
            label: `↳ ${r.method} ${r.path.replace("/api/v1", "")}`,
            href: `/docs/api-reference/${r.id}`,
          })),
        ];
      }),
    },
    {
      id: "sdk",
      label: navLabel(sectionLabels, 4, "SDK"),
      items: [
        {
          id: "sdk-overview",
          label: navLabel(itemLabels, 25, "SDK Overview"),
          href: "/docs/sdk",
        },
        {
          id: "sdk-ts",
          label: navLabel(itemLabels, 26, "TypeScript SDK"),
          href: "/docs/sdk/typescript",
        },
        {
          id: "sdk-py",
          label: navLabel(itemLabels, 27, "Python SDK"),
          href: "/docs/sdk/python",
        },
      ],
    },
    {
      id: "contracts",
      label: navLabel(sectionLabels, 5, "SMART CONTRACTS"),
      items: [
        {
          id: "contract-core",
          label: navLabel(itemLabels, 28, "SynapseCore"),
          href: "/docs/contracts",
        },
        {
          id: "contract-usdc",
          label: navLabel(itemLabels, 29, "MockUSDC (Testnet)"),
          href: "/docs/contracts#contract-usdc",
        },
      ],
    },
    {
      id: "resources",
      label: navLabel(sectionLabels, 6, "RESOURCES"),
      items: [
        {
          id: "support",
          label: navLabel(itemLabels, 33, "Support"),
          href: "/docs/support",
        },
        {
          id: "changelog",
          label: navLabel(itemLabels, 30, "Changelog"),
          href: "/blog",
        },
        {
          id: "status",
          label: navLabel(itemLabels, 31, "Status Page"),
          href: "#",
          soon: true,
        },
        {
          id: "community",
          label: navLabel(itemLabels, 32, "GitHub"),
          href: "https://github.com/SynapseNetworkAI/Synapse-Network-Sdk",
          external: true,
        },
      ],
    },
  ].map((section) => ({
    ...section,
    items: section.items.map(normalizeSoonItem),
  }));
}

export function getSoonLabel(fallback?: string) {
  return fallback || "SOON";
}
