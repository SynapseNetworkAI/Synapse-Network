export const forbiddenRawStrings = [
  "503",
  "Gateway cannot",
  "Gateway ",
  " RPC",
  "503:",
  "{'code':",
  '"code":',
  "HTTPException",
  "Unable to prepare a withdrawal ticket right now:",
  "RPC Error",
  "Internal error",
  "User denied message signature",
  "Provider upstream failed",
  "CHAIN_RPC",
  "PROVIDER_",
  "WITHDRAW_",
  "WITHDRAW_TICKET",
  "backend",
  "ledger",
  "ticket",
  "request ID",
  "Request ID",
  "dedupe",
  "Deduplicated",
];

export const expectedCopy = {
  en: {
    creditsRpc:
      "The withdrawal network is temporarily unavailable. Please retry in a moment.",
    creditsContractMissing:
      "Withdrawals are not available in this environment yet.",
    creditsMatured:
      "These funds are not mature yet. Consumer withdrawals require the T+7 matured funds window.",
    creditsUnknown:
      "Unable to prepare the withdrawal right now. Please retry in a moment.",
    providerRpc:
      "The withdrawal network is temporarily unavailable. Please retry in a moment.",
    providerMatured:
      "Provider earnings are still in the T+7 maturity window. Only matured receivables can be withdrawn; newly earned receivables still appear in balance.",
    providerMinimum: "Minimum provider withdrawal amount is 10.00 USDC.",
    providerPending:
      "A provider withdrawal is already pending. Complete it or wait for review before creating a new one.",
    providerRejected:
      "Withdrawal was cancelled in wallet. No gas fee was spent and no funds were moved.",
    providerUnknown:
      "Unable to prepare this withdrawal. Please retry in a moment.",
    providerHistoryReason: "Withdrawal queued for manual security review.",
    providerHistoryPage: "Invocation Records",
    notificationTitle: "Withdrawal security review",
    notificationBody:
      "Your withdrawal is under security review. We will update the status when review is complete.",
    serviceList: "Failed to load services",
    serviceDeploy: "Failed to create service.",
    credentialRevoke: "Failed to revoke credential",
  },
  zh: {
    creditsRpc: "提现网络服务暂时不可用，请稍后重试。",
    creditsContractMissing: "当前环境暂不支持提现。",
    creditsMatured: "这笔资金尚未成熟。Consumer 提现需要经过 T+7 资金成熟期。",
    creditsUnknown: "暂时无法准备提现，请稍后重试。",
    providerRpc: "提现网络服务暂时不可用，请稍后重试。",
    providerMatured:
      "当前收益尚未达到 T+7 成熟期。只有已成熟应收可以提现；新产生的应收仍会显示在余额中。",
    providerMinimum: "Provider 最小提现金额为 10.00 USDC。",
    providerPending:
      "当前已有一笔 Provider 提现待处理，请完成或等待审核后再创建新的提现。",
    providerRejected:
      "钱包里已取消本次提现。没有消耗 gas，也没有发生资金移动。",
    providerUnknown: "暂时无法准备这笔提现，请稍后重试。",
    providerHistoryReason: "提现已进入人工安全审核队列。",
    providerHistoryPage: "调用记录",
    notificationTitle: "提现安全审核",
    notificationBody: "提现已进入安全审核。审核完成后，我们会更新状态。",
    serviceList: "加载服务失败",
    serviceDeploy: "创建服务失败。",
    credentialRevoke: "撤销凭据失败",
  },
};
