"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useDisconnect } from "wagmi";
import toast from "react-hot-toast";
import { useAuth } from "@/components/WalletAuthGuard";
import { useDashboardNavigationFeedback } from "@/components/dashboard/DashboardNavigationFeedback";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import {
  XDialog,
  XDialogBody,
  XDialogFooter,
  XDialogHeader,
  XDialogHeaderCopy,
  XDialogSurface,
} from "@/components/xui/XDialog";
import { buildAuthedHeaders, clearAuthSession } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";
import { listAgentCredentials } from "@/utils/agentCredentialApi";
import { listServiceRegistry } from "@/utils/serviceApi";
import {
  LayoutGrid,
  Wallet,
  Bot,
  Compass,
  Box,
  Key,
  AreaChart,
  Database,
  ShieldCheck,
  Terminal,
  AlertTriangle,
  History,
  ChevronDown,
  CircleUserRound,
  Settings,
  LogOut,
  LogIn,
} from "lucide-react";

export default function DashboardSidebar() {
  const pathname = usePathname();
  const activePath = pathname ?? "";
  const router = useRouter();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const { isConnected, isSessionAuthenticated, authorize } = useAuth();
  const { beginNavigation } = useDashboardNavigationFeedback();
  const { t } = useLanguage();

  const providerRoot = "/provider";
  const providerConsoleRoute = `${providerRoot}/console`;
  const providerWithdrawRoute = `${providerRoot}/withdraw`;
  const providerWithdrawHistoryRoute = `${providerRoot}/withdraw/history`;
  const billingChildActive = activePath.startsWith("/dashboard/billing");
  const accountChildActive = activePath.startsWith("/dashboard/account");
  const settlementChildActive = activePath.startsWith(
    `${providerRoot}/withdraw`
  );
  const [billingExpanded, setBillingExpanded] = useState(billingChildActive);
  const [accountExpanded, setAccountExpanded] = useState(accountChildActive);
  const [settlementExpanded, setSettlementExpanded] = useState(
    settlementChildActive
  );
  const [agentCount, setAgentCount] = useState<number | null>(null);
  const [serviceCount, setServiceCount] = useState<number | null>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  useEffect(() => {
    if (!isConnected || !isSessionAuthenticated || !address) return;
    listAgentCredentials(address)
      .then((creds) => setAgentCount(creds.length))
      .catch(() => {});
    listServiceRegistry(address, address)
      .then((svcs) => setServiceCount(svcs.length))
      .catch(() => {});
  }, [isConnected, isSessionAuthenticated, address]);

  useEffect(() => {
    if (billingChildActive) {
      setBillingExpanded(true);
    }
  }, [billingChildActive]);

  useEffect(() => {
    if (accountChildActive) {
      setAccountExpanded(true);
    }
  }, [accountChildActive]);

  useEffect(() => {
    if (settlementChildActive) {
      setSettlementExpanded(true);
    }
  }, [settlementChildActive]);

  const isRouteActive = (paths: string | string[], exact = false) => {
    const candidates = Array.isArray(paths) ? paths : [paths];
    return candidates.some((path) =>
      exact ? activePath === path : activePath.startsWith(path)
    );
  };

  const getLinkClasses = (paths: string | string[], exact = false) => {
    const active = isRouteActive(paths, exact);
    if (active) {
      return "group mx-2 mt-1 flex items-center rounded-2xl bg-white/[0.045] px-4 py-[11px] text-[14px] font-medium text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.035)] transition-[background-color,color,box-shadow]";
    }
    return "group mx-2 mt-1 flex items-center rounded-2xl px-4 py-[11px] text-[14px] font-medium text-white/74 transition-[background-color,color,box-shadow] hover:bg-white/[0.028] hover:text-white";
  };

  const getBadgeClasses = (active: boolean) => {
    return active
      ? "ml-auto flex min-w-[22px] items-center justify-center rounded-full bg-white/[0.08] px-2 py-0.5 font-mono text-[10px] text-white/88"
      : "ml-auto flex min-w-[22px] items-center justify-center rounded-full bg-white/[0.045] px-2 py-0.5 font-mono text-[10px] text-white/46";
  };

  const getSubLinkClasses = (path: string) => {
    const active = activePath === path;
    if (active) {
      return "ml-10 mr-2 mt-1 flex items-center rounded-2xl bg-white/[0.065] px-4 py-2.5 text-[14px] font-medium text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] transition-[background-color,color,box-shadow]";
    }
    return "ml-10 mr-2 mt-1 flex items-center rounded-2xl px-4 py-2.5 text-[14px] font-medium text-white/70 transition-[background-color,color] hover:bg-white/[0.03] hover:text-white";
  };

  const getDangerSubButtonClasses = () => {
    return "ml-10 mr-2 mt-1 flex w-[calc(100%-3rem)] items-center rounded-2xl px-4 py-2.5 text-[14px] font-medium text-[#ff8f8f] transition-[background-color,color] hover:bg-[#2a1115] hover:text-[#ffb3b3]";
  };

  const getGroupTriggerClasses = (expanded: boolean) => {
    if (expanded) {
      return "group mx-2 mt-1 flex w-[calc(100%-1rem)] items-center rounded-2xl px-4 py-[11px] text-[14px] font-medium text-white/90 transition-[background-color,color] hover:bg-white/[0.028]";
    }
    return "group mx-2 mt-1 flex w-[calc(100%-1rem)] items-center rounded-2xl px-4 py-[11px] text-[14px] font-medium text-white/74 transition-[background-color,color] hover:bg-white/[0.028] hover:text-white";
  };

  const shouldBypassNavGuard = (event: MouseEvent<HTMLAnchorElement>) => {
    return (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    );
  };

  const handleSidebarNavigation = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, href: string) => {
      if (shouldBypassNavGuard(event)) {
        return;
      }

      if (activePath === href) {
        event.preventDefault();
        return;
      }

      beginNavigation(href);
    },
    [activePath, beginNavigation]
  );

  const getRouteLinkProps = useCallback(
    (href: string) => ({
      href,
      prefetch: false,
      onClick: (event: MouseEvent<HTMLAnchorElement>) => {
        handleSidebarNavigation(event, href);
      },
    }),
    [handleSidebarNavigation]
  );

  const handleWithdrawNavigation = async (
    event: MouseEvent<HTMLAnchorElement>,
    target: string
  ) => {
    if (shouldBypassNavGuard(event)) {
      return;
    }

    event.preventDefault();

    if (!isConnected) {
      openConnectModal?.();
      return;
    }

    if (!isSessionAuthenticated) {
      const authorized = await authorize();
      if (!authorized) {
        return;
      }
    }

    beginNavigation(target);
    router.push(target);
  };

  const handleLogout = useCallback(async () => {
    if (address) {
      try {
        const response = await fetch(
          `${getGatewayBaseUrl()}/api/v1/auth/logout`,
          {
            method: "POST",
            headers: {
              ...buildAuthedHeaders(address, false),
            },
          }
        );
        if (!response.ok && response.status !== 404) {
          console.warn("Backend logout warning:", response.status);
        }
      } catch (error) {
        console.warn("Backend logout warning:", error);
      }
    }

    clearAuthSession();
    disconnect();
    toast.success(t("nav.walletDisconnected"));
    router.push("/");
  }, [address, disconnect, router, t]);

  return (
    <>
      <aside className="w-[270px] shrink-0 bg-[#0a0a0c] border-r border-[#2f3336] flex flex-col pt-6 overflow-y-auto min-h-[calc(100vh-60px)] pb-12 font-sans tracking-tight">
        {/* OWNER CONTROL PLANE */}
        <div className="mb-6">
          <h3 className="px-6 mb-2 text-[11px] font-bold tracking-widest text-gray-500 uppercase flex items-center gap-2">
            <ShieldCheck className="w-3 h-3" />
            {t("sidebar.ownerControl")}
          </h3>
          <nav className="flex flex-col gap-0.5">
            <Link
              {...getRouteLinkProps("/dashboard/overview")}
              className={getLinkClasses(["/dashboard/overview"], true)}
            >
              <LayoutGrid className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
              {t("sidebar.overview")}
            </Link>
            <Link
              {...getRouteLinkProps("/dashboard/agents")}
              className={getLinkClasses("/dashboard/agents", false)}
            >
              <Bot className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
              {t("sidebar.agents")}
              {agentCount !== null && (
                <span
                  className={getBadgeClasses(
                    isRouteActive("/dashboard/agents")
                  )}
                >
                  {agentCount}
                </span>
              )}
            </Link>
            <Link
              {...getRouteLinkProps("/dashboard/discovery")}
              className={getLinkClasses("/dashboard/discovery", false)}
            >
              <Compass className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
              {t("sidebar.discovery")}
            </Link>
            <Link
              {...getRouteLinkProps("/dashboard/invocations")}
              className={getLinkClasses("/dashboard/invocations", false)}
            >
              <History className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
              {t("sidebar.invocations")}
            </Link>
            <button
              type="button"
              className={getGroupTriggerClasses(billingExpanded)}
              onClick={() => setBillingExpanded((current) => !current)}
              aria-expanded={billingExpanded}
              aria-controls="dashboard-billing-subnav"
            >
              <Wallet className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
              {t("sidebar.billing")}
              <ChevronDown
                className={`ml-auto h-4 w-4 text-white/38 transition-transform duration-200 ${
                  billingExpanded ? "rotate-0 text-white/56" : "-rotate-90"
                }`}
              />
            </button>
            {billingExpanded ? (
              <div id="dashboard-billing-subnav" className="pb-1">
                <Link
                  {...getRouteLinkProps("/dashboard/billing/credits")}
                  className={getSubLinkClasses("/dashboard/billing/credits")}
                >
                  {t("sidebar.credits")}
                </Link>
                <Link
                  {...getRouteLinkProps("/dashboard/billing")}
                  className={getSubLinkClasses("/dashboard/billing")}
                >
                  {t("sidebar.payments")}
                </Link>
              </div>
            ) : null}
            <Link
              {...getRouteLinkProps("/dashboard/audit")}
              className={getLinkClasses(["/dashboard/audit"], false)}
            >
              <AlertTriangle className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
              {t("sidebar.riskAudit")}
            </Link>
            <Link
              {...getRouteLinkProps("/dashboard/developer")}
              className={getLinkClasses(["/dashboard/developer"], false)}
            >
              <Terminal className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
              {t("sidebar.developerResources")}
            </Link>
          </nav>
        </div>

        {/* PROVIDER WORKSPACE */}
        <div className="mb-6">
          <h3 className="px-6 mb-2 text-[11px] font-bold tracking-widest text-gray-500 uppercase flex items-center gap-2">
            <Box className="w-3 h-3" />
            {t("sidebar.providerRole")}
          </h3>
          <nav className="flex flex-col gap-0.5">
            <Link
              {...getRouteLinkProps(providerConsoleRoute)}
              className={getLinkClasses(
                [providerConsoleRoute, `${providerRoot}/sell`],
                false
              )}
            >
              <LayoutGrid className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
              {t("sidebar.providerConsole")}
            </Link>
            <Link
              {...getRouteLinkProps(`${providerRoot}/secrets`)}
              className={getLinkClasses([`${providerRoot}/secrets`], false)}
            >
              <Key className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
              {t("sidebar.providerCredentials")}
            </Link>
            <Link
              {...getRouteLinkProps(`${providerRoot}/services`)}
              className={getLinkClasses([`${providerRoot}/services`], false)}
            >
              <Box className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
              {t("sidebar.myServices")}
              {serviceCount !== null && (
                <span
                  className={getBadgeClasses(
                    isRouteActive(`${providerRoot}/services`)
                  )}
                >
                  {serviceCount}
                </span>
              )}
            </Link>
            <Link
              {...getRouteLinkProps(`${providerRoot}/usage`)}
              className={getLinkClasses([`${providerRoot}/usage`], false)}
            >
              <AreaChart className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
              {t("sidebar.usageAnalytics")}
            </Link>
            <button
              type="button"
              className={getGroupTriggerClasses(settlementExpanded)}
              onClick={() => setSettlementExpanded((current) => !current)}
              aria-expanded={settlementExpanded}
              aria-controls="provider-settlement-subnav"
            >
              <Database className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
              {t("sidebar.settlement")}
              <ChevronDown
                className={`ml-auto h-4 w-4 text-white/38 transition-transform duration-200 ${
                  settlementExpanded ? "rotate-0 text-white/56" : "-rotate-90"
                }`}
              />
            </button>
            {settlementExpanded ? (
              <div id="provider-settlement-subnav" className="pb-1">
                <Link
                  href={providerWithdrawRoute}
                  prefetch={false}
                  className={getSubLinkClasses(providerWithdrawRoute)}
                  onClick={(event) => {
                    void handleWithdrawNavigation(event, providerWithdrawRoute);
                  }}
                >
                  {t("sidebar.withdraw")}
                </Link>
                <Link
                  href={providerWithdrawHistoryRoute}
                  prefetch={false}
                  className={getSubLinkClasses(providerWithdrawHistoryRoute)}
                  onClick={(event) => {
                    void handleWithdrawNavigation(
                      event,
                      providerWithdrawHistoryRoute
                    );
                  }}
                >
                  {t("sidebar.invocationRecords")}
                </Link>
              </div>
            ) : null}
            <div className="mt-4 pt-1">
              <button
                type="button"
                className={getGroupTriggerClasses(accountExpanded)}
                onClick={() => setAccountExpanded((current) => !current)}
                aria-expanded={accountExpanded}
                aria-controls="dashboard-account-subnav"
              >
                <CircleUserRound className="mr-3 h-4 w-4 text-white/44 transition-colors group-hover:text-white/66" />
                {t("sidebar.account")}
                <ChevronDown
                  className={`ml-auto h-4 w-4 text-white/38 transition-transform duration-200 ${
                    accountExpanded ? "rotate-0 text-white/56" : "-rotate-90"
                  }`}
                />
              </button>
              {accountExpanded ? (
                <div id="dashboard-account-subnav" className="pb-1">
                  <Link
                    {...getRouteLinkProps("/dashboard/account/settings")}
                    className={getSubLinkClasses("/dashboard/account/settings")}
                  >
                    <Settings className="mr-3 h-4 w-4 text-white/46" />
                    {t("sidebar.settings")}
                  </Link>
                  {isConnected || isSessionAuthenticated ? (
                    <button
                      type="button"
                      onClick={() => setLogoutConfirmOpen(true)}
                      className={getDangerSubButtonClasses()}
                    >
                      <LogOut className="mr-3 h-4 w-4" />
                      {t("sidebar.logout")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ml-10 mr-2 mt-1 flex w-[calc(100%-3rem)] items-center rounded-2xl px-4 py-2.5 text-[14px] font-medium text-white/70 transition-[background-color,color] hover:bg-white/[0.03] hover:text-white"
                      onClick={() => openConnectModal?.()}
                    >
                      <LogIn className="mr-3 h-4 w-4 text-white/46" />
                      {t("sidebar.login")}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          </nav>
        </div>
      </aside>
      <XDialog
        open={logoutConfirmOpen}
        ariaLabelledby="dashboard-logout-confirm-title"
        onDismiss={() => setLogoutConfirmOpen(false)}
      >
        <XDialogSurface className="max-w-md">
          <XDialogHeader>
            <XDialogHeaderCopy>
              <h2
                id="dashboard-logout-confirm-title"
                className="text-lg font-semibold tracking-[-0.02em] text-white"
              >
                {t("sidebar.logoutConfirmTitle")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/58">
                {t("sidebar.logoutConfirmDescription")}
              </p>
            </XDialogHeaderCopy>
          </XDialogHeader>
          <XDialogBody className="py-4">
            <div className="rounded-2xl border border-[#ff8f8f]/20 bg-[#2a1115]/50 p-4 text-sm leading-6 text-[#ffd1d1]">
              {address
                ? `${address.slice(0, 6)}...${address.slice(-4)}`
                : t("sidebar.account")}
            </div>
          </XDialogBody>
          <XDialogFooter>
            <button
              type="button"
              onClick={() => setLogoutConfirmOpen(false)}
              className="x-button-ghost x-modal-action x-modal-action-secondary text-sm font-medium"
            >
              {t("sidebar.logoutConfirmCancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                setLogoutConfirmOpen(false);
                void handleLogout();
              }}
              className="x-modal-action x-modal-action-primary bg-[#ff5d5d] text-sm font-bold text-black transition hover:bg-[#ff8f8f]"
            >
              {t("sidebar.logoutConfirmAction")}
            </button>
          </XDialogFooter>
        </XDialogSurface>
      </XDialog>
    </>
  );
}
