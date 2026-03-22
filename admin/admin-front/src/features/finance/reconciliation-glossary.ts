export type ReconciliationMetricGlossaryKey =
  | "platformIncome"
  | "absoluteDelta"
  | "signedDifference"
  | "chainVault"
  | "ledgerObligation";

export type ReconciliationQueueGlossaryKey =
  | "pendingApprovals"
  | "depositExceptions"
  | "pendingWithdrawals"
  | "auditAlerts";

type ReconciliationMetricGlossaryEntry = {
  label: string;
  meta: string;
  hint: string;
};

type ReconciliationQueueGlossaryEntry = {
  label: string;
  description: string;
};

const metricGlossary: Record<ReconciliationMetricGlossaryKey, ReconciliationMetricGlossaryEntry> = {
  platformIncome: {
    label: "Platform income",
    meta: "当前平台收入池余额。",
    hint: "平台手续费收入池余额，表示当前已经沉淀在平台账本内的收入。",
  },
  absoluteDelta: {
    label: "Absolute delta",
    meta: "首页哨兵 04 的真实后端值。",
    hint: "绝对偏差值，不区分正负方向，只回答账本和链上当前差了多少。",
  },
  signedDifference: {
    label: "Signed difference",
    meta: "按 chain vault - ledger obligation 计算。",
    hint: "带方向偏差，按 chain vault - ledger obligation 计算；负值代表 vault deficit，正值代表 vault surplus。",
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
};

const queueGlossary: Record<ReconciliationQueueGlossaryKey, ReconciliationQueueGlossaryEntry> = {
  pendingApprovals: {
    label: "Pending approvals",
    description: "仍待 review 或执行的审批任务，可能拖慢异常处置。",
  },
  depositExceptions: {
    label: "Deposit exceptions",
    description: "充值异常积压通常是对账偏差的第一关联信号。",
  },
  pendingWithdrawals: {
    label: "Pending withdrawals",
    description: "出账排队会影响 vault 余额波动和 operator 判断顺序。",
  },
  auditAlerts: {
    label: "Audit alerts",
    description: "若同时存在敏感操作告警，需提高对账异常处置优先级。",
  },
};

export function getReconciliationMetricGlossary(key: ReconciliationMetricGlossaryKey): ReconciliationMetricGlossaryEntry {
  return metricGlossary[key];
}

export function getReconciliationQueueGlossary(key: ReconciliationQueueGlossaryKey): ReconciliationQueueGlossaryEntry {
  return queueGlossary[key];
}