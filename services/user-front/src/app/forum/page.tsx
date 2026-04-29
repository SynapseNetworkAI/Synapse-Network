"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Eye,
  Lock,
  Pin,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import {
  XDialog,
  XDialogBody,
  XDialogCloseButton,
  XDialogFooter,
  XDialogHeader,
  XDialogHeaderCopy,
  XDialogSurface,
} from "@/components/xui/XDialog";
import {
  createForumTopic,
  listForumTopics,
  type ForumTopic,
} from "@/utils/communityApi";
import { getStoredAuthSession } from "@/utils/authSession";

const FORUM_PAGE_SIZE = 10;

type ForumPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

const EMPTY_PAGINATION: ForumPagination = {
  page: 1,
  pageSize: FORUM_PAGE_SIZE,
  total: 0,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
};

export default function ForumPage() {
  const { t, tList } = useLanguage();
  const categories = tList("forumPage.categories");
  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [pagination, setPagination] =
    useState<ForumPagination>(EMPTY_PAGINATION);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<"latest" | "top">("latest");
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [createCategory, setCreateCategory] = useState(
    categories[1] ?? "Questions"
  );
  const [submitting, setSubmitting] = useState(false);

  const hasSession = useMemo(() => Boolean(getStoredAuthSession()), []);

  const totalPages = Math.max(1, pagination.totalPages);
  const showingStart =
    pagination.total === 0
      ? 0
      : (pagination.page - 1) * pagination.pageSize + 1;
  const showingEnd =
    pagination.total === 0
      ? 0
      : Math.min(pagination.total, pagination.page * pagination.pageSize);
  const pageNumbers = useMemo(() => {
    const windowSize = 5;
    const halfWindow = Math.floor(windowSize / 2);
    const start = Math.max(
      1,
      Math.min(page - halfWindow, totalPages - windowSize + 1)
    );
    const end = Math.min(totalPages, start + windowSize - 1);

    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [page, totalPages]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listForumTopics({
        q: appliedQ,
        category: category || undefined,
        sort,
        page,
        pageSize: FORUM_PAGE_SIZE,
      });
      setTopics(data.topics);
      setPagination({
        ...data.pagination,
        totalPages: Math.max(1, data.pagination.totalPages),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("forumPage.loadFailed"));
      setTopics([]);
      setPagination({ ...EMPTY_PAGINATION, page });
    } finally {
      setLoading(false);
    }
  }, [appliedQ, category, page, sort, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applySearch = () => {
    const nextQuery = q.trim();
    if (page === 1 && appliedQ === nextQuery) {
      void refresh();
      return;
    }
    setAppliedQ(nextQuery);
    setPage(1);
  };

  const goToPage = (nextPage: number) => {
    setPage(Math.min(Math.max(nextPage, 1), totalPages));
  };

  const resetPageAndCategory = (nextCategory: string) => {
    setCategory(nextCategory);
    setPage(1);
  };

  const resetPageAndSort = (nextSort: "latest" | "top") => {
    setSort(nextSort);
    setPage(1);
  };

  const openCreateModal = () => {
    setCreateError(null);
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    setCreateError(null);
    setIsCreateModalOpen(false);
  };

  const resetCreateForm = () => {
    setTitle("");
    setBody("");
    setCreateCategory(categories[1] ?? "Questions");
  };

  const submitTopic = async () => {
    setSubmitting(true);
    setCreateError(null);
    try {
      const result = await createForumTopic({
        title,
        body,
        category: createCategory,
      });
      setIsCreateModalOpen(false);
      resetCreateForm();
      setTopics((prev) => [result.topic, ...prev].slice(0, FORUM_PAGE_SIZE));
      setPagination((prev) => {
        const total = prev.total + 1;
        const totalPages = Math.max(1, Math.ceil(total / prev.pageSize));
        return {
          ...prev,
          total,
          totalPages,
          hasNextPage: prev.page < totalPages,
        };
      });
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : t("forumPage.connectToPost")
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-60px)] bg-[#050505] px-4 py-8 text-white sm:px-6 lg:px-10">
      <section className="mx-auto max-w-7xl">
        <div className="relative overflow-hidden rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(127,247,190,0.16),transparent_34%),linear-gradient(135deg,#0c0f12,#050505_62%)] p-6 shadow-[0_28px_110px_rgba(0,0,0,0.46)] md:p-8">
          <div className="absolute right-8 top-8 hidden h-24 w-24 rounded-full bg-[#7ff7be]/10 blur-3xl md:block" />
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#7ff7be]">
            Community
          </p>
          <div className="mt-4 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-4xl font-semibold tracking-[-0.05em] md:text-6xl">
                {t("forumPage.title")}
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-white/58 md:text-lg">
                {t("forumPage.description")}
              </p>
            </div>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-black transition hover:bg-[#e7e9ea]"
            >
              <Plus className="h-4 w-4" />
              {t("forumPage.newTopic")}
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-[28px] border border-white/10 bg-[#0a0b0d] p-4">
            <p className="px-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/35">
              Categories
            </p>
            <div className="mt-3 space-y-1">
              <button
                type="button"
                onClick={() => resetPageAndCategory("")}
                className={`w-full rounded-2xl px-3 py-2 text-left text-sm transition ${
                  !category
                    ? "bg-white/10 text-white"
                    : "text-white/55 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                {t("forumPage.allCategories")}
              </button>
              {categories.map((item) => (
                <button
                  type="button"
                  key={item}
                  onClick={() => resetPageAndCategory(item)}
                  className={`w-full rounded-2xl px-3 py-2 text-left text-sm transition ${
                    category === item
                      ? "bg-[#7ff7be]/12 text-[#dfffee]"
                      : "text-white/55 hover:bg-white/[0.05] hover:text-white"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </aside>

          <section className="space-y-4">
            <div className="flex flex-col gap-3 rounded-[28px] border border-white/10 bg-[#0a0b0d] p-4 md:flex-row md:items-center">
              <div className="flex h-11 flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-3">
                <Search className="h-4 w-4 text-white/35" />
                <input
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applySearch();
                  }}
                  placeholder={t("forumPage.searchPlaceholder")}
                  className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/28"
                />
              </div>
              <button
                type="button"
                onClick={applySearch}
                className="h-11 rounded-2xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-[#e7e9ea]"
              >
                {t("forumPage.searchAction")}
              </button>
              <div className="flex gap-2">
                {(["latest", "top"] as const).map((item) => (
                  <button
                    type="button"
                    key={item}
                    onClick={() => resetPageAndSort(item)}
                    className={`h-11 rounded-2xl px-4 text-sm font-semibold transition ${
                      sort === item
                        ? "bg-white text-black"
                        : "border border-white/10 text-white/55 hover:text-white"
                    }`}
                  >
                    {item === "latest"
                      ? t("forumPage.latest")
                      : t("forumPage.top")}
                  </button>
                ))}
              </div>
            </div>

            {error ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
                {error}
              </div>
            ) : null}

            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0a0b0d]">
              <div className="grid grid-cols-[minmax(0,1fr)_76px_76px_110px] border-b border-white/10 px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
                <span>Topic</span>
                <span>{t("forumPage.replies")}</span>
                <span>{t("forumPage.views")}</span>
                <span>{t("forumPage.activity")}</span>
              </div>
              {loading ? (
                <div className="p-6 text-white/45">Loading forum signal...</div>
              ) : topics.length === 0 ? (
                <div className="p-8">
                  <p className="text-lg font-semibold">
                    {t("forumPage.emptyTitle")}
                  </p>
                  <p className="mt-2 text-sm text-white/45">
                    {t("forumPage.emptyDescription")}
                  </p>
                </div>
              ) : (
                topics.map((topic) => (
                  <Link
                    key={topic.topicId}
                    href={`/forum/${topic.topicId}`}
                    className="grid grid-cols-[minmax(0,1fr)_76px_76px_110px] gap-3 border-b border-white/10 px-5 py-5 transition hover:bg-white/[0.035]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold tracking-[-0.02em]">
                          {topic.title}
                        </h2>
                        {topic.pinned ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[#7ff7be]/25 bg-[#7ff7be]/10 px-2 py-0.5 text-[11px] text-[#dfffee]">
                            <Pin className="h-3 w-3" />
                            {t("forumPage.pinned")}
                          </span>
                        ) : null}
                        {topic.status === "awaiting_admin" ? (
                          <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[11px] text-amber-100">
                            {t("forumPage.awaitingAdmin")}
                          </span>
                        ) : null}
                        {topic.status === "closed" ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.08] px-2 py-0.5 text-[11px] text-white/70">
                            <Lock className="h-3 w-3" />
                            {t("forumPage.closed")}
                          </span>
                        ) : null}
                        {topic.resolved ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[#7ff7be]/25 bg-[#7ff7be]/10 px-2 py-0.5 text-[11px] text-[#dfffee]">
                            <CheckCircle2 className="h-3 w-3" />
                            {t("forumPage.resolved")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-white/50">
                        {topic.excerpt}
                      </p>
                      <p className="mt-2 text-xs text-white/35">
                        {topic.category} · {topic.authorDisplay}
                        {topic.officialRepliesCount > 0
                          ? ` · ${topic.officialRepliesCount} ${t(
                              "forumPage.officialReply"
                            )}`
                          : ""}
                      </p>
                    </div>
                    <div className="text-sm font-semibold text-white/65">
                      {topic.repliesCount}
                    </div>
                    <div className="inline-flex items-start gap-1 text-sm text-white/45">
                      <Eye className="mt-0.5 h-3.5 w-3.5" />
                      {topic.viewsCount}
                    </div>
                    <div className="text-sm text-white/45">
                      {topic.lastActivityAt
                        ? new Date(topic.lastActivityAt).toLocaleDateString()
                        : "-"}
                    </div>
                  </Link>
                ))
              )}
              <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div className="text-sm text-white/42">
                  <p>
                    {t("forumPage.resultRange", {
                      start: showingStart,
                      end: showingEnd,
                      total: pagination.total,
                    })}
                  </p>
                  <p className="mt-1 text-xs text-white/30">
                    {t("forumPage.pageStatus", {
                      page: pagination.page,
                      totalPages,
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!pagination.hasPreviousPage || loading}
                    onClick={() => goToPage(page - 1)}
                    className="h-10 rounded-2xl border border-white/10 px-4 text-sm font-semibold text-white/60 transition hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {t("forumPage.previousPage")}
                  </button>
                  {pageNumbers.map((item) => (
                    <button
                      type="button"
                      key={item}
                      aria-current={
                        item === pagination.page ? "page" : undefined
                      }
                      onClick={() => goToPage(item)}
                      disabled={loading}
                      className={`h-10 min-w-10 rounded-2xl px-3 text-sm font-semibold transition ${
                        item === pagination.page
                          ? "bg-[#7ff7be] text-black"
                          : "border border-white/10 text-white/55 hover:bg-white/[0.05] hover:text-white"
                      } disabled:cursor-not-allowed disabled:opacity-35`}
                    >
                      {item}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={!pagination.hasNextPage || loading}
                    onClick={() => goToPage(page + 1)}
                    className="h-10 rounded-2xl border border-white/10 px-4 text-sm font-semibold text-white/60 transition hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {t("forumPage.nextPage")}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <XDialog
        open={isCreateModalOpen}
        ariaLabelledby="forum-create-topic-title"
        onDismiss={closeCreateModal}
      >
        <XDialogSurface className="w-[min(94vw,680px)] border border-[#7ff7be]/20 bg-[#07120d] shadow-[0_30px_120px_rgba(0,0,0,0.55),0_0_80px_rgba(127,247,190,0.08)]">
          <XDialogHeader className="border-b border-white/10">
            <XDialogHeaderCopy>
              <div className="flex items-center gap-2 text-[#dfffee]">
                <Sparkles className="h-4 w-4" />
                <h2
                  id="forum-create-topic-title"
                  className="text-lg font-semibold tracking-[-0.02em] text-white"
                >
                  {t("forumPage.createTitle")}
                </h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-white/55">
                {t("forumPage.topicBodyPlaceholder")}
              </p>
            </XDialogHeaderCopy>
            <XDialogCloseButton
              onClick={closeCreateModal}
              aria-label={t("forumPage.closeTopicDialog")}
            />
          </XDialogHeader>

          <XDialogBody className="space-y-4">
            {!hasSession ? (
              <p className="rounded-2xl bg-black/25 p-3 text-sm text-[#dfffee]/70">
                {t("forumPage.connectToPost")}
              </p>
            ) : null}
            {createError ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
                {createError}
              </div>
            ) : null}
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/38">
                {t("forumPage.topicTitleLabel")}
              </span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("forumPage.topicTitleLabel")}
                className="h-12 rounded-2xl border border-white/10 bg-black/30 px-4 text-sm outline-none transition focus:border-[#7ff7be]/45"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/38">
                {t("forumPage.categoryLabel")}
              </span>
              <select
                value={createCategory}
                onChange={(event) => setCreateCategory(event.target.value)}
                className="h-12 rounded-2xl border border-white/10 bg-black/30 px-4 text-sm outline-none transition focus:border-[#7ff7be]/45"
              >
                {categories.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/38">
                {t("forumPage.topicBodyLabel")}
              </span>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={t("forumPage.topicBodyPlaceholder")}
                className="min-h-[180px] resize-none rounded-3xl border border-white/10 bg-black/30 p-4 text-sm leading-6 outline-none placeholder:text-white/28 transition focus:border-[#7ff7be]/45"
              />
            </label>
          </XDialogBody>

          <XDialogFooter className="border-t border-white/10">
            <button
              type="button"
              onClick={closeCreateModal}
              className="h-11 rounded-full border border-white/10 px-5 text-sm font-semibold text-white/70 transition hover:bg-white/[0.06] hover:text-white"
            >
              {t("forumPage.cancelTopic")}
            </button>
            <button
              type="button"
              disabled={
                !hasSession || submitting || !title.trim() || !body.trim()
              }
              onClick={submitTopic}
              className="h-11 rounded-full bg-white px-5 text-sm font-semibold text-black transition hover:bg-[#e7e9ea] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("forumPage.postTopic")}
            </button>
          </XDialogFooter>
        </XDialogSurface>
      </XDialog>
    </main>
  );
}
