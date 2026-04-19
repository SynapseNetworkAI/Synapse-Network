// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import ForumTopicPage from "@/app/forum/[topicId]/page";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";

const { getForumTopicMock, createForumReplyMock, resolveForumTopicMock, authSessionMock } = vi.hoisted(() => ({
  getForumTopicMock: vi.fn(),
  createForumReplyMock: vi.fn(),
  resolveForumTopicMock: vi.fn(),
  authSessionMock: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ topicId: "topic_closed" }),
}));

vi.mock("@/utils/authSession", async () => {
  const actual = await vi.importActual<typeof import("@/utils/authSession")>("@/utils/authSession");
  return {
    ...actual,
    getStoredAuthSession: () => authSessionMock(),
  };
});

vi.mock("@/utils/communityApi", async () => {
  const actual = await vi.importActual<typeof import("@/utils/communityApi")>("@/utils/communityApi");
  return {
    ...actual,
    getForumTopic: getForumTopicMock,
    createForumReply: createForumReplyMock,
    resolveForumTopic: resolveForumTopicMock,
  };
});

function renderTopic() {
  return render(createElement(LanguageProvider, null, createElement(ForumTopicPage)));
}

describe("ForumTopicPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem(I18N_STORAGE_KEY, "en");
    authSessionMock.mockReturnValue({
      token: "jwt",
      wallet: "0xabc0000000000000000000000000000000000000",
      expiresAt: Date.now() + 60_000,
    });
    getForumTopicMock.mockResolvedValue({
      status: "success",
      topic: {
        topicId: "topic_closed",
        title: "Provider endpoint is unavailable",
        body: "The service returns 503 after deploy.",
        category: "Provider Services",
        excerpt: "The service returns 503 after deploy.",
        authorAddress: "0xabc0000000000000000000000000000000000000",
        authorDisplay: "0xabc...0000",
        authorRoles: ["Provider"],
        status: "closed",
        resolved: false,
        locked: true,
        pinned: true,
        viewsCount: 4,
        repliesCount: 1,
        officialRepliesCount: 1,
        reactionsCount: 0,
        closedReason: "Duplicate of an answered provider health issue.",
        lastActivityAt: "2026-04-19T00:00:00.000Z",
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-19T00:00:00.000Z",
      },
      replies: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows closed ticket state and disables the public reply composer", async () => {
    renderTopic();

    expect(await screen.findByRole("heading", { name: "Provider endpoint is unavailable" })).toBeTruthy();
    expect(await screen.findAllByText("Closed")).toHaveLength(2);
    expect(await screen.findByText(/Duplicate of an answered provider health issue/i)).toBeTruthy();
    expect(screen.queryByPlaceholderText("Add a helpful reply...")).toBeNull();
    expect(screen.queryByRole("button", { name: "Post reply" })).toBeNull();
  });
});
