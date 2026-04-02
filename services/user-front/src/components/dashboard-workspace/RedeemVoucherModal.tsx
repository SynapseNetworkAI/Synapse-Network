"use client";

import { useEffect, useState } from "react";
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

type RedeemVoucherModalProps = {
  open: boolean;
  onClose: () => void;
  onRedeem?: (voucherCode: string) => Promise<void>;
};

const VOUCHER_CODE_REGEX = /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2}$/;

function formatVoucherCode(value: string): string {
  const compact = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);

  return compact.match(/.{1,4}/g)?.join("-") ?? "";
}

export default function RedeemVoucherModal({
  open,
  onClose,
  onRedeem,
}: Readonly<RedeemVoucherModalProps>) {
  const { t } = useLanguage();
  const [voucherCode, setVoucherCode] = useState("");
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setVoucherCode("");
    setSubmitMessage(null);
    setIsSubmitting(false);
  }, [open]);

  const hasCompleteVoucherCode = VOUCHER_CODE_REGEX.test(voucherCode);

  const handleRedeem = async () => {
    if (!hasCompleteVoucherCode) {
      setSubmitMessage(t("creditsPage.redeemVoucherModalInvalid"));
      return;
    }

    if (!onRedeem) {
      setSubmitMessage(t("creditsPage.redeemVoucherModalUnavailable"));
      return;
    }

    setIsSubmitting(true);
    setSubmitMessage(null);
    try {
      await onRedeem(voucherCode);
      onClose();
    } catch (error) {
      setSubmitMessage(
        error instanceof Error
          ? error.message
          : t("creditsPage.redeemVoucherModalUnavailable")
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <XDialog open={open} ariaLabelledby="redeem-voucher-title">
      <XDialogSurface className="w-[min(562px,calc(100vw-24px))] min-h-[246px] border border-white/10 bg-[linear-gradient(180deg,#1f1f20_0%,#171717_100%)] shadow-[0_24px_90px_rgba(0,0,0,0.5)]">
        <XDialogHeader className="border-b-0 px-5 pb-1 pt-5">
          <XDialogHeaderCopy>
            <h2
              id="redeem-voucher-title"
              className="text-[18px] font-semibold tracking-[-0.03em] text-white"
            >
              {t("creditsPage.redeemVoucherModalTitle")}
            </h2>
            <p className="mt-3 text-[15px] leading-6 text-[#a7acb6]">
              {t("creditsPage.redeemVoucherModalDescription")}
            </p>
          </XDialogHeaderCopy>
          <XDialogCloseButton
            onClick={onClose}
            aria-label={t("creditsPage.redeemVoucherModalClose")}
          />
        </XDialogHeader>

        <XDialogBody className="space-y-4 px-5 pb-3 pt-0">
          <label className="sr-only" htmlFor="redeem-voucher-code">
            {t("creditsPage.redeemVoucher")}
          </label>
          <XInput
            id="redeem-voucher-code"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            value={voucherCode}
            onChange={(event) => {
              setVoucherCode(formatVoucherCode(event.target.value));
              setSubmitMessage(null);
            }}
            placeholder={t("creditsPage.redeemVoucherModalPlaceholder")}
            aria-label={t("creditsPage.redeemVoucher")}
            disabled={isSubmitting}
            className="rounded-[12px] px-4 py-[14px] text-[15px] tracking-[0.08em] placeholder:tracking-[0.08em]"
          />

          {submitMessage ? (
            <div className="rounded-2xl border border-[#d5a35b]/20 bg-[#d5a35b]/10 px-4 py-3 text-sm text-[#f3c37a]">
              {submitMessage}
            </div>
          ) : null}
        </XDialogBody>

        <XDialogFooter className="border-t-0 px-5 pb-5 pt-2">
          <XButton
            variant="primary"
            size="modal"
            fullWidth
            onClick={() => {
              void handleRedeem();
            }}
            disabled={isSubmitting || !hasCompleteVoucherCode}
            aria-label={t("creditsPage.redeemVoucher")}
          >
            {isSubmitting
              ? t("creditsPage.redeemVoucherModalRedeeming")
              : t("creditsPage.redeemVoucher")}
          </XButton>
        </XDialogFooter>
      </XDialogSurface>
    </XDialog>
  );
}
