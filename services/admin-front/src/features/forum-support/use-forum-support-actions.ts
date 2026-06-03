"use client";

import { useEffect, useState } from "react";

import {
  closeForumTopic,
  ignoreForumResponseTask,
  pinForumTopic,
  reopenForumTopic,
  sendForumResponseReply,
  unpinForumTopic,
} from "@/services/admin-api";

import { responseTaskStatusLabels } from "./forum-support-presenters";
import type { useForumSupportData } from "./use-forum-support-data";

export function useForumSupportActions(
  token: string | null,
  data: ReturnType<typeof useForumSupportData>
) {
  const [replyBody, setReplyBody] = useState("");
  const [ignoreReason, setIgnoreReason] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReplyBody(data.selectedTask?.suggestedReply ?? "");
    setIgnoreReason("");
  }, [data.selectedTask?.responseTaskId, data.selectedTask?.suggestedReply]);

  async function sendReply() {
    if (!token || !data.selectedTask || !data.selectedTaskActionable) {
      return;
    }
    await runBusyAction(
      setBusy,
      data,
      async () => {
        const updated = await sendForumResponseReply(
          token,
          data.selectedTask!.responseTaskId,
          {
            body: replyBody,
            authorDisplay: "Synapse Ops",
            authorAddress: "synapse:ops",
          }
        );
        data.setNotice(
          updated.status === "responded"
            ? "官方回复已发送；帖子状态会进入 answered。"
            : `该任务已是 ${
                responseTaskStatusLabels[updated.status] ?? updated.status
              }，已刷新队列。`
        );
        await data.refreshTasks(token);
        await data.refreshTopics(token);
      },
      "发送回复失败"
    );
  }

  async function ignoreTask() {
    if (!token || !data.selectedTask || !data.selectedTaskActionable) {
      return;
    }
    await runBusyAction(
      setBusy,
      data,
      async () => {
        const updated = await ignoreForumResponseTask(
          token,
          data.selectedTask!.responseTaskId,
          { reason: ignoreReason }
        );
        data.setNotice(
          updated.status === "ignored"
            ? "已忽略该帖子，未回复状态已消除。"
            : `该任务已是 ${
                responseTaskStatusLabels[updated.status] ?? updated.status
              }，已刷新队列。`
        );
        await data.refreshTasks(token);
      },
      "忽略帖子失败"
    );
  }

  async function closeTopic() {
    if (!token || !data.selectedTopic || closeReason.trim().length < 3) {
      return;
    }
    await runBusyAction(
      setBusy,
      data,
      async () => {
        await closeForumTopic(token, data.selectedTopic!.topicId, {
          reason: closeReason,
        });
        data.setNotice("帖子已关闭，公开详情页仍可见但不再接受新回复。");
        setCloseReason("");
        await data.refreshTopics(token);
        data.setTopicDetail(null);
      },
      "关闭帖子失败"
    );
  }

  async function reopenTopic() {
    if (!token || !data.selectedTopic) {
      return;
    }
    await runBusyAction(
      setBusy,
      data,
      async () => {
        await reopenForumTopic(token, data.selectedTopic!.topicId);
        data.setNotice("帖子已重新打开，用户可以继续回复。");
        await data.refreshTopics(token);
        data.setTopicDetail(null);
      },
      "重新打开帖子失败"
    );
  }

  async function togglePinnedTopic() {
    if (!token || !data.selectedTopic) {
      return;
    }
    await runBusyAction(
      setBusy,
      data,
      async () => {
        if (data.selectedTopic!.pinned) {
          await unpinForumTopic(token, data.selectedTopic!.topicId);
          data.setNotice("帖子已取消置顶。");
        } else {
          await pinForumTopic(token, data.selectedTopic!.topicId);
          data.setNotice("帖子已置顶，公开论坛列表会优先展示。");
        }
        await data.refreshTopics(token);
        data.setTopicDetail(null);
      },
      "更新置顶状态失败"
    );
  }

  return {
    replyBody,
    setReplyBody,
    ignoreReason,
    setIgnoreReason,
    closeReason,
    setCloseReason,
    busy,
    sendReply,
    ignoreTask,
    closeTopic,
    reopenTopic,
    togglePinnedTopic,
  };
}

async function runBusyAction(
  setBusy: (value: boolean) => void,
  data: Pick<ReturnType<typeof useForumSupportData>, "setNotice" | "setError">,
  action: () => Promise<void>,
  fallbackError: string
) {
  setBusy(true);
  data.setNotice(null);
  data.setError(null);
  try {
    await action();
  } catch (error) {
    data.setError(error instanceof Error ? error.message : fallbackError);
  } finally {
    setBusy(false);
  }
}
