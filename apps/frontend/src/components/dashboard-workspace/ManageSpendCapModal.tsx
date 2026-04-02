"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
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
import {
  updateOwnerSpendingLimit,
  type OwnerSpendingLimit,
} from "@/utils/balanceApi";

type ManageSpendCapModalProps = {
  open: boolean;
  userAddress?: string;
  spendingLimit: OwnerSpendingLimit | null;
  onClose: () => void;
  onSaved?: (nextLimit: OwnerSpendingLimit) => void | Promise<void>;
};

export default function ManageSpendCapModal({
  open,
  userAddress,
  spendingLimit,
  onClose,
  onSaved,
}: Readonly<ManageSpendCapModalProps>) {
  const { t } = useLanguage();
  const [limitInput, setLimitInput] = useState("");
  const [allowUnlimited, setAllowUnlimited] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setLimitInput("");
    setAllowUnlimited(spendingLimit?.allowUnlimited ?? true);
    setSaveError(null);
    setIsSaving(false);
  }, [open, spendingLimit]);

  const parsedLimit = Number(limitInput);
  const hasValidLimit = Number.isFinite(parsedLimit) && parsedLimit > 0;
  const hasMeaningfulChange = useMemo(() => {
    const initialUnlimited = spendingLimit?.allowUnlimited ?? true;
    const initialLimit = Number(spendingLimit?.spendingLimitUsdc ?? 0);
    if (allowUnlimited !== initialUnlimited) {
      return true;
    }
    if (allowUnlimited) {
      return false;
    }
    if (!hasValidLimit) {
      return false;
    }
    return Math.abs(initialLimit - parsedLimit) >= 0.000001;
  }, [allowUnlimited, hasValidLimit, parsedLimit, spendingLimit]);

  const handleSave = async () => {
    if (!userAddress) {
      return;
    }
    if (!allowUnlimited && !hasValidLimit) {
      setSaveError(t("creditsPage.manageSpendCapModalAmountInvalid"));
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const saved = await updateOwnerSpendingLimit(userAddress, {
        spendingLimitUsdc: allowUnlimited ? null : parsedLimit,
        allowUnlimited,
      });
      toast.success(t("creditsPage.manageSpendCapModalSaved"));
      await onSaved?.(saved);
      onClose();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("creditsPage.manageSpendCapModalSaveFailed");
      setSaveError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <XDialog open={open} ariaLabelledby="manage-spend-cap-title">
      <XDialogSurface className="w-[min(552px,calc(100vw-24px))] min-h-[338px] border border-white/10 bg-[linear-gradient(180deg,#1f1f20_0%,#171717_100%)] shadow-[0_24px_90px_rgba(0,0,0,0.5)]">
        <XDialogHeader className="px-6 pb-2 pt-5">
          <XDialogHeaderCopy>
            <h2
              id="manage-spend-cap-title"
              className="text-[18px] font-semibold tracking-[-0.03em] text-white"
            >
              {t("creditsPage.manageSpendCapModalTitle")}
            </h2>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8b98b4]">
              {t("creditsPage.manageSpendCapModalEyebrow")}
            </p>
          </XDialogHeaderCopy>
          <XDialogCloseButton
            onClick={onClose}
            aria-label={t("creditsPage.manageSpendCapModalClose")}
          />
        </XDialogHeader>

        <XDialogBody className="space-y-5 px-6 pb-6 pt-1">
          <label className="block">
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-[#d6d9db]">
                $
              </span>
              <XInput
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={limitInput}
                onFocus={() => {
                  if (allowUnlimited) {
                    setAllowUnlimited(false);
                    setSaveError(null);
                  }
                }}
                onChange={(event) => {
                  setLimitInput(event.target.value);
                  if (event.target.value.trim() && allowUnlimited) {
                    setAllowUnlimited(false);
                  }
                }}
                className="pl-9"
                disabled={isSaving}
                aria-label={t("creditsPage.manageSpendCapModalAmountLabel")}
              />
            </div>
          </label>

          <p className="text-[14px] leading-6 text-[#a7acb6]">
            {t("creditsPage.manageSpendCapModalHint")}
          </p>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={allowUnlimited}
              onChange={(event) => {
                setAllowUnlimited(event.target.checked);
                setSaveError(null);
              }}
              className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent"
              disabled={isSaving}
            />
            <div>
              <p className="text-[15px] text-white">
                {t("creditsPage.manageSpendCapModalUnlimitedLabel")}
              </p>
              <p className="mt-1 text-[14px] leading-6 text-[#8b98b4]">
                {t("creditsPage.manageSpendCapModalUnlimitedHint")}
              </p>
            </div>
          </label>

          {saveError ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {saveError}
            </div>
          ) : null}
        </XDialogBody>

        <XDialogFooter className="grid grid-cols-2 gap-3 px-6 pb-6 pt-1">
          <XButton
            variant="ghost"
            size="modal"
            fullWidth
            onClick={onClose}
            disabled={isSaving}
          >
            {t("creditsPage.manageSpendCapModalCancel")}
          </XButton>
          <XButton
            variant="primary"
            size="modal"
            fullWidth
            onClick={() => {
              void handleSave();
            }}
            disabled={
              !userAddress ||
              isSaving ||
              !hasMeaningfulChange ||
              (!allowUnlimited && !hasValidLimit)
            }
          >
            {t("creditsPage.manageSpendCapModalSave")}
          </XButton>
        </XDialogFooter>
      </XDialogSurface>
    </XDialog>
  );
}
