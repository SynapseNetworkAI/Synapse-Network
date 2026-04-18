import { ALL_ROUTES } from "./api-reference/endpoint-data";
import { getDocsNavTree, type NavItem } from "./nav-tree";

export type DocsPageKind = "page" | "anchor" | "api-endpoint" | "soon" | "external";
export type DocsVerificationMode = "render" | "anchor" | "api-detail" | "soon" | "external";

export type DocsPageRegistryItem = {
  id: string;
  href: string;
  kind: DocsPageKind;
  expectedHeading: string | null;
  expectedAnchors: string[];
  implemented: boolean;
  verificationMode: DocsVerificationMode;
};

export const DOCS_IMPLEMENTED_ROUTES = [
  "/docs",
  "/docs/getting-started",
  "/docs/getting-started/consumer",
  "/docs/getting-started/provider",
  "/docs/concepts",
  "/docs/api-reference",
  "/docs/sdk",
  "/docs/sdk/typescript",
  "/docs/sdk/python",
  "/docs/contracts",
] as const;

export const DOCS_PAGE_REGISTRY: DocsPageRegistryItem[] = [
  {
    id: "docs-overview",
    href: "/docs#introduction",
    kind: "page",
    expectedHeading: "Synapse Developer Platform",
    expectedAnchors: ["introduction", "architecture"],
    implemented: true,
    verificationMode: "render",
  },
  {
    id: "docs-getting-started",
    href: "/docs/getting-started",
    kind: "page",
    expectedHeading: "Choose your role",
    expectedAnchors: [],
    implemented: true,
    verificationMode: "render",
  },
  {
    id: "docs-consumer-guide",
    href: "/docs/getting-started/consumer",
    kind: "page",
    expectedHeading: "Consumer Quick Start",
    expectedAnchors: [
      "step-auth",
      "step-deposit",
      "step-discover",
      "step-credential",
      "step-invoke",
      "step-verify",
      "step-withdraw",
    ],
    implemented: true,
    verificationMode: "render",
  },
  {
    id: "docs-provider-guide",
    href: "/docs/getting-started/provider",
    kind: "page",
    expectedHeading: "Provider Quick Start",
    expectedAnchors: [
      "step-auth",
      "step-secret",
      "step-register",
      "step-status",
      "step-earnings",
      "step-withdraw",
    ],
    implemented: true,
    verificationMode: "render",
  },
  {
    id: "docs-concepts",
    href: "/docs/concepts",
    kind: "page",
    expectedHeading: "How Synapse Works",
    expectedAnchors: ["settlement", "service-registry", "credentials", "idempotency"],
    implemented: true,
    verificationMode: "render",
  },
  {
    id: "docs-api-reference",
    href: "/docs/api-reference",
    kind: "page",
    expectedHeading: "REST API",
    expectedAnchors: ["api-auth", "api-balance", "api-services", "api-provider", "api-invocations", "api-credentials"],
    implemented: true,
    verificationMode: "render",
  },
  {
    id: "docs-sdk-overview",
    href: "/docs/sdk",
    kind: "page",
    expectedHeading: "SDKs",
    expectedAnchors: ["sdk-overview", "sdk-compare"],
    implemented: true,
    verificationMode: "render",
  },
  {
    id: "docs-sdk-typescript",
    href: "/docs/sdk/typescript",
    kind: "page",
    expectedHeading: "TypeScript SDK",
    expectedAnchors: [
      "sdk-ts-install",
      "sdk-ts-auth",
      "sdk-ts-deposit",
      "sdk-ts-discover",
      "sdk-ts-invoke",
      "sdk-ts-direct",
      "sdk-ts-starter",
      "sdk-ts-verify",
      "sdk-ts-cheatsheet",
    ],
    implemented: true,
    verificationMode: "render",
  },
  {
    id: "docs-sdk-python",
    href: "/docs/sdk/python",
    kind: "page",
    expectedHeading: "Python SDK",
    expectedAnchors: ["sdk-py"],
    implemented: true,
    verificationMode: "render",
  },
  {
    id: "docs-contracts",
    href: "/docs/contracts",
    kind: "page",
    expectedHeading: "Smart Contracts",
    expectedAnchors: ["contract-core", "contract-usdc", "contract-abi"],
    implemented: true,
    verificationMode: "render",
  },
];

export const DOCS_API_ENDPOINT_REGISTRY: DocsPageRegistryItem[] = ALL_ROUTES.map((route) => ({
  id: `api-${route.id}`,
  href: `/docs/api-reference/${route.id}`,
  kind: "api-endpoint",
  expectedHeading: route.summary,
  expectedAnchors: [],
  implemented: true,
  verificationMode: "api-detail",
}));

export const DOCS_NAV_REGISTRY: DocsPageRegistryItem[] = flattenNavItems(
  getDocsNavTree([], []),
).map((item) => toRegistryItem(item));

export const DOCS_FULL_PAGE_REGISTRY: DocsPageRegistryItem[] = [
  ...DOCS_PAGE_REGISTRY,
  ...DOCS_API_ENDPOINT_REGISTRY,
  ...DOCS_NAV_REGISTRY.filter((item) => item.kind === "soon" || item.kind === "external"),
];

function flattenNavItems(items: Array<{ items: NavItem[] }>): NavItem[] {
  return items.flatMap((section) => section.items);
}

function toRegistryItem(item: NavItem): DocsPageRegistryItem {
  if (item.soon || item.href === "#") {
    return {
      id: item.id,
      href: item.href,
      kind: "soon",
      expectedHeading: null,
      expectedAnchors: [],
      implemented: false,
      verificationMode: "soon",
    };
  }
  if (item.external || !item.href.startsWith("/docs")) {
    return {
      id: item.id,
      href: item.href,
      kind: "external",
      expectedHeading: null,
      expectedAnchors: [],
      implemented: false,
      verificationMode: "external",
    };
  }
  const hash = item.href.split("#")[1];
  return {
    id: item.id,
    href: item.href,
    kind: hash ? "anchor" : "page",
    expectedHeading: null,
    expectedAnchors: hash ? [hash] : [],
    implemented: true,
    verificationMode: hash ? "anchor" : "render",
  };
}
