"use client";

import { useEffect, useMemo, useState } from "react";
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
import { XButton } from "@/components/xui/XButton";
import { XInput } from "@/components/xui/XInput";

type EmailVerificationCodeModalProps = {
  open: boolean;
  email: string | null;
  sendsRemaining: number;
  onClose: () => void;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
};

function normalizeCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

export default function EmailVerificationCodeModal({
  open,
  email,
  sendsRemaining,
  onClose,
  onVerify,
  onResend,
}: Readonly<EmailVerificationCodeModalProps>) {
  const { t } = useLanguage();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setCode("");
    setMessage(null);
    setIsSubmitting(false);
    setIsResending(false);
  }, [open, email]);

  const isComplete = code.length === 6;
  const canResend = sendsRemaining > 0 && !isSubmitting && !isResending;
  const remainingCopy = useMemo(
    () =>
      t("accountSettingsPage.emailVerificationSendsRemaining").replace(
        "{{count}}",
        String(Math.max(0, sendsRemaining))
      ),
    [sendsRemaining, t]
  );

  const handleVerify = async () => {
    if (!isComplete) {
      setMessage(t("accountSettingsPage.emailVerificationCodeInvalid"));
      return;
    }
    setIsSubmitting(true);
    setMessage(null);
    try {
      await onVerify(code);
      setCode("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : t("accountSettingsPage.emailVerificationFailed")
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!canResend) {
      setMessage(t("accountSettingsPage.emailVerificationDailyLimit"));
      return;
    }
    setIsResending(true);
    setMessage(null);
    try {
      await onResend();
      setMessage(t("accountSettingsPage.emailVerificationResent"));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : t("accountSettingsPage.emailVerificationResendFailed")
      );
    } finally {
      setIsResending(false);
    }
  };

  return (
    <XDialog
      open={open}
      ariaLabelledby="email-verification-title"
      onDismiss={onClose}
    >
      <XDialogSurface className="w-[min(520px,calc(100vw-24px))] border border-white/10 bg-[linear-gradient(180deg,#1c1c1e_0%,#111214_100%)] shadow-[0_24px_90px_rgba(0,0,0,0.55)]">
        <XDialogHeader className="border-b-0 px-5 pb-1 pt-5">
          <XDialogHeaderCopy>
            <h2
              id="email-verification-title"
              className="text-[20px] font-semibold tracking-[-0.03em] text-white"
            >
              {t("accountSettingsPage.emailVerificationTitle")}
            </h2>
            <p className="mt-3 text-[14px] leading-6 text-[#a7acb6]">
              {t("accountSettingsPage.emailVerificationDescription").replace(
                "{{email}}",
                email ?? ""
              )}
            </p>
          </XDialogHeaderCopy>
          <XDialogCloseButton
            onClick={onClose}
            aria-label={t("accountSettingsPage.emailVerificationClose")}
          />
        </XDialogHeader>

        <XDialogBody className="space-y-4 px-5 pb-3 pt-0">
          <XInput
            id="account-email-verification-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => {
              setCode(normalizeCode(event.target.value));
              setMessage(null);
            }}
            placeholder="000000"
            aria-label={t("accountSettingsPage.emailVerificationCodeLabel")}
            disabled={isSubmitting}
            className="rounded-[14px] px-4 py-[14px] text-center text-[24px] font-semibold tracking-[0.22em] placeholder:tracking-[0.22em]"
          />

          <p className="text-[12px] leading-4 text-[#71767b]">
            {remainingCopy}
          </p>
          {sendsRemaining <= 0 ? (
            <div className="rounded-2xl border border-[#d5a35b]/20 bg-[#d5a35b]/10 px-4 py-3 text-sm text-[#f3c37a]">
              {t("accountSettingsPage.emailVerificationDailyLimit")}
            </div>
          ) : null}
          {message ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-[#d4d8df]">
              {message}
            </div>
          ) : null}
        </XDialogBody>

        <XDialogFooter className="border-t-0 px-5 pb-5 pt-2">
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={!canResend}
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/85 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isResending
              ? t("accountSettingsPage.emailVerificationResending")
              : t("accountSettingsPage.emailVerificationResend")}
          </button>
          <XButton
            variant="primary"
            size="modal"
            onClick={() => void handleVerify()}
            disabled={isSubmitting || !isComplete}
            aria-label={t("accountSettingsPage.emailVerificationSubmit")}
          >
            {isSubmitting
              ? t("accountSettingsPage.emailVerificationVerifying")
              : t("accountSettingsPage.emailVerificationSubmit")}
          </XButton>
        </XDialogFooter>
      </XDialogSurface>
    </XDialog>
  );
}
