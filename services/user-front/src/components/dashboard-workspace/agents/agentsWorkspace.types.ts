import type { AgentCredentialRecord } from "@/utils/agentCredentialApi";

export type PendingDangerAction =
  | { type: "generate"; agent: AgentCredentialRecord }
  | { type: "revoke"; agent: AgentCredentialRecord }
  | { type: "regenerate"; agent: AgentCredentialRecord };