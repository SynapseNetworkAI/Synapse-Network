import type { I18nMessages } from "@/i18n/schema";

const feedback: I18nMessages["feedback"] = {
  floatingButton: "反馈",
  docsHelpfulTitle: "这篇文档对你有帮助吗？",
  helpful: "有帮助",
  notHelpful: "没帮助",
  reportIssue: "反馈问题",
  drawerTitle: "提交反馈",
  drawerDescription:
    "我们会自动附带当前路由和产品上下文，方便 support 更快追踪问题。",
  categoryLabel: "类型",
  messageLabel: "需要我们知道什么？",
  messagePlaceholder: "告诉我们哪里坏了、哪里困惑，或者你原本期待发生什么。",
  close: "关闭反馈",
  submitFailed: "提交反馈失败",
  categoryProductFeedback: "产品反馈",
  categoryBugReport: "Bug 报告",
  categoryDocsIssue: "文档问题",
  categoryBillingSupport: "计费支持",
  categoryProviderServices: "Provider 服务",
  submit: "提交反馈",
  submitting: "提交中...",
  submittedTitle: "反馈已收到",
  submittedDescription: "如果你后续联系 support 或论坛讨论，可以引用这个编号。",
  feedbackIdLabel: "反馈编号",
  fallbackTitle: "反馈接口不可用",
  fallbackDescription: "反馈通道离线时，请使用 support 邮箱或 portal。",
  routeLabel: "路由",
  contextRedacted: "上下文：提交前会脱敏",
  contactSupport: "联系支持",
};

export default feedback;
