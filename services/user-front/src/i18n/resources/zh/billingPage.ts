import type { I18nMessages } from "@/i18n/schema";

const billingPage: I18nMessages["billingPage"] = {
  title: "Payments",
  description: "查看你账户下全部账单交易与支付历史",
  fromLabel: "FROM",
  toLabel: "TO",
  resetRange: "重置为最近 3 个月",
  tableTransactionId: "Transaction ID",
  tableStatus: "状态",
  tablePaymentMethod: "Payment Method",
  tableAmount: "Amount",
  tableDate: "Date",
  tableInvoice: "Invoice",
  statusPending: "处理中",
  statusSucceeded: "已完成",
  statusFailed: "失败",
  loading: "正在加载 Payments...",
  empty: "当前筛选范围内没有支付记录。",
};

export default billingPage;
