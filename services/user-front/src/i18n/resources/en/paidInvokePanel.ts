import type { I18nMessages } from "@/i18n/schema";

const paidInvokePanel: I18nMessages["paidInvokePanel"] = {
  missingConfig: "Please complete endpoint, service ID, and pricing first.",
  inactiveService: "Service is inactive. Switch to active before testing.",
  completed: "Paid invoke completed.",
  failed: "Invoke failed",
  txHash: "Tx Hash",
  attempts: "Attempts",
  testPrompt: "Test Prompt",
  processing: "Processing...",
  payAndInvoke: "Pay & Invoke Now",
  unavailableHint:
    "Endpoint / Service ID / pricing is missing, or the service is inactive.",
  defaultTitle: "Live Test (Pay + Invoke)",
  collapse: "Collapse",
  expand: "Expand",
  collapsedHint: "Click Expand to run a paid service invocation test.",
  defaultPrompt: "hello from agent",
};

export default paidInvokePanel;
