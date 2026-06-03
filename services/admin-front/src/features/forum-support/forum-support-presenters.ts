import type {
  ForumResponseTask,
  ForumTopicContext,
} from "@/services/admin-api";

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

export type ForumTopicMetrics = {
  open: number;
  awaitingAdmin: number;
  closed: number;
  pinned: number;
};

export const responseTaskStatusLabels: Record<string, string> = {
  awaiting_response: "等待回复",
  draft_ready: "草稿就绪",
  responded: "已回复",
  ignored: "已忽略",
  closed: "已关闭",
};

export const topicStatusLabels: Record<string, string> = {
  open: "开放",
  awaiting_admin: "待官方回复",
  answered: "已官方回复",
  resolved: "已解决",
  closed: "已关闭",
  hidden: "已隐藏",
  locked: "已锁定",
};

export const classificationLabels: Record<string, string> = {
  question: "问题咨询",
  bug: "Bug",
  feature_request: "功能需求",
  docs_issue: "文档问题",
  needs_more_info: "需要补充信息",
  spam: "噪音",
};

export function priorityTone(
  priority: string
): "green" | "orange" | "red" | "gray" {
  if (priority === "critical" || priority === "high") {
    return "red";
  }
  if (priority === "normal") {
    return "orange";
  }
  return "gray";
}

export function responseTaskTone(
  status: string
): "green" | "orange" | "red" | "gray" {
  if (status === "draft_ready") {
    return "green";
  }
  if (status === "awaiting_response") {
    return "orange";
  }
  if (status === "ignored") {
    return "gray";
  }
  return "green";
}

export function topicTone(status: string): "green" | "orange" | "red" | "gray" {
  if (status === "closed" || status === "hidden" || status === "locked") {
    return "gray";
  }
  if (status === "awaiting_admin") {
    return "orange";
  }
  return "green";
}

export function forumSupportStatusForMode(
  mode: ForumSupportStatusMode
): string {
  return mode === "history"
    ? FORUM_SUPPORT_HISTORY_STATUS
    : FORUM_SUPPORT_ACTIVE_STATUS;
}

export function forumSupportModeFromStatus(
  status: string
): ForumSupportStatusMode {
  return status.includes("responded") ? "history" : "active";
}

export function isForumResponseTaskActionable(
  task: ForumResponseTask | null
): boolean {
  return task?.status === "awaiting_response" || task?.status === "draft_ready";
}

export function buildForumSupportMetrics(
  items: ForumResponseTask[]
): ForumSupportMetrics {
  return {
    total: items.length,
    draftReady: items.filter((item) => item.status === "draft_ready").length,
    bugs: items.filter((item) => item.classification === "bug").length,
    highRisk: items.filter(
      (item) => item.priority === "high" || item.priority === "critical"
    ).length,
  };
}

export function buildForumTopicMetrics(
  items: ForumTopicContext[]
): ForumTopicMetrics {
  return {
    open: items.filter(
      (item) => item.status !== "closed" && item.status !== "hidden"
    ).length,
    awaitingAdmin: items.filter((item) => item.status === "awaiting_admin")
      .length,
    closed: items.filter((item) => item.status === "closed").length,
    pinned: items.filter((item) => item.pinned).length,
  };
}

export function responseTaskTitle(task: ForumResponseTask): string {
  return task.topic?.title ?? task.topicId;
}

export function responseTaskMeta(task: ForumResponseTask): string {
  return [
    task.topic?.category ?? "Forum",
    task.topic?.authorDisplay ?? "unknown",
  ].join(" · ");
}

export function responseTaskContextTitle(
  task: ForumResponseTask | null
): string {
  return task ? responseTaskTitle(task) : "选择一个帖子";
}

export function responseTaskContextStamp(
  task: ForumResponseTask | null
): string {
  return task?.responseTaskId ?? "no selection";
}

export function responseTaskClassificationLabel(
  task: ForumResponseTask
): string {
  if (!task.classification) {
    return "未分类";
  }
  return classificationLabels[task.classification] ?? task.classification;
}

export function responseTaskStatusLabel(task: ForumResponseTask): string {
  return responseTaskStatusLabels[task.status] ?? task.status;
}

export function responseTaskContextMeta(task: ForumResponseTask): string {
  return [
    task.topic?.authorDisplay ?? "unknown",
    task.topic?.category ?? "Forum",
  ].join(" · ");
}

export function responseTaskBody(task: ForumResponseTask): string {
  return task.topic?.body ?? "";
}

export function buildForumGrowingLinks(
  task: ForumResponseTask | null
): ForumGrowingLink[] {
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

export function canSendForumReply(
  task: ForumResponseTask | null,
  replyBody: string,
  busy: boolean
): boolean {
  return (
    isForumResponseTaskActionable(task) && replyBody.trim().length >= 2 && !busy
  );
}

export function canIgnoreForumTask(
  task: ForumResponseTask | null,
  ignoreReason: string,
  busy: boolean
): boolean {
  return (
    isForumResponseTaskActionable(task) &&
    ignoreReason.trim().length >= 3 &&
    !busy
  );
}
