"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
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
  Search,
  Server,
  ShieldAlert,
  Terminal,
  Wallet,
} from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { XDialog, XDialogSurface } from "@/components/xui/XDialog";
import { XInput } from "@/components/xui/XInput";

type QuickAccessDialogProps = {
  open: boolean;
  onClose: () => void;
};

type QuickAccessEntry = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
  matches: (pathname: string) => boolean;
};

export default function QuickAccessDialog({ open, onClose }: Readonly<QuickAccessDialogProps>) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const entries = useMemo<QuickAccessEntry[]>(
    () => [
      {
        href: "/dashboard/overview",
        label: t("sidebar.overview"),
        description: t("nav.quickAccessOverviewDescription"),
        icon: LayoutGrid,
        keywords: ["home", "dashboard", "owner"],
        matches: (value) => value === "/dashboard/overview",
      },
      {
        href: "/dashboard/agents",
        label: t("sidebar.agents"),
        description: t("nav.quickAccessAgentsDescription"),
        icon: Bot,
        keywords: ["runtime", "agent", "credentials"],
        matches: (value) => value.startsWith("/dashboard/agents"),
      },
      {
        href: "/dashboard/discovery",
        label: t("sidebar.discovery"),
        description: t("nav.quickAccessDiscoveryDescription"),
        icon: Compass,
        keywords: ["services", "registry", "routing"],
        matches: (value) => value.startsWith("/dashboard/discovery"),
      },
      {
        href: "/dashboard/invocations",
        label: t("sidebar.invocations"),
        description: t("nav.quickAccessInvocationsDescription"),
        icon: History,
        keywords: ["requests", "logs", "traffic"],
        matches: (value) => value.startsWith("/dashboard/invocations"),
      },
      {
        href: "/dashboard/billing/credits",
        label: t("sidebar.credits"),
        description: t("nav.quickAccessCreditsDescription"),
        icon: Wallet,
        keywords: ["balance", "voucher", "spend cap"],
        matches: (value) => value === "/dashboard/billing/credits",
      },
      {
        href: "/dashboard/billing",
        label: t("sidebar.payments"),
        description: t("nav.quickAccessPaymentsDescription"),
        icon: CreditCard,
        keywords: ["billing", "payments", "records"],
        matches: (value) => value === "/dashboard/billing",
      },
      {
        href: "/dashboard/audit",
        label: t("sidebar.riskAudit"),
        description: t("nav.quickAccessAuditDescription"),
        icon: ShieldAlert,
        keywords: ["alerts", "audit", "risk"],
        matches: (value) => value.startsWith("/dashboard/audit"),
      },
      {
        href: "/dashboard/developer",
        label: t("sidebar.developerResources"),
        description: t("nav.quickAccessDeveloperDescription"),
        icon: Terminal,
        keywords: ["docs", "guides", "sdk"],
        matches: (value) => value.startsWith("/dashboard/developer"),
      },
      {
        href: "/dashboard/account/settings",
        label: t("sidebar.settings"),
        description: t("nav.quickAccessAccountSettingsDescription"),
        icon: FileText,
        keywords: ["account", "settings", "preferences", "session"],
        matches: (value) => value.startsWith("/dashboard/account/settings"),
      },
      {
        href: "/provider/console",
        label: t("sidebar.providerConsole"),
        description: t("nav.quickAccessProviderConsoleDescription"),
        icon: LayoutGrid,
        keywords: ["provider", "console", "workspace"],
        matches: (value) => value.startsWith("/provider/console") || value.startsWith("/provider/sell"),
      },
      {
        href: "/provider/secrets",
        label: t("sidebar.providerCredentials"),
        description: t("nav.quickAccessProviderCredentialsDescription"),
        icon: FileText,
        keywords: ["provider", "credentials", "secrets"],
        matches: (value) => value.startsWith("/provider/secrets"),
      },
      {
        href: "/provider/services",
        label: t("sidebar.myServices"),
        description: t("nav.quickAccessServicesDescription"),
        icon: Server,
        keywords: ["provider", "services", "deploy"],
        matches: (value) => value.startsWith("/provider/services"),
      },
      {
        href: "/provider/usage",
        label: t("sidebar.usageAnalytics"),
        description: t("nav.quickAccessUsageDescription"),
        icon: Activity,
        keywords: ["usage", "analytics", "earnings"],
        matches: (value) => value.startsWith("/provider/usage"),
      },
      {
        href: "/provider/withdraw",
        label: t("sidebar.withdraw"),
        description: t("nav.quickAccessSettlementsDescription"),
        icon: Wallet,
        keywords: ["settlements", "withdraw", "payouts"],
        matches: (value) => value.startsWith("/provider/withdraw"),
      },
      {
        href: "/marketplace",
        label: t("nav.apiMarketplace"),
        description: t("nav.quickAccessMarketplaceDescription"),
        icon: Globe,
        keywords: ["marketplace", "public", "services"],
        matches: (value) => value.startsWith("/marketplace"),
      },
      {
        href: "/blog",
        label: t("nav.blog"),
        description: t("nav.quickAccessBlogDescription"),
        icon: FileText,
        keywords: ["blog", "updates", "news"],
        matches: (value) => value.startsWith("/blog"),
      },
      {
        href: "/about",
        label: t("nav.about"),
        description: t("nav.quickAccessAboutDescription"),
        icon: Globe,
        keywords: ["about", "vision", "infrastructure"],
        matches: (value) => value.startsWith("/about"),
      },
    ],
    [t],
  );

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return entries;
    }

    return entries.filter((entry) =>
      [entry.label, entry.description, ...entry.keywords].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [entries, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery("");
    setActiveIndex(0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
    };
  }, [onClose, open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const activateEntry = (entry: QuickAccessEntry) => {
    if (entry.matches(pathname)) {
      onClose();
      return;
    }

    router.push(entry.href);
    onClose();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (filteredEntries.length === 0 ? 0 : (current + 1) % filteredEntries.length));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (filteredEntries.length === 0 ? 0 : (current - 1 + filteredEntries.length) % filteredEntries.length));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const target = filteredEntries[activeIndex];
      if (target) {
        activateEntry(target);
      }
    }
  };

  return (
    <XDialog open={open} ariaLabelledby="quick-access-title" onDismiss={onClose} overlayClassName="items-start pt-[92px]">
      <XDialogSurface className="max-w-[560px] rounded-[24px] border-white/10 bg-[linear-gradient(180deg,rgba(10,10,12,0.98),rgba(6,7,9,0.985))] shadow-[0_32px_140px_rgba(0,0,0,0.55)]">
        <div className="border-b border-white/6 px-4 pb-3 pt-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl text-white/68">
              <Search className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p id="quick-access-title" className="sr-only">
                {t("nav.quickAccess")}
              </p>
              <XInput
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={t("nav.searchPlaceholder")}
                className="h-11 border-0 bg-transparent px-0 py-0 text-[1.15rem] font-medium text-white placeholder:text-white/34 focus:ring-0"
              />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 min-w-[44px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55 transition hover:border-white/16 hover:bg-white/[0.06] hover:text-white/84"
            >
              ESC
            </button>
          </div>
        </div>

        <div className="px-4 pb-3 pt-3">
          <div className="mb-3 flex items-center justify-between px-1">
            <div>
              <p className="text-[13px] font-semibold text-white/88">{t("nav.quickAccess")}</p>
              <p className="mt-1 text-[13px] text-white/42">{t("nav.quickAccessHint")}</p>
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto pr-1">
            {filteredEntries.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/46">
                {t("nav.quickAccessEmpty")}
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredEntries.map((entry, index) => {
                  const Icon = entry.icon;
                  const selected = index === activeIndex;
                  const active = entry.matches(pathname);

                  return (
                    <button
                      key={entry.href}
                      type="button"
                      data-testid="quick-access-result"
                      data-href={entry.href}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => activateEntry(entry)}
                      className={[
                        "flex w-full items-start gap-3 rounded-[18px] px-4 py-3 text-left transition-[background-color,box-shadow,transform]",
                        selected
                          ? "bg-white/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                          : "hover:bg-white/[0.04]",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors",
                          active
                            ? "border-[#7ff7be]/18 bg-[#7ff7be]/[0.08] text-[#7ff7be]"
                            : "border-white/8 bg-white/[0.025] text-white/54",
                        ].join(" ")}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-[15px] font-medium text-white">
                          {entry.label}
                          {active ? (
                            <span className="inline-flex h-2 w-2 rounded-full bg-[#7ff7be] shadow-[0_0_10px_rgba(127,247,190,0.55)]" aria-hidden="true">
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-[13px] leading-5 text-white/42">{entry.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </XDialogSurface>
    </XDialog>
  );
}
