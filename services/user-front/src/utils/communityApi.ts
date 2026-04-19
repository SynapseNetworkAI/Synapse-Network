import { buildAuthedHeaders, getStoredAuthSession } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";

const API_BASE = `${getGatewayBaseUrl()}/api/v1`;

export type FeedbackPayload = {
  source: "docs" | "dashboard" | "forum" | "general";
  sentiment: "helpful" | "not_helpful" | "report_issue";
  category: string;
  message?: string;
  route: string;
  pageTitle?: string;
  language?: string;
  context?: Record<string, unknown>;
};

export type FeedbackResponse = {
  status: "success";
  feedbackId: string;
  redacted: boolean;
  message: string;
};

export type ForumTopic = {
  topicId: string;
  title: string;
  body?: string;
  category: string;
  excerpt: string;
  authorAddress: string;
  authorDisplay: string;
  authorRoles: string[];
  status: string;
  resolved: boolean;
  locked: boolean;
  pinned: boolean;
  viewsCount: number;
  repliesCount: number;
  officialRepliesCount: number;
  reactionsCount: number;
  closedReason?: string | null;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ForumReply = {
  replyId: string;
  topicId: string;
  body: string;
  authorAddress: string;
  authorDisplay: string;
  authorRoles: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ForumListResponse = {
  status: "success";
  categories: string[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  topics: ForumTopic[];
};

export type ForumDetailResponse = {
  status: "success";
  topic: ForumTopic & { body: string };
  replies: ForumReply[];
};

function getAuthHeaders(): HeadersInit | null {
  const session = getStoredAuthSession();
  if (!session?.wallet) return null;
  return buildAuthedHeaders(session.wallet);
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return fallback;
    const parsed = JSON.parse(text) as { detail?: string | { message?: string }; message?: string };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (parsed.detail?.message) return parsed.detail.message;
    if (parsed.message) return parsed.message;
    return text;
  } catch {
    return fallback;
  }
}

export async function submitFeedback(payload: FeedbackPayload): Promise<FeedbackResponse> {
  const authHeaders = getAuthHeaders();
  const response = await fetch(`${API_BASE}/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeaders ?? {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to submit feedback"));
  }
  return (await response.json()) as FeedbackResponse;
}

export async function listForumTopics(params: {
  q?: string;
  category?: string;
  sort?: "latest" | "top";
  page?: number;
  pageSize?: number;
} = {}): Promise<ForumListResponse> {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));
  query.set("sort", params.sort ?? "latest");
  if (params.q) query.set("q", params.q);
  if (params.category) query.set("category", params.category);
  const response = await fetch(`${API_BASE}/forum/topics?${query.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to load forum topics"));
  }
  return (await response.json()) as ForumListResponse;
}

export async function createForumTopic(payload: {
  title: string;
  body: string;
  category: string;
}): Promise<{ status: "success"; topic: ForumTopic & { body: string } }> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Connect wallet to post.");
  const response = await fetch(`${API_BASE}/forum/topics`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to create topic"));
  }
  return (await response.json()) as { status: "success"; topic: ForumTopic & { body: string } };
}

export async function getForumTopic(topicId: string): Promise<ForumDetailResponse> {
  const response = await fetch(`${API_BASE}/forum/topics/${encodeURIComponent(topicId)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to load forum topic"));
  }
  return (await response.json()) as ForumDetailResponse;
}

export async function createForumReply(topicId: string, body: string): Promise<{ status: "success"; reply: ForumReply }> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Connect wallet to reply.");
  const response = await fetch(`${API_BASE}/forum/topics/${encodeURIComponent(topicId)}/replies`, {
    method: "POST",
    headers,
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to post reply"));
  }
  return (await response.json()) as { status: "success"; reply: ForumReply };
}

export async function resolveForumTopic(topicId: string): Promise<{ status: "success"; topic: ForumTopic & { body: string } }> {
  const headers = getAuthHeaders();
  if (!headers) throw new Error("Connect wallet to resolve.");
  const response = await fetch(`${API_BASE}/forum/topics/${encodeURIComponent(topicId)}/resolve`, {
    method: "POST",
    headers,
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Failed to resolve topic"));
  }
  return (await response.json()) as { status: "success"; topic: ForumTopic & { body: string } };
}
