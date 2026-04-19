import type { ForumResponseTask } from "@/services/admin-api";

export const FORUM_SUPPORT_ACTIVE_STATUS = "awaiting_response,draft_ready";
export const FORUM_SUPPORT_HISTORY_STATUS = "responded,ignored,closed";

export type ForumSupportStatusMode = "active" | "history";

export type ForumSupportMetrics = {
  total: number;
  draftReady: number;
  bugs: number;
  highRisk: number;
};

export type ForumGrowingLink = {
  key: "candidate" | "requirement" | "workflow";
  label: string;
  href: string;
};

export function forumSupportStatusForMode(mode: ForumSupportStatusMode): string {
  return mode === "history" ? FORUM_SUPPORT_HISTORY_STATUS : FORUM_SUPPORT_ACTIVE_STATUS;
}

export function forumSupportModeFromStatus(status: string): ForumSupportStatusMode {
  return status.includes("responded") ? "history" : "active";
}

export function isForumResponseTaskActionable(task: ForumResponseTask | null): boolean {
  return task?.status === "awaiting_response" || task?.status === "draft_ready";
}

export function buildForumSupportMetrics(items: ForumResponseTask[]): ForumSupportMetrics {
  return {
    total: items.length,
    draftReady: items.filter((item) => item.status === "draft_ready").length,
    bugs: items.filter((item) => item.classification === "bug").length,
    highRisk: items.filter((item) => item.priority === "high" || item.priority === "critical").length,
  };
}

export function buildForumGrowingLinks(task: ForumResponseTask | null): ForumGrowingLink[] {
  if (!task) {
    return [];
  }

  const links: ForumGrowingLink[] = [];
  if (task.linkedRequirementCandidateId) {
    links.push({
      key: "candidate",
      label: "打开 Growing Candidate",
      href: `http://localhost:9700/planning?candidate=${task.linkedRequirementCandidateId}`,
    });
  }
  if (task.linkedRequirementId) {
    links.push({
      key: "requirement",
      label: "打开 Requirement",
      href: `http://localhost:9700/requirements/${task.linkedRequirementId}`,
    });
  }
  if (task.linkedWorkflowRunId) {
    links.push({
      key: "workflow",
      label: "打开 Workflow",
      href: `http://localhost:9700/workflows/${task.linkedWorkflowRunId}`,
    });
  }
  return links;
}

export function canSendForumReply(task: ForumResponseTask | null, replyBody: string, busy: boolean): boolean {
  return isForumResponseTaskActionable(task) && replyBody.trim().length >= 2 && !busy;
}

export function canIgnoreForumTask(task: ForumResponseTask | null, ignoreReason: string, busy: boolean): boolean {
  return isForumResponseTaskActionable(task) && ignoreReason.trim().length >= 3 && !busy;
}
