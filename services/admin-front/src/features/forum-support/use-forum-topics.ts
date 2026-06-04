"use client";

import { useCallback, useEffect, useState } from "react";

import {
  getForumTopic,
  listForumTopics,
  type ForumTopicContext,
  type ForumTopicDetailResponse,
} from "@/services/admin-api";

import { buildForumTopicMetrics } from "./forum-support-presenters";
import type {
  ForumPinnedFilter,
  ForumSupportWorkbenchView,
} from "./forum-support-types";

export function useForumTopics({
  token,
  view,
  setError,
}: Readonly<{
  token: string | null;
  view: ForumSupportWorkbenchView;
  setError: (value: string | null) => void;
}>) {
  const [topics, setTopics] = useState<ForumTopicContext[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [topicDetail, setTopicDetail] =
    useState<ForumTopicDetailResponse | null>(null);
  const [topicPage, setTopicPage] = useState(1);
  const [topicTotalPages, setTopicTotalPages] = useState(1);
  const [topicStatus, setTopicStatus] = useState(
    "open,awaiting_admin,answered,resolved"
  );
  const [topicQuery, setTopicQuery] = useState("");
  const [topicPinnedFilter, setTopicPinnedFilter] =
    useState<ForumPinnedFilter>("all");

  const refreshTopics = useCallback(
    async (activeToken = token) => {
      if (!activeToken) {
        return;
      }
      try {
        const response = await listForumTopics(activeToken, {
          status: topicStatus,
          q: topicQuery,
          pinned: pinnedQueryValue(topicPinnedFilter),
          page: topicPage,
          pageSize: 20,
        });
        setTopics(response.items);
        setTopicTotalPages(response.pagination.totalPages || 1);
        setSelectedTopicId((current) =>
          resolveSelectedTopicId(response.items, current)
        );
        setError(null);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "加载论坛帖子列表失败"
        );
      }
    },
    [setError, topicPage, topicPinnedFilter, topicQuery, topicStatus, token]
  );

  useForumTopicDetail({
    token,
    view,
    selectedTopicId,
    setError,
    setTopicDetail,
  });

  return {
    topics,
    selectedTopic: resolveSelectedTopic(topicDetail, topics, selectedTopicId),
    selectedTopicId,
    setSelectedTopicId,
    topicDetail,
    topicPage,
    setTopicPage,
    topicTotalPages,
    topicStatus,
    setTopicStatus,
    topicQuery,
    setTopicQuery,
    topicPinnedFilter,
    setTopicPinnedFilter,
    topicMetrics: buildForumTopicMetrics(topics),
    refreshTopics,
    setTopicDetail,
  };
}

function useForumTopicDetail({
  token,
  view,
  selectedTopicId,
  setError,
  setTopicDetail,
}: Readonly<{
  token: string | null;
  view: ForumSupportWorkbenchView;
  selectedTopicId: string | null;
  setError: (value: string | null) => void;
  setTopicDetail: (value: ForumTopicDetailResponse | null) => void;
}>) {
  useEffect(() => {
    if (!token || view !== "topics" || !selectedTopicId) {
      setTopicDetail(null);
      return;
    }
    let cancelled = false;
    getForumTopic(token, selectedTopicId)
      .then((response) => {
        if (!cancelled) {
          setTopicDetail(response);
        }
      })
      .catch((detailError) => {
        if (!cancelled) {
          setError(
            detailError instanceof Error
              ? detailError.message
              : "加载帖子详情失败"
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTopicId, setError, setTopicDetail, token, view]);
}

function resolveSelectedTopic(
  detail: ForumTopicDetailResponse | null,
  topics: ForumTopicContext[],
  selectedTopicId: string | null
) {
  return (
    detail?.topic ??
    topics.find((item) => item.topicId === selectedTopicId) ??
    topics[0] ??
    null
  );
}

function resolveSelectedTopicId(
  topics: ForumTopicContext[],
  current: string | null
) {
  if (topics.length === 0) {
    return null;
  }
  if (topics.some((item) => item.topicId === current)) {
    return current;
  }
  return topics[0].topicId;
}

function pinnedQueryValue(filter: ForumPinnedFilter) {
  if (filter === "all") {
    return undefined;
  }
  return filter === "pinned";
}
