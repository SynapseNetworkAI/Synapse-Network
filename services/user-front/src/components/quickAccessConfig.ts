import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bot,
  Compass,
  CreditCard,
  FileText,
  Globe,
  History,
  LayoutGrid,
  Server,
  ShieldAlert,
  Terminal,
  Wallet,
} from "lucide-react";

export type QuickAccessEntryConfig = {
  href: string;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  keywords: string[];
  matches: (pathname: string) => boolean;
};

export const QUICK_ACCESS_CONFIG: QuickAccessEntryConfig[] = [
  {
    href: "/dashboard/overview",
    labelKey: "sidebar.overview",
    descriptionKey: "nav.quickAccessOverviewDescription",
    icon: LayoutGrid,
    keywords: ["home", "dashboard", "owner"],
    matches: (value) => value === "/dashboard/overview",
  },
  {
    href: "/dashboard/agents",
    labelKey: "sidebar.agents",
    descriptionKey: "nav.quickAccessAgentsDescription",
    icon: Bot,
    keywords: ["runtime", "agent", "credentials"],
    matches: (value) => value.startsWith("/dashboard/agents"),
  },
  {
    href: "/dashboard/discovery",
    labelKey: "sidebar.discovery",
    descriptionKey: "nav.quickAccessDiscoveryDescription",
    icon: Compass,
    keywords: ["services", "registry", "routing"],
    matches: (value) => value.startsWith("/dashboard/discovery"),
  },
  {
    href: "/dashboard/invocations",
    labelKey: "sidebar.invocations",
    descriptionKey: "nav.quickAccessInvocationsDescription",
    icon: History,
    keywords: ["requests", "logs", "traffic"],
    matches: (value) => value.startsWith("/dashboard/invocations"),
  },
  {
    href: "/dashboard/billing/credits",
    labelKey: "sidebar.credits",
    descriptionKey: "nav.quickAccessCreditsDescription",
    icon: Wallet,
    keywords: ["balance", "voucher", "spend cap"],
    matches: (value) => value === "/dashboard/billing/credits",
  },
  {
    href: "/dashboard/billing",
    labelKey: "sidebar.payments",
    descriptionKey: "nav.quickAccessPaymentsDescription",
    icon: CreditCard,
    keywords: ["billing", "payments", "records"],
    matches: (value) => value === "/dashboard/billing",
  },
  {
    href: "/dashboard/audit",
    labelKey: "sidebar.riskAudit",
    descriptionKey: "nav.quickAccessAuditDescription",
    icon: ShieldAlert,
    keywords: ["alerts", "audit", "risk"],
    matches: (value) => value.startsWith("/dashboard/audit"),
  },
  {
    href: "/dashboard/developer",
    labelKey: "sidebar.developerResources",
    descriptionKey: "nav.quickAccessDeveloperDescription",
    icon: Terminal,
    keywords: ["docs", "guides", "sdk"],
    matches: (value) => value.startsWith("/dashboard/developer"),
  },
  {
    href: "/dashboard/account/settings",
    labelKey: "sidebar.settings",
    descriptionKey: "nav.quickAccessAccountSettingsDescription",
    icon: FileText,
    keywords: ["account", "settings", "preferences", "session"],
    matches: (value) => value.startsWith("/dashboard/account/settings"),
  },
  {
    href: "/dashboard/account/withdraw",
    labelKey: "sidebar.withdraw",
    descriptionKey: "nav.quickAccessAccountWithdrawDescription",
    icon: Wallet,
    keywords: ["account", "withdraw", "refund", "wallet"],
    matches: (value) => value.startsWith("/dashboard/account/withdraw"),
  },
  {
    href: "/provider/console",
    labelKey: "sidebar.providerConsole",
    descriptionKey: "nav.quickAccessProviderConsoleDescription",
    icon: LayoutGrid,
    keywords: ["provider", "console", "workspace"],
    matches: (value) =>
      value.startsWith("/provider/console") ||
      value.startsWith("/provider/sell"),
  },
  {
    href: "/provider/secrets",
    labelKey: "sidebar.providerCredentials",
    descriptionKey: "nav.quickAccessProviderCredentialsDescription",
    icon: FileText,
    keywords: ["provider", "credentials", "secrets"],
    matches: (value) => value.startsWith("/provider/secrets"),
  },
  {
    href: "/provider/services",
    labelKey: "sidebar.myServices",
    descriptionKey: "nav.quickAccessServicesDescription",
    icon: Server,
    keywords: ["provider", "services", "deploy"],
    matches: (value) => value.startsWith("/provider/services"),
  },
  {
    href: "/provider/usage",
    labelKey: "sidebar.usageAnalytics",
    descriptionKey: "nav.quickAccessUsageDescription",
    icon: Activity,
    keywords: ["usage", "analytics", "earnings"],
    matches: (value) => value.startsWith("/provider/usage"),
  },
  {
    href: "/provider/withdraw",
    labelKey: "sidebar.withdraw",
    descriptionKey: "nav.quickAccessSettlementsDescription",
    icon: Wallet,
    keywords: ["settlements", "withdraw", "payouts"],
    matches: (value) => value.startsWith("/provider/withdraw"),
  },
  {
    href: "/marketplace",
    labelKey: "nav.apiMarketplace",
    descriptionKey: "nav.quickAccessMarketplaceDescription",
    icon: Globe,
    keywords: ["marketplace", "public", "services"],
    matches: (value) => value.startsWith("/marketplace"),
  },
  {
    href: "/blog",
    labelKey: "nav.blog",
    descriptionKey: "nav.quickAccessBlogDescription",
    icon: FileText,
    keywords: ["blog", "updates", "news"],
    matches: (value) => value.startsWith("/blog"),
  },
  {
    href: "/about",
    labelKey: "nav.about",
    descriptionKey: "nav.quickAccessAboutDescription",
    icon: Globe,
    keywords: ["about", "vision", "infrastructure"],
    matches: (value) => value.startsWith("/about"),
  },
];
