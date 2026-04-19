import type { I18nMessages } from "@/i18n/schema";

const feedback: I18nMessages["feedback"] = {
  floatingButton: "反馈",
  docsHelpfulTitle: "这篇文档对你有帮助吗？",
  helpful: "有帮助",
  notHelpful: "没帮助",
  reportIssue: "反馈问题",
  drawerTitle: "提交反馈",
  drawerDescription: "我们会自动附带当前路由和产品上下文，方便 support 更快追踪问题。",
  categoryLabel: "类型",
  messageLabel: "需要我们知道什么？",
  messagePlaceholder: "告诉我们哪里坏了、哪里困惑，或者你原本期待发生什么。",
  submit: "提交反馈",
  submitting: "提交中...",
  submittedTitle: "反馈已收到",
  submittedDescription: "如果你后续联系 support 或论坛讨论，可以引用这个编号。",
  feedbackIdLabel: "反馈编号",
  fallbackTitle: "反馈接口不可用",
  fallbackDescription: "反馈通道离线时，请使用 support 邮箱或 portal。",
};

export default feedback;
