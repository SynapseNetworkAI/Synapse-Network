import type { I18nMessages } from "@/i18n/schema";
import aboutPage from "@/i18n/resources/en/aboutPage";
import agentsPage from "@/i18n/resources/en/agentsPage";
import auditPage from "@/i18n/resources/en/auditPage";
import billingPage from "@/i18n/resources/en/billingPage";
import blogPage from "@/i18n/resources/en/blogPage";
import discoveryPage from "@/i18n/resources/en/discoveryPage";
import home from "@/i18n/resources/en/home";
import invocationsPage from "@/i18n/resources/en/invocationsPage";
import marketplacePage from "@/i18n/resources/en/marketplacePage";
import overviewPage from "@/i18n/resources/en/overviewPage";
import providerSettlements from "@/i18n/resources/en/providerSettlements";
import shared from "@/i18n/resources/en/shared";

const en: I18nMessages = {
  ...shared,
  overviewPage,
  agentsPage,
  home,
  marketplacePage,
  discoveryPage,
  invocationsPage,
  billingPage,
  auditPage,
  providerSettlements,
  blogPage,
  aboutPage,
};

export default en;
