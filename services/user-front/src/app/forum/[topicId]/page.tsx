"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Eye, Lock, MessageSquare, Pin } from "lucide-react";
import { useParams } from "next/navigation";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { createForumReply, getForumTopic, resolveForumTopic, type ForumReply, type ForumTopic } from "@/utils/communityApi";
import { getStoredAuthSession } from "@/utils/authSession";

export default function ForumTopicPage() {
  const params = useParams<{ topicId: string }>();
  const topicId = String(params?.topicId || "");
  const { t } = useLanguage();
  const [topic, setTopic] = useState<(ForumTopic & { body: string }) | null>(null);
  const [replies, setReplies] = useState<ForumReply[]>([]);
  const [replyBody, setReplyBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const session = useMemo(() => getStoredAuthSession(), []);

  const loadTopic = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getForumTopic(topicId);
      setTopic(data.topic);
      setReplies(data.replies);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("forumPage.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (topicId) void loadTopic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId]);

  const postReply = async () => {
    setPosting(true);
    setError(null);
    try {
      const result = await createForumReply(topicId, replyBody);
      setReplies((prev) => [...prev, result.reply]);
      setReplyBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("forumPage.connectToPost"));
    } finally {
      setPosting(false);
    }
  };

  const markResolved = async () => {
    setError(null);
    try {
      const result = await resolveForumTopic(topicId);
      setTopic(result.topic);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve topic");
    }
  };

  const repliesLocked = topic?.status === "closed" || topic?.status === "hidden" || topic?.locked;

  return (
    <main className="min-h-[calc(100vh-60px)] bg-[#050505] px-4 py-8 text-white sm:px-6 lg:px-10">
      <section className="mx-auto max-w-4xl space-y-5">
        <Link href="/forum" className="inline-flex items-center gap-2 text-sm font-semibold text-white/55 transition hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          Forum
        </Link>

        {error ? <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">{error}</div> : null}
        {loading ? <div className="rounded-[28px] border border-white/10 bg-[#0a0b0d] p-6 text-white/45">Loading topic...</div> : null}

        {topic ? (
          <article className="rounded-[32px] border border-white/10 bg-[#0a0b0d] p-6 shadow-[0_24px_90px_rgba(0,0,0,0.4)]">
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/40">
              <span>{topic.category}</span>
              <span>·</span>
              <span>{topic.authorDisplay}</span>
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {topic.viewsCount} {t("forumPage.views")}
              </span>
              {topic.pinned ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#7ff7be]/25 bg-[#7ff7be]/10 px-2 py-0.5 text-[#dfffee]">
                  <Pin className="h-3 w-3" />
                  {t("forumPage.pinned")}
                </span>
              ) : null}
              {topic.status === "awaiting_admin" ? (
                <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-amber-100">
                  {t("forumPage.awaitingAdmin")}
                </span>
              ) : null}
              {topic.officialRepliesCount > 0 ? (
                <span className="rounded-full border border-sky-300/25 bg-sky-300/10 px-2 py-0.5 text-sky-100">
                  {topic.officialRepliesCount} {t("forumPage.officialReply")}
                </span>
              ) : null}
              {topic.status === "closed" ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.08] px-2 py-0.5 text-white/70">
                  <Lock className="h-3 w-3" />
                  {t("forumPage.closed")}
                </span>
              ) : null}
              {topic.resolved ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#7ff7be]/25 bg-[#7ff7be]/10 px-2 py-0.5 text-[#dfffee]">
                  <CheckCircle2 className="h-3 w-3" />
                  {t("forumPage.resolved")}
                </span>
              ) : null}
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] md:text-5xl">{topic.title}</h1>
            <div className="mt-6 whitespace-pre-wrap rounded-[24px] border border-white/10 bg-black/20 p-5 text-[15px] leading-7 text-white/72">
              {topic.body}
            </div>
            {topic.status === "closed" ? (
              <div className="mt-5 rounded-[22px] border border-white/10 bg-white/[0.06] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Lock className="h-4 w-4" />
                  {t("forumPage.closed")}
                </div>
                <p className="mt-2 text-sm leading-6 text-white/55">{t("forumPage.closedDescription")}</p>
                {topic.closedReason ? (
                  <p className="mt-2 text-sm leading-6 text-white/70">
                    <span className="font-semibold">{t("forumPage.closedReason")}:</span> {topic.closedReason}
                  </p>
                ) : null}
              </div>
            ) : null}
            {session?.wallet && session.wallet.toLowerCase() === topic.authorAddress.toLowerCase() && !topic.resolved && !repliesLocked ? (
              <button
                type="button"
                onClick={markResolved}
                className="mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-[#7ff7be]/25 bg-[#7ff7be]/10 px-4 text-sm font-semibold text-[#dfffee] transition hover:border-[#7ff7be]/45"
              >
                <CheckCircle2 className="h-4 w-4" />
                {t("forumPage.markResolved")}
              </button>
            ) : null}
          </article>
        ) : null}

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-white/70">
            <MessageSquare className="h-4 w-4" />
            <h2 className="font-semibold">{t("forumPage.replies")}</h2>
          </div>
          {replies.map((reply) => (
            <div key={reply.replyId} className="rounded-[24px] border border-white/10 bg-[#0a0b0d] p-5">
              <div className="text-xs text-white/35">{reply.authorDisplay} · {reply.createdAt ? new Date(reply.createdAt).toLocaleString() : ""}</div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/70">{reply.body}</p>
            </div>
          ))}

          <div className="rounded-[24px] border border-white/10 bg-[#0a0b0d] p-5">
            {!session ? <p className="mb-3 text-sm text-white/45">{t("forumPage.connectToPost")}</p> : null}
            {repliesLocked ? (
              <div className="rounded-3xl border border-white/10 bg-black/25 p-4 text-sm leading-6 text-white/55">
                {t("forumPage.closedDescription")}
              </div>
            ) : (
              <>
                <textarea
                  value={replyBody}
                  onChange={(event) => setReplyBody(event.target.value)}
                  placeholder={topic?.resolved ? t("forumPage.continueDiscussion") : t("forumPage.replyPlaceholder")}
                  className="min-h-[120px] w-full resize-none rounded-3xl border border-white/10 bg-black/30 p-4 text-sm leading-6 outline-none placeholder:text-white/28 focus:border-[#7ff7be]/45"
                />
                <button
                  type="button"
                  disabled={!session || posting}
                  onClick={postReply}
                  className="mt-3 h-10 rounded-full bg-white px-5 text-sm font-semibold text-black transition hover:bg-[#e7e9ea] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("forumPage.postReply")}
                </button>
              </>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
