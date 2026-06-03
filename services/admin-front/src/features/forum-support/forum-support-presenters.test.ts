import { describe, expect, it } from "vitest";

import type {
  ForumResponseTask,
  ForumTopicContext,
} from "@/services/admin-api";
import {
  buildForumGrowingLinks,
  buildForumSupportMetrics,
  buildForumTopicMetrics,
  canIgnoreForumTask,
  canSendForumReply,
  forumSupportModeFromStatus,
  forumSupportStatusForMode,
  isForumResponseTaskActionable,
} from "./forum-support-presenters";

function task(overrides: Partial<ForumResponseTask> = {}): ForumResponseTask {
  return {
    responseTaskId: "frt_1",
    topicId: "topic_1",
    status: "draft_ready",
    source: "growing_agent",
    priority: "normal",
    classification: "question",
    suggestedReply: "Thanks for reporting this.",
    suggestedReplySource: "growing",
    suggestedReplyUpdatedAt: "2026-04-19T00:00:00Z",
    repliedByAdminId: null,
    replyId: null,
    respondedAt: null,
    linkedRequirementCandidateId: null,
    linkedRequirementId: null,
    linkedWorkflowRunId: null,
    metadata: {},
    createdAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    topic: null,
    ...overrides,
  };
}

function topic(overrides: Partial<ForumTopicContext> = {}): ForumTopicContext {
  return {
    topicId: "topic_1",
    title: "How do agent payments settle?",
    body: "Can you explain settlement?",
    excerpt: "Can you explain settlement?",
    category: "payments",
    status: "open",
    authorDisplay: "Cliff",
    authorAddress: "0xabc",
    resolved: false,
    pinned: false,
    locked: false,
    repliesCount: 0,
    officialRepliesCount: 0,
    viewsCount: 0,
    lastActivityAt: "2026-04-19T00:00:00Z",
    createdAt: "2026-04-19T00:00:00Z",
    updatedAt: "2026-04-19T00:00:00Z",
    closedReason: null,
    ...overrides,
  };
}

describe("forum support presenters", () => {
  it("maps status modes to the backend queue filters", () => {
    expect(forumSupportStatusForMode("active")).toBe(
      "awaiting_response,draft_ready"
    );
    expect(forumSupportStatusForMode("history")).toBe(
      "responded,ignored,closed"
    );
    expect(forumSupportModeFromStatus("responded,ignored,closed")).toBe(
      "history"
    );
    expect(forumSupportModeFromStatus("awaiting_response,draft_ready")).toBe(
      "active"
    );
  });

  it("allows reply and ignore actions only for active response tasks", () => {
    const active = task({ status: "awaiting_response" });
    const history = task({ status: "responded" });

    expect(isForumResponseTaskActionable(active)).toBe(true);
    expect(isForumResponseTaskActionable(history)).toBe(false);
    expect(canSendForumReply(active, "ok", false)).toBe(true);
    expect(canSendForumReply(history, "ok", false)).toBe(false);
    expect(canSendForumReply(active, " ", false)).toBe(false);
    expect(canIgnoreForumTask(active, "duplicate", false)).toBe(true);
    expect(canIgnoreForumTask(history, "duplicate", false)).toBe(false);
    expect(canIgnoreForumTask(active, "no", false)).toBe(false);
  });

  it("summarizes queue metrics from visible tasks", () => {
    expect(
      buildForumSupportMetrics([
        task({
          status: "draft_ready",
          classification: "bug",
          priority: "critical",
        }),
        task({
          status: "awaiting_response",
          classification: "question",
          priority: "normal",
        }),
        task({ status: "responded", classification: "bug", priority: "high" }),
      ])
    ).toEqual({
      total: 3,
      draftReady: 1,
      bugs: 2,
      highRisk: 2,
    });
  });

  it("summarizes topic lifecycle metrics from visible topics", () => {
    expect(
      buildForumTopicMetrics([
        topic({ status: "open" }),
        topic({ topicId: "topic_2", status: "awaiting_admin", pinned: true }),
        topic({ topicId: "topic_3", status: "closed" }),
        topic({ topicId: "topic_4", status: "hidden", pinned: true }),
      ])
    ).toEqual({
      open: 2,
      awaitingAdmin: 1,
      closed: 1,
      pinned: 2,
    });
  });

  it("builds Growing deep links from task linkage fields", () => {
    expect(
      buildForumGrowingLinks(
        task({
          linkedRequirementCandidateId: "cand_42",
          linkedRequirementId: "req_7",
          linkedWorkflowRunId: "wf_9",
        })
      )
    ).toEqual([
      {
        key: "candidate",
        label: "打开 Growing Candidate",
        href: "http://localhost:9700/planning?candidate=cand_42",
      },
      {
        key: "requirement",
        label: "打开 Requirement",
        href: "http://localhost:9700/requirements/req_7",
      },
      {
        key: "workflow",
        label: "打开 Workflow",
        href: "http://localhost:9700/workflows/wf_9",
      },
    ]);
  });
});
