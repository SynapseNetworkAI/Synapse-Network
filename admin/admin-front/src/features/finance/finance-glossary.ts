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
    label: "Platform income",
    meta: "当前平台收入池余额。",
    hint: "平台手续费收入池余额，表示当前已经沉淀在平台账本内的收入。",
  },
  absoluteDelta: {
    label: "Absolute delta",
    meta: "首页哨兵 04 的真实后端值。",
    hint: "绝对偏差值，不区分正负方向，只回答买家侧账本义务和链上当前差了多少。用户发生消费后，这个值可以非 0，需结合 Treasury absolute delta 一起判断是否异常。",
  },
  signedDifference: {
    label: "Signed difference",
    meta: "按 chain vault - ledger obligation 计算。",
    hint: "带方向偏差，按 chain vault - ledger obligation 计算；负值代表 vault deficit，正值代表 vault surplus。",
  },
  treasuryAbsoluteDelta: {
    label: "Treasury absolute delta",
    meta: "全局总账绝对偏差。",
    hint: "按 chain vault 和 owner liability + provider payable + platform income 的总账差值计算；为 0 通常表示平台总账已经对齐。",
  },
  treasurySignedDifference: {
    label: "Treasury signed difference",
    meta: "全局总账带方向偏差。",
    hint: "按 chain vault - (owner liability + provider payable + platform income) 计算；负值代表 treasury deficit，正值代表 treasury surplus。",
  },
  chainVault: {
    label: "Chain vault",
    meta: "链上 router / vault 当前 USDC 余额。",
    hint: "链上 router 或 vault 当前可观测到的 USDC 实际余额。",
  },
  ledgerObligation: {
    label: "Ledger obligation",
    meta: "平台账本对 owner 的当前义务。",
    hint: "平台账本对 owner 的当前义务总额，也就是理论上应由 vault 覆盖的负债。",
  },
  todayDeposit: {
    label: "Today deposit",
    meta: "当日充值读模型。",
    hint: "当前统计窗口内已确认进入系统的充值总额，用来观察入金节奏和补账压力。",
  },
  todayCharge: {
    label: "Today charge",
    meta: "当日网关扣费。",
    hint: "当前统计窗口内网关已计量确认的 usage 扣费金额，反映 agent 调用带来的实际消费。",
  },
  todayInvocationCount: {
    label: "Today invocation count",
    meta: "当日计费调用次数。",
    hint: "当前统计窗口内成功进入计费链路的调用次数，用来判断活跃度和收入规模是否同步变化。",
  },
  todayPlatformFeeEarned: {
    label: "Today platform fee earned",
    meta: "当日平台新增手续费收入。",
    hint: "当前统计窗口内新增记入平台收入池的手续费金额，用来观察今天新增商业结果。",
  },
  todayProviderEarned: {
    label: "Today provider earned",
    meta: "当日 Provider 新增收入。",
    hint: "当前统计窗口内新增记入 Provider payable 的收入金额，用来判断供给侧结算和提现压力。",
  },
  todayRefund: {
    label: "Today refund",
    meta: "当日退款流量。",
    hint: "当前统计窗口内已经进入退款审批或完成退款结转的金额，用来观察逆向资金流。",
  },
  todayWithdrawal: {
    label: "Today withdrawal",
    meta: "当日提现出账。",
    hint: "当前统计窗口内已经完成或进入结转流程的提现金额，反映资金流出压力。",
  },
  pendingWithdrawals: {
    label: "Pending withdrawals",
    meta: "等待 reviewer 决策。",
    hint: "当前仍在审核或排队执行中的提现单数量，越高表示 operator 出账压力越大。",
  },
  pendingDeposits: {
    label: "Pending deposits",
    meta: "待补账充值单。",
    hint: "当前仍在确认、补账或回放中的充值单数量，通常和对账偏差、回放延迟直接相关。",
  },
  ownerLiability: {
    label: "Owner liability",
    meta: "买家侧应付池。",
    hint: "平台账本对 owner 的应付总额，是 vault 资金应该优先覆盖的核心负债面。",
  },
  providerPayable: {
    label: "Provider payable",
    meta: "待结算给 provider。",
    hint: "平台当前已确认、但尚未对 provider 完成清算的应付池余额。",
  },
  vaultLedgerDelta: {
    label: "Absolute delta",
    meta: "账本与金库偏差。",
    hint: "账本义务与链上 vault 余额之间的绝对偏差，是 finance operator 的第一优先级风险信号。",
  },
  refundableConsumerBalance: {
    label: "Refundable consumer balance",
    meta: "可发起退款的买家侧余额。",
    hint: "在 refund 风控、状态机和冻结规则约束下，可供用户实际发起退款的消费侧余额。当前若未接入后端投影，应明确标记为待接线。",
  },
  providerAvailableToWithdraw: {
    label: "Provider available to withdraw",
    meta: "Provider 当前可提现余额。",
    hint: "Provider 收益桶中当前可直接发起提现申请的 available balance。当前若未接入后端投影，应明确标记为待接线。",
  },
  providerLockedBalance: {
    label: "Provider locked balance",
    meta: "Provider 当前锁仓余额。",
    hint: "Provider 提现流程里已经进入 pending 或 frozen 的锁仓金额，用来判断出账队列压力。当前若未接入后端投影，应明确标记为待接线。",
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