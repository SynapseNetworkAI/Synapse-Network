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

// href with no hash = the "page root" item for that route.
// href with hash   = a sub-section anchor on that page.
export function getDocsNavTree(sectionLabels: string[], itemLabels: string[]): NavSection[] {
  return [
    {
      id: "overview",
      label: sectionLabels[0] ?? "OVERVIEW",
      items: [
        { id: "introduction", label: itemLabels[0] ?? "Introduction", href: "/docs" },
        { id: "architecture", label: itemLabels[1] ?? "Architecture", href: "/docs#architecture" },
      ],
    },
    {
      id: "getting-started",
      label: sectionLabels[1] ?? "GETTING STARTED",
      items: [
        { id: "gs-overview", label: itemLabels[2] ?? "Overview", href: "/docs/getting-started" },
        { id: "gs-consumer", label: itemLabels[3] ?? "Consumer Guide", href: "/docs/getting-started/consumer" },
        { id: "gs-c-auth", label: `↳ ${itemLabels[4] ?? "Auth"}`, href: "/docs/getting-started/consumer#step-auth" },
        { id: "gs-c-deposit", label: `↳ ${itemLabels[5] ?? "Deposit USDC"}`, href: "/docs/getting-started/consumer#step-deposit" },
        { id: "gs-c-discover", label: `↳ ${itemLabels[6] ?? "Discover Services"}`, href: "/docs/getting-started/consumer#step-discover" },
        { id: "gs-c-cred", label: `↳ ${itemLabels[7] ?? "Create Credential"}`, href: "/docs/getting-started/consumer#step-credential" },
        { id: "gs-c-invoke", label: `↳ ${itemLabels[8] ?? "Invoke & Settle"}`, href: "/docs/getting-started/consumer#step-invoke" },
        { id: "gs-provider", label: itemLabels[9] ?? "Provider Guide", href: "/docs/getting-started/provider" },
        { id: "gs-p-auth", label: `↳ ${itemLabels[4] ?? "Auth"}`, href: "/docs/getting-started/provider#step-auth" },
        { id: "gs-p-register", label: `↳ ${itemLabels[10] ?? "Register Service"}`, href: "/docs/getting-started/provider#step-register" },
        { id: "gs-p-secret", label: `↳ ${itemLabels[11] ?? "Provider Secret"}`, href: "/docs/getting-started/provider#step-secret" },
        { id: "gs-p-status", label: `↳ ${itemLabels[12] ?? "Runtime Status"}`, href: "/docs/getting-started/provider#step-status" },
        { id: "gs-p-earnings", label: `↳ ${itemLabels[13] ?? "View Earnings"}`, href: "/docs/getting-started/provider#step-earnings" },
        { id: "gs-p-withdraw", label: `↳ ${itemLabels[14] ?? "Withdraw USDC"}`, href: "/docs/getting-started/provider#step-withdraw" },
      ],
    },
    {
      id: "core-concepts",
      label: sectionLabels[2] ?? "CORE CONCEPTS",
      items: [
        { id: "settlement", label: itemLabels[15] ?? "How Settlement Works", href: "/docs/concepts#settlement" },
        { id: "service-registry", label: itemLabels[16] ?? "Service Registry", href: "/docs/concepts#service-registry" },
        { id: "credentials", label: itemLabels[17] ?? "Agent Credentials", href: "/docs/concepts#credentials" },
        { id: "idempotency", label: itemLabels[18] ?? "Idempotency", href: "/docs/concepts#idempotency" },
      ],
    },
    {
      id: "api-reference",
      label: sectionLabels[3] ?? "API REFERENCE",
      items: ROUTE_GROUPS.flatMap((g, i) => {
        const groupLabel = [
          itemLabels[19] ?? "Auth",
          itemLabels[20] ?? "Balance",
          itemLabels[21] ?? "Services",
          itemLabels[22] ?? "Provider Operations",
          itemLabels[23] ?? "Agent Invocations",
          itemLabels[24] ?? "Credentials",
        ][i] ?? g.title;
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
      label: sectionLabels[4] ?? "SDK",
      items: [
        { id: "sdk-overview", label: itemLabels[25] ?? "SDK Overview", href: "/docs/sdk" },
        { id: "sdk-ts", label: itemLabels[26] ?? "TypeScript SDK", href: "/docs/sdk/typescript" },
        { id: "sdk-py", label: itemLabels[27] ?? "Python SDK", href: "/docs/sdk/python" },
      ],
    },
    {
      id: "contracts",
      label: sectionLabels[5] ?? "SMART CONTRACTS",
      items: [
        { id: "contract-core", label: itemLabels[28] ?? "SynapseCore", href: "/docs/contracts" },
        { id: "contract-usdc", label: itemLabels[29] ?? "MockUSDC (Testnet)", href: "/docs/contracts#contract-usdc" },
      ],
    },
    {
      id: "resources",
      label: sectionLabels[6] ?? "RESOURCES",
      items: [
        { id: "changelog", label: itemLabels[30] ?? "Changelog", href: "/blog" },
        { id: "status", label: itemLabels[31] ?? "Status Page", href: "#", soon: true },
        { id: "community", label: itemLabels[32] ?? "GitHub", href: "https://github.com/cliff-personal/Synapse-Network-Sdk", external: true },
      ],
    },
  ].map((section) => ({
    ...section,
    items: section.items.map((item) => (item.soon ? { ...item, soon: true, label: item.label, external: item.external ?? false } : item)),
  }));
}

export function getSoonLabel(fallback?: string) {
  return fallback || "SOON";
}
