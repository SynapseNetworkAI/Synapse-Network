"use client";

import { useLanguage } from "@/components/i18n/LanguageProvider";

function formatTooltipAmount(value: string | null | undefined): string {
  const numeric = Number.parseFloat(String(value || "0"));
  if (!Number.isFinite(numeric)) {
    return "0.00";
  }
  return numeric.toFixed(2);
}

export default function ConsumerWithdrawPendingTooltip({
  amountUsdc,
  isReadyToClaim = false,
}: Readonly<{ amountUsdc?: string | null; isReadyToClaim?: boolean }>) {
  const { t } = useLanguage();

  return (
    <div className="absolute left-1/2 top-full z-50 mt-2 w-[220px] -translate-x-1/2 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-xs text-[#f59e0b] opacity-0 shadow-xl transition-opacity pointer-events-none group-hover:opacity-100">
      {t(
        isReadyToClaim
          ? "creditsPage.consumerWithdrawReadyTooltip"
          : "creditsPage.consumerWithdrawPendingTooltip",
        {
          amount: formatTooltipAmount(amountUsdc),
        }
      )}
    </div>
  );
}
