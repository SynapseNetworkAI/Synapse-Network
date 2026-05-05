"use client";

import {
  compareMoneyStrings,
  formatMoneyString,
  type MoneyString,
} from "@/utils/money";

const WITHDRAW_AMOUNT_INPUT_PATTERN = /^\d*(?:\.\d{0,2})?$/;

type ProviderWithdrawAmountPanelProps = {
  value: string;
  availableReceivable: MoneyString;
  isLoading: boolean;
  placeholder: string;
  confirmLabel: string;
  gasNote: string;
  validationMessage: string | null;
  onChange: (value: string) => void;
  onConfirm: () => void;
};

export function ProviderWithdrawAmountPanel({
  value,
  availableReceivable,
  isLoading,
  placeholder,
  confirmLabel,
  gasNote,
  validationMessage,
  onChange,
  onConfirm,
}: ProviderWithdrawAmountPanelProps) {
  const canUseMax = compareMoneyStrings(availableReceivable, "0") > 0;
  return (
    <div className="mt-4 rounded-[8px] border border-[#323232] bg-[#1a1a1a] p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div
          className={`flex flex-1 items-center rounded-full border bg-[#050505] transition-colors focus-within:border-[#2f3336] ${
            validationMessage ? "border-[#ef4444]" : "border-[#232323]"
          }`}
        >
          <input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (
                nextValue === "" ||
                WITHDRAW_AMOUNT_INPUT_PATTERN.test(nextValue)
              ) {
                onChange(nextValue);
              }
            }}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent px-4 py-2 text-[14px] text-white outline-none placeholder:text-[#555]"
            disabled={isLoading}
          />
          <button
            type="button"
            onClick={() => {
              if (canUseMax) {
                onChange(
                  formatMoneyString(availableReceivable, 2).replace(/,/g, "")
                );
              }
            }}
            disabled={!canUseMax || isLoading}
            className="mr-3 text-[11px] font-bold uppercase tracking-[0.06em] text-[#22c55e] transition hover:text-[#86efac] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            MAX
          </button>
        </div>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isLoading || !value.trim() || Boolean(validationMessage)}
          className="inline-flex h-[36px] min-w-[100px] items-center justify-center whitespace-nowrap rounded-full bg-[#eff3f4] px-4 py-2 text-[14px] font-normal leading-[20px] text-[#0f141a] transition hover:bg-[#e7eaeb] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {confirmLabel}
        </button>
      </div>
      {validationMessage && (
        <p className="text-xs text-[#f87171]">{validationMessage}</p>
      )}
      <p className="text-[12px] leading-[18px] text-[#555]">{gasNote}</p>
    </div>
  );
}
