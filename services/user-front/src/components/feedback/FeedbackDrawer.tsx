"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { submitFeedback, type FeedbackPayload } from "@/utils/communityApi";
import SupportContactPanel from "@/components/shared/SupportContactPanel";
import {
  XDialog,
  XDialogBody,
  XDialogCloseButton,
  XDialogFooter,
  XDialogHeader,
  XDialogHeaderCopy,
  XDialogSurface,
} from "@/components/xui/XDialog";

const SENSITIVE_KEY_PARTS = [
  "authorization",
  "bearer",
  "jwt",
  "token",
  "private",
  "secret",
  "password",
  "signature",
];

function redactContext(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[REDACTED_DEPTH]";
  if (Array.isArray(value))
    return value.slice(0, 30).map((item) => redactContext(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_KEY_PARTS.some((part) => key.toLowerCase().includes(part))
          ? "[REDACTED]"
          : redactContext(nested, depth + 1),
      ])
    );
  }
  if (typeof value === "string") {
    return value
      .replace(
        /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g,
        "[REDACTED_JWT]"
      )
      .replace(/\b0x[a-fA-F0-9]{64}\b/g, "[REDACTED_PRIVATE_KEY]")
      .slice(0, 2000);
  }
  return value;
}

export type FeedbackSeed = Partial<FeedbackPayload> & {
  pageTitle?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  seed?: FeedbackSeed;
};

export default function FeedbackDrawer({ open, onClose, seed }: Props) {
  const pathname = usePathname();
  const { address } = useAccount();
  const { t, lang } = useLanguage();
  const [category, setCategory] = useState(
    seed?.category ?? "product_feedback"
  );
  const [message, setMessage] = useState(seed?.message ?? "");
  const [sentiment, setSentiment] = useState<FeedbackPayload["sentiment"]>(
    seed?.sentiment ?? "report_issue"
  );
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCategory(seed?.category ?? "product_feedback");
    setMessage(seed?.message ?? "");
    setSentiment(seed?.sentiment ?? "report_issue");
    setFeedbackId(null);
    setError(null);
  }, [open, seed]);

  const route =
    seed?.route ||
    (typeof window !== "undefined"
      ? `${pathname ?? ""}${window.location.hash}`
      : pathname ?? "");
  const pageTitle =
    seed?.pageTitle || (typeof document !== "undefined" ? document.title : "");
  const context = useMemo(
    () =>
      redactContext({
        ...(seed?.context ?? {}),
        walletAddress: address
          ? `${address.slice(0, 6)}...${address.slice(-4)}`
          : undefined,
        route,
      }) as Record<string, unknown>,
    [address, route, seed]
  );

  if (!open) return null;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitFeedback({
        source:
          seed?.source ?? (route.startsWith("/docs") ? "docs" : "dashboard"),
        sentiment,
        category,
        message,
        route,
        pageTitle,
        language: lang,
        context,
      });
      setFeedbackId(result.feedbackId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to submit feedback"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <XDialog
      open={open}
      ariaLabelledby="feedback-modal-title"
      onDismiss={onClose}
      overlayClassName="z-[130]"
    >
      <XDialogSurface
        className="max-h-[92dvh] max-w-[520px] border border-white/10"
        data-testid="feedback-modal"
      >
        <XDialogHeader>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#7ff7be]/25 bg-[#7ff7be]/10 text-[#7ff7be]">
            <MessageSquare className="h-5 w-5" />
          </div>
          <XDialogHeaderCopy>
            <h2
              id="feedback-modal-title"
              className="text-lg font-semibold tracking-[-0.02em] text-white"
            >
              {t("feedback.drawerTitle")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-white/55">
              {t("feedback.drawerDescription")}
            </p>
          </XDialogHeaderCopy>
          <XDialogCloseButton onClick={onClose} aria-label="Close feedback">
            <X className="h-4 w-4" />
          </XDialogCloseButton>
        </XDialogHeader>

        <XDialogBody className="max-h-[62dvh] space-y-4 overflow-y-auto">
          {feedbackId ? (
            <div className="rounded-3xl border border-[#7ff7be]/20 bg-[#7ff7be]/10 p-5 text-[#dfffee]">
              <p className="text-base font-semibold">
                {t("feedback.submittedTitle")}
              </p>
              <p className="mt-2 text-sm text-[#dfffee]/70">
                {t("feedback.submittedDescription")}
              </p>
              <div
                className="mt-4 rounded-2xl border border-[#7ff7be]/20 bg-black/25 p-3 font-mono text-sm"
                data-testid="feedback-id"
              >
                <span className="text-[#7ff7be]/70">
                  {t("feedback.feedbackIdLabel")}:{" "}
                </span>
                {feedbackId}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["helpful", t("feedback.helpful")],
                  ["not_helpful", t("feedback.notHelpful")],
                  ["report_issue", t("feedback.reportIssue")],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() =>
                      setSentiment(value as FeedbackPayload["sentiment"])
                    }
                    className={[
                      "rounded-2xl border px-3 py-2 text-xs font-semibold transition",
                      sentiment === value
                        ? "border-[#7ff7be]/50 bg-[#7ff7be]/15 text-[#dfffee]"
                        : "border-white/10 bg-white/[0.03] text-white/58 hover:border-white/20 hover:text-white",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
                  {t("feedback.categoryLabel")}
                </span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-[#7ff7be]/45"
                >
                  <option value="product_feedback">Product feedback</option>
                  <option value="bug_report">Bug report</option>
                  <option value="docs_issue">Docs issue</option>
                  <option value="billing_support">Billing support</option>
                  <option value="provider_services">Provider services</option>
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
                  {t("feedback.messageLabel")}
                </span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={t("feedback.messagePlaceholder")}
                  className="mt-2 min-h-[150px] w-full resize-none rounded-3xl border border-white/10 bg-black/30 p-4 text-sm leading-6 text-white outline-none transition placeholder:text-white/25 focus:border-[#7ff7be]/45"
                />
              </label>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-white/45">
                <div>route: {route || "-"}</div>
                <div>context: redacted before submit</div>
              </div>

              {error ? (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-100">
                  <p className="font-semibold">{t("feedback.fallbackTitle")}</p>
                  <p className="mt-1 text-red-100/70">{error}</p>
                  <SupportContactPanel
                    className="mt-3 border-red-500/20 bg-black/20"
                    title={t("feedback.fallbackTitle")}
                    description={t("feedback.fallbackDescription")}
                    actionLabel="Contact support"
                  />
                </div>
              ) : null}
            </>
          )}
        </XDialogBody>

        {!feedbackId ? (
          <XDialogFooter>
            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmit}
              className="h-12 w-full rounded-full bg-white px-5 text-sm font-semibold text-black transition hover:bg-[#e7e9ea] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {submitting ? t("feedback.submitting") : t("feedback.submit")}
            </button>
          </XDialogFooter>
        ) : null}
      </XDialogSurface>
    </XDialog>
  );
}
