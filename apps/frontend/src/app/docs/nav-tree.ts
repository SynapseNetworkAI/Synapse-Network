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
export const NAV_TREE: NavSection[] = [
  {
    id: "overview",
    label: "OVERVIEW",
    items: [
      { id: "introduction", label: "Introduction",   href: "/docs" },
      { id: "architecture", label: "Architecture",   href: "/docs#architecture" },
    ],
  },
  {
    id: "getting-started",
    label: "GETTING STARTED",
    items: [
      { id: "quickstart",      label: "Quick Start (5 min)", href: "/docs/getting-started" },
      { id: "authentication",  label: "Authentication",       href: "/docs/getting-started#authentication" },
      { id: "deposit",         label: "Deposit USDC",         href: "/docs/getting-started#deposit" },
    ],
  },
  {
    id: "core-concepts",
    label: "CORE CONCEPTS",
    items: [
      { id: "settlement",       label: "How Settlement Works", href: "/docs/concepts" },
      { id: "service-registry", label: "Service Registry",     href: "/docs/concepts#service-registry" },
      { id: "credentials",      label: "Agent Credentials",    href: "/docs/concepts#credentials" },
      { id: "idempotency",      label: "Idempotency",          href: "/docs/concepts#idempotency" },
    ],
  },
  {
    id: "api-reference",
    label: "API REFERENCE",
    items: [
      { id: "api-auth",        label: "Auth",              href: "/docs/api-reference" },
      { id: "api-balance",     label: "Balance",           href: "/docs/api-reference#api-balance" },
      { id: "api-services",    label: "Services",          href: "/docs/api-reference#api-services" },
      { id: "api-invocations", label: "Agent Invocations", href: "/docs/api-reference#api-invocations" },
      { id: "api-credentials", label: "Credentials",       href: "/docs/api-reference#api-credentials" },
    ],
  },
  {
    id: "sdk",
    label: "SDK",
    items: [
      { id: "sdk-ts", label: "TypeScript SDK", href: "/docs/sdk" },
      { id: "sdk-py", label: "Python SDK",     href: "/docs/sdk#sdk-py", soon: true },
    ],
  },
  {
    id: "contracts",
    label: "SMART CONTRACTS",
    items: [
      { id: "contract-core", label: "SynapseCore",       href: "/docs/contracts" },
      { id: "contract-usdc", label: "MockUSDC (Testnet)", href: "/docs/contracts#contract-usdc" },
    ],
  },
  {
    id: "resources",
    label: "RESOURCES",
    items: [
      { id: "changelog", label: "Changelog",  href: "/blog" },
      { id: "status",    label: "Status Page", href: "#", soon: true },
      { id: "community", label: "GitHub",      href: "https://github.com/synapse-network", external: true },
    ],
  },
];
