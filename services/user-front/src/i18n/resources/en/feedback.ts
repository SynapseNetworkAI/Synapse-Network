import type { I18nMessages } from "@/i18n/schema";

const feedback: I18nMessages["feedback"] = {
  floatingButton: "Feedback",
  docsHelpfulTitle: "Was this page helpful?",
  helpful: "Helpful",
  notHelpful: "Not helpful",
  reportIssue: "Report issue",
  drawerTitle: "Send feedback",
  drawerDescription: "We attach the current route and product context so support can trace the issue faster.",
  categoryLabel: "Category",
  messageLabel: "What should we know?",
  messagePlaceholder: "Tell us what broke, what was confusing, or what you expected to happen.",
  submit: "Submit feedback",
  submitting: "Submitting...",
  submittedTitle: "Feedback received",
  submittedDescription: "Reference this id if you follow up in support or the forum.",
  feedbackIdLabel: "Feedback ID",
  fallbackTitle: "Feedback API unavailable",
  fallbackDescription: "Use support email or portal while the feedback channel is offline.",
};

export default feedback;
