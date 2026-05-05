import type { I18nMessages } from "@/i18n/schema";

const billingPage: I18nMessages["billingPage"] = {
  title: "Payments",
  description: "查看你账户下全部账单交易与支付历史",
  fromLabel: "开始日期",
  toLabel: "结束日期",
  resetRange: "重置为最近 3 个月",
  tableTransactionId: "交易 ID",
  tableStatus: "状态",
  tableType: "类型",
  tablePaymentMethod: "支付方式",
  tableAmount: "金额",
  tableDate: "日期",
  tableInvoice: "凭证",
  actionDeposit: "充值",
  actionWithdraw: "提现",
  actionRefund: "退款",
  actionClaim: "领取",
  paymentMethodWallet: "钱包",
  paymentMethodVoucher: "Voucher",
  transactionHashLabel: "交易哈希",
  openTransactionExplorer: "打开链上浏览器",
  statusPending: "处理中",
  statusPendingSyncing: "同步中",
  statusWithdrawPending: "提现处理中",
  statusSucceeded: "已完成",
  statusFailed: "失败",
  depositStatusHint:
    "Completed 表示 Gateway 已经入账为可消费余额，不只是链上交易确认。",
  networkFeeHint:
    "链上网络费由你的钱包以原生代币支付，可通过区块浏览器查看具体 gas 明细。",
  historyLimitHint: "当前展示最近 {{count}} 条记录，如需完整导出请联系支持。",
  datePickerLocale: "zh-CN",
  datePickerPreviousMonth: "上个月",
  datePickerNextMonth: "下个月",
  datePickerToday: "今天",
  loading: "正在加载 Payments...",
  empty: "当前筛选范围内没有支付记录。",
};

export default billingPage;
