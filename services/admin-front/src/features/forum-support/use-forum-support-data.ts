"use client";

import { useEffect, useState } from "react";

import type { ForumSupportWorkbenchView } from "./forum-support-types";
import { useForumResponseTasks } from "./use-forum-response-tasks";
import { useForumTopics } from "./use-forum-topics";

export function useForumSupportData(token: string | null) {
  const [view, setView] = useState<ForumSupportWorkbenchView>("topics");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const responseTasks = useForumResponseTasks({ token, view, setError });
  const topics = useForumTopics({ token, view, setError });

  useForumSupportBootstrap({
    token,
    view,
    refreshTasks: responseTasks.refreshTasks,
    refreshTopics: topics.refreshTopics,
  });

  return {
    view,
    setView,
    error,
    setError,
    notice,
    setNotice,
    ...responseTasks,
    ...topics,
  };
}

function useForumSupportBootstrap({
  token,
  view,
  refreshTasks,
  refreshTopics,
}: Readonly<{
  token: string | null;
  view: ForumSupportWorkbenchView;
  refreshTasks: (activeToken?: string | null) => Promise<void>;
  refreshTopics: (activeToken?: string | null) => Promise<void>;
}>) {
  useEffect(() => {
    if (!token) {
      return;
    }
    if (view === "topics") {
      void refreshTopics(token);
      void refreshTasks(token);
      return;
    }
    void refreshTasks(token);
  }, [token, view, refreshTopics, refreshTasks]);
}
