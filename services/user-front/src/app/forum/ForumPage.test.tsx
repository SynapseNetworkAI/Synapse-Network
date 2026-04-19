// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ForumPage from "@/app/forum/page";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";

const { listForumTopicsMock, createForumTopicMock } = vi.hoisted(() => ({
  listForumTopicsMock: vi.fn(),
  createForumTopicMock: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/utils/authSession", async () => {
  const actual = await vi.importActual<typeof import("@/utils/authSession")>("@/utils/authSession");
  return {
    ...actual,
    getStoredAuthSession: () => ({
      token: "jwt",
      wallet: "0xabc0000000000000000000000000000000000000",
      expiresAt: Date.now() + 60_000,
    }),
  };
});

vi.mock("@/utils/communityApi", async () => {
  const actual = await vi.importActual<typeof import("@/utils/communityApi")>("@/utils/communityApi");
  return {
    ...actual,
    listForumTopics: listForumTopicsMock,
    createForumTopic: createForumTopicMock,
  };
});

function topic(overrides = {}) {
  return {
    topicId: "topic_1",
    title: "Provider service health checks are failing",
    category: "Provider Services",
    excerpt: "How should providers recover from unhealthy slow lane?",
    authorAddress: "0xabc",
    authorDisplay: "0xabc...0000",
    authorRoles: ["Builder", "Provider"],
    status: "open",
    resolved: false,
    locked: false,
    pinned: false,
    viewsCount: 0,
    repliesCount: 2,
    reactionsCount: 0,
    lastActivityAt: "2026-04-19T00:00:00.000Z",
    createdAt: "2026-04-19T00:00:00.000Z",
    updatedAt: "2026-04-19T00:00:00.000Z",
    ...overrides,
  };
}

function renderForum() {
  return render(createElement(LanguageProvider, null, createElement(ForumPage)));
}

describe("ForumPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem(I18N_STORAGE_KEY, "en");
    listForumTopicsMock.mockResolvedValue({
      status: "success",
      categories: ["Questions", "Provider Services"],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
      topics: [topic()],
    });
    createForumTopicMock.mockResolvedValue({
      status: "success",
      topic: topic({ topicId: "topic_new", title: "SDK question", body: "How do I call invoke?", category: "SDKs" }),
    });
  });

  it("renders topics and creates an authenticated topic", async () => {
    const user = userEvent.setup();
    renderForum();

    expect(await screen.findByRole("heading", { name: "Developer Forum" })).toBeTruthy();
    expect(await screen.findByText("Provider service health checks are failing")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "New topic" }));
    await user.type(screen.getByPlaceholderText("Title"), "SDK question");
    await user.type(screen.getByPlaceholderText(/Describe the question/i), "How do I call invoke safely?");
    await user.click(screen.getByRole("button", { name: "Post topic" }));

    await waitFor(() => expect(createForumTopicMock).toHaveBeenCalledTimes(1));
    expect(createForumTopicMock.mock.calls[0][0]).toMatchObject({
      title: "SDK question",
      body: "How do I call invoke safely?",
    });
    expect(await screen.findByText("SDK question")).toBeTruthy();
  });
});
