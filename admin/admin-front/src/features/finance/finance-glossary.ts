export type FinanceMetricGlossaryKey =
  | "platformIncome"
  | "absoluteDelta"
  | "signedDifference"
  | "treasuryAbsoluteDelta"
  | "treasurySignedDifference"
  | "chainVault"
  | "ledgerObligation"
  | "todayDeposit"
  | "todayCharge"
  | "todayInvocationCount"
  | "todayPlatformFeeEarned"
  | "todayProviderEarned"
  | "todayRefund"
  | "todayWithdrawal"
  | "pendingWithdrawals"
  | "pendingDeposits"
  | "ownerLiability"
  | "providerPayable"
  | "vaultLedgerDelta"
  | "refundableConsumerBalance"
  | "providerAvailableToWithdraw"
  | "providerLockedBalance"
  | "chainConfirmedNotLedgerConfirmed"
  | "depositP95SyncDelay"
  | "recentlyCompletedOutflows";

export type FinanceQueueGlossaryKey =
  | "pendingApprovals"
  | "depositExceptions"
  | "queuePendingWithdrawals"
  | "auditAlerts";

type FinanceMetricGlossaryEntry = {
  label: string;
  meta: string;
  hint: string;
};

type FinanceQueueGlossaryEntry = {
  label: string;
  description: string;
};

const metricGlossary: Record<FinanceMetricGlossaryKey, FinanceMetricGlossaryEntry> = {
  platformIncome: {
    label: "平台累计收入",
    meta: "当前平台已经确认的收入。",
    hint: "表示平台目前已经实际沉淀下来的收入金额。",
  },
  absoluteDelta: {
    label: "差异金额",
    meta: "当前看到的差异大小。",
    hint: "只看差了多少，不区分多还是少，适合先判断问题大不大。",
  },
  signedDifference: {
    label: "差异方向",
    meta: "用于判断是偏多还是偏少。",
    hint: "负值表示资金偏少，正值表示资金偏多。",
  },
  treasuryAbsoluteDelta: {
    label: "整体差异金额",
    meta: "平台整体账和资金的差异大小。",
    hint: "适合先看平台整体差了多少，若不为 0，建议进入对账详情查看原因。",
  },
  treasurySignedDifference: {
    label: "整体差异方向",
    meta: "平台整体资金是偏多还是偏少。",
    hint: "负值表示整体资金偏少，正值表示整体资金偏多。",
  },
  chainVault: {
    label: "当前资金余额",
    meta: "平台当前可看到的资金余额。",
    hint: "用来了解平台现在手上有多少资金可供覆盖业务需要。",
  },
  ledgerObligation: {
    label: "用户应付余额",
    meta: "平台目前对用户应承担的余额。",
    hint: "表示用户在平台内应当可以使用或取回的那部分资金。",
  },
  todayDeposit: {
    label: "今日充值",
    meta: "今天已确认到账的充值金额。",
    hint: "帮助了解今天有多少资金流入平台。",
  },
  todayCharge: {
    label: "今日消费",
    meta: "今天已经确认的消费金额。",
    hint: "帮助了解今天用户实际消耗了多少金额。",
  },
  todayInvocationCount: {
    label: "今日调用次数",
    meta: "今天产生计费的调用次数。",
    hint: "帮助判断今天的业务活跃度是否有变化。",
  },
  todayPlatformFeeEarned: {
    label: "今日平台收入",
    meta: "今天新增的平台收入。",
    hint: "帮助了解今天平台新赚了多少。",
  },
  todayProviderEarned: {
    label: "今日服务商收入",
    meta: "今天新增的服务商应收金额。",
    hint: "帮助了解今天服务商侧新增了多少应结算收入。",
  },
  todayRefund: {
    label: "今日退款",
    meta: "今天进入处理或已完成的退款金额。",
    hint: "帮助了解今天有多少资金退回给用户。",
  },
  todayWithdrawal: {
    label: "今日提现",
    meta: "今天进入处理或已完成的提现金额。",
    hint: "帮助了解今天有多少资金流出平台。",
  },
  pendingWithdrawals: {
    label: "待处理提现",
    meta: "当前还没处理完的提现单数量。",
    hint: "数量越高，说明当前出款处理压力越大。",
  },
  pendingDeposits: {
    label: "待处理充值",
    meta: "当前还在确认或补录中的充值单数量。",
    hint: "如果这里较高，通常说明充值处理中积压较多。",
  },
  ownerLiability: {
    label: "用户应付金额",
    meta: "平台当前对用户应承担的金额。",
    hint: "这部分资金需要优先保证，关系到用户可用余额和退款处理。",
  },
  providerPayable: {
    label: "服务商待结算金额",
    meta: "平台当前还需要结算给服务商的金额。",
    hint: "帮助判断后续结算和提现压力。",
  },
  vaultLedgerDelta: {
    label: "资金差异金额",
    meta: "当前账和资金之间的差异大小。",
    hint: "这是页面里最值得先关注的风险信号之一。",
  },
  refundableConsumerBalance: {
    label: "可退款金额",
    meta: "当前可用于退款处理的用户金额。",
    hint: "帮助判断如果要处理退款，目前还有多少余额可用。",
  },
  providerAvailableToWithdraw: {
    label: "服务商可提现金额",
    meta: "服务商当前可以申请提现的金额。",
    hint: "帮助判断服务商侧是否存在集中提现压力。",
  },
  providerLockedBalance: {
    label: "服务商处理中金额",
    meta: "服务商当前已在处理中或暂时锁定的金额。",
    hint: "帮助判断还有多少金额正在走提现或冻结流程。",
  },
  chainConfirmedNotLedgerConfirmed: {
    label: "Chain confirmed, not ledger confirmed",
    meta: "链上已确认但账本未入账。",
    hint: "链上 receipt 已确认，但平台账本还未完成确认入账的充值数量或金额。当前若未接入后端投影，应明确标记为待接线。",
  },
  depositP95SyncDelay: {
    label: "Deposit P95 sync delay",
    meta: "充值同步 P95 时延。",
    hint: "充值从链上确认到平台账本完成入账的 P95 时延，用来观察 indexer / backfill 压力。当前若未接入后端投影，应明确标记为待接线。",
  },
  recentlyCompletedOutflows: {
    label: "Recently completed outflows",
    meta: "最近完成的出金。",
    hint: "最近一个统计窗口内已经完成结转的 refund / withdrawal 数量或金额，用来辅助判断链上余额下降是否合理。当前若未接入后端投影，应明确标记为待接线。",
  },
};

const queueGlossary: Record<FinanceQueueGlossaryKey, FinanceQueueGlossaryEntry> = {
  pendingApprovals: {
    label: "Pending approvals",
    description: "仍待 review 或执行的审批任务，可能拖慢异常处置。",
  },
  depositExceptions: {
    label: "Deposit exceptions",
    description: "充值异常积压通常是对账偏差的第一关联信号。",
  },
  queuePendingWithdrawals: {
    label: "Pending withdrawals",
    description: "出账排队会影响 vault 余额波动和 operator 判断顺序。",
  },
  auditAlerts: {
    label: "Audit alerts",
    description: "若同时存在敏感操作告警，需提高对账异常处置优先级。",
  },
};

export function getFinanceMetricGlossary(key: FinanceMetricGlossaryKey): FinanceMetricGlossaryEntry {
  return metricGlossary[key];
}

export function getFinanceQueueGlossary(key: FinanceQueueGlossaryKey): FinanceQueueGlossaryEntry {
  return queueGlossary[key];
}