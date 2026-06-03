"use client";

import { useCallback, useMemo, useState } from "react";

import {
  listForumResponseTasks,
  type ForumResponseTask,
} from "@/services/admin-api";

import {
  buildForumGrowingLinks,
  buildForumSupportMetrics,
  forumSupportModeFromStatus,
  forumSupportStatusForMode,
  isForumResponseTaskActionable,
  type ForumSupportStatusMode,
} from "./forum-support-presenters";
import type { ForumSupportWorkbenchView } from "./forum-support-types";

export function useForumResponseTasks({
  token,
  view,
  setError,
}: Readonly<{
  token: string | null;
  view: ForumSupportWorkbenchView;
  setError: (value: string | null) => void;
}>) {
  const [tasks, setTasks] = useState<ForumResponseTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const taskMode: ForumSupportStatusMode =
    view === "history" ? "history" : "active";
  const taskStatus = forumSupportStatusForMode(taskMode);

  const refreshTasks = useCallback(
    async (activeToken = token) => {
      if (!activeToken) {
        return;
      }
      try {
        const response = await listForumResponseTasks(activeToken, {
          status: taskStatus,
          pageSize: 50,
        });
        setTasks(response.items);
        setSelectedTaskId((current) =>
          resolveSelectedTaskId(response.items, current)
        );
        setError(null);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "加载社区回复队列失败"
        );
      }
    },
    [setError, taskStatus, token]
  );

  const selectedTask = useMemo(
    () =>
      tasks.find((item) => item.responseTaskId === selectedTaskId) ??
      tasks[0] ??
      null,
    [tasks, selectedTaskId]
  );

  return {
    tasks,
    selectedTask,
    selectedTaskId,
    setSelectedTaskId,
    selectedTaskActionable: isForumResponseTaskActionable(selectedTask),
    isHistoryMode: forumSupportModeFromStatus(taskStatus) === "history",
    queueMetrics: buildForumSupportMetrics(tasks),
    growingLinks: buildForumGrowingLinks(selectedTask),
    refreshTasks,
  };
}

function resolveSelectedTaskId(
  tasks: ForumResponseTask[],
  current: string | null
) {
  if (tasks.length === 0) {
    return null;
  }
  if (tasks.some((item) => item.responseTaskId === current)) {
    return current;
  }
  return tasks[0].responseTaskId;
}
