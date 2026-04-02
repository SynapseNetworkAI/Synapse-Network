import type { I18nMessages } from "@/i18n/schema";

const providerUsagePage: I18nMessages["providerUsagePage"] = {
  title: "Provider Revenue Analytics",
  description: "Revenue and call trends from deduplicated settlement records.",
  refreshing: "Refreshing...",
  refreshData: "Refresh Data",
  metricNetEarnings: "Net Earnings",
  metricGrossEarnings: "Gross Earnings",
  metricProtocolFee: "Protocol Fee",
  metricRoutingTax: "Routing Tax",
  netEarningsTrend: "Net Earnings Trend (7D)",
  callVolumeTrend: "Call Volume Trend (7D)",
  topServicesTitle: "Top Services by Calls",
  tableServiceId: "Service ID",
  tableTotalCalls: "Total Calls",
  tableGross: "Gross",
  tableProtocolFee: "Protocol Fee",
  tableNet: "Net",
  empty: "No provider revenue metrics available yet.",
};

export default providerUsagePage;