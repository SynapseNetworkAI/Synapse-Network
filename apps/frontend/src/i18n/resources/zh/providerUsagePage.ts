import type { I18nMessages } from "@/i18n/schema";

const providerUsagePage: I18nMessages["providerUsagePage"] = {
  title: "Provider 收益分析",
  description: "基于去重后的 settlement records 观察收益和调用趋势。",
  refreshing: "刷新中...",
  refreshData: "刷新数据",
  metricNetEarnings: "净收益",
  metricGrossEarnings: "总收益",
  metricProtocolFee: "协议费",
  metricRoutingTax: "路由税",
  netEarningsTrend: "净收益趋势（7 天）",
  callVolumeTrend: "调用量趋势（7 天）",
  topServicesTitle: "按调用量排序的服务",
  tableServiceId: "服务 ID",
  tableTotalCalls: "总调用数",
  tableGross: "总额",
  tableProtocolFee: "协议费",
  tableNet: "净额",
  empty: "暂时还没有 provider 收益指标。",
};

export default providerUsagePage;