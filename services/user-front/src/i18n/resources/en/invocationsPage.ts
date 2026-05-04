import type { I18nMessages } from "@/i18n/schema";

const invocationsPage: I18nMessages["invocationsPage"] = {
  loadFailed: "Failed to load invocation logs",
  statusFailed: "Failed",
  statusSucceeded: "Succeeded",
  statusAccepted: "Accepted",
  statusRefunded: "Refunded",
  statusAll: "All status",
  title: "Invocations",
  description:
    "Owner-scoped invocation ledger backed by the real gateway billing stream.",
  supportTitle: "Need a refund or billing review?",
  supportDescription:
    "Refund and dispute requests are handled by support so the team can review invocation receipts, service behavior, and account context before taking action.",
  supportAction: "Contact Support",
  supportSubject: "Synapse invocation refund request",
  searchPlaceholder: "Search invocation, service, or wallet",
  apply: "Apply",
  reset: "Reset",
  summaryRowsInPage: "Rows In Page",
  summarySucceededOrAccepted: "Succeeded Or Accepted",
  summaryFailedInPage: "Failed In Page",
  tableInvocationId: "Invocation ID",
  tableService: "Service",
  tableAgent: "Agent",
  tableCostUsdc: "Cost (USDC)",
  tableLatency: "Latency",
  tableStatus: "Status",
  tableTimestamp: "Timestamp",
  loading: "Loading invocation logs...",
  empty: "No invocation logs found for the current filters.",
  unknownService: "Unknown service",
  showingRange: "Showing {{start}}-{{end}} of {{total}}",
  prev: "Prev",
  next: "Next",
  footer:
    "This page is paginated against the real owner-scoped gateway usage stream, ordered by newest billing events first.",
  relativeSecondsAgo: "{{count}}s ago",
  relativeMinutesAgo: "{{count}}m ago",
  relativeHoursAgo: "{{count}}h ago",
  relativeDaysAgo: "{{count}}d ago",
};

export default invocationsPage;
