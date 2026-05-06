"use client";

import { formatMoneyString, type MoneyString } from "@/utils/money";

type ProviderWithdrawBalanceSummaryProps = {
  withdrawableLabel: string;
  receivableLabel: string;
  immatureNotice: string;
  minimumHint: string;
  availableReceivable: MoneyString;
  receivableBalance: MoneyString;
  hasImmatureReceivable: boolean;
};

export function ProviderWithdrawBalanceSummary({
  withdrawableLabel,
  receivableLabel,
  immatureNotice,
  minimumHint,
  availableReceivable,
  receivableBalance,
  hasImmatureReceivable,
}: ProviderWithdrawBalanceSummaryProps) {
  return (
    <div>
      <p className="mb-1 text-[14px] font-normal leading-[20px] text-[#9ca3af]">
        {withdrawableLabel}
      </p>
      <p className="text-[24px] font-bold leading-[32px] tracking-[-0.02em] text-white">
        {formatMoneyString(availableReceivable, 2)} USDC
      </p>
      <p className="mt-1 text-[12px] leading-[18px] text-[#9ca3af]">
        {receivableLabel}: {formatMoneyString(receivableBalance, 2)} USDC
      </p>
      {hasImmatureReceivable && (
        <p className="mt-1 text-[12px] leading-[18px] text-[#86868b]">
          {immatureNotice}
        </p>
      )}
      <p className="mt-1 text-[12px] leading-[18px] text-[#86868b]">
        {minimumHint}
      </p>
    </div>
  );
}
