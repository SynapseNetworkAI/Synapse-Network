"use client";

import type { ReactNode } from "react";

export function SettingToggle({
  title,
  description,
  checked,
  onChange,
  disabled,
}: Readonly<{
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}>) {
  return (
    <label className="inline-flex items-center justify-end">
      <span className="sr-only">
        {title}. {description}
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
        />
        <span className="h-6 w-10 rounded-full border border-white/12 bg-white/[0.08] transition peer-checked:border-[#7ff7be]/30 peer-checked:bg-[#7ff7be]/20 peer-disabled:opacity-40" />
        <span className="absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_2px_12px_rgba(0,0,0,0.28)] transition peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

export function SettingsRow({
  title,
  description,
  control,
  noBorder = false,
}: Readonly<{
  title: string;
  description?: string;
  control: ReactNode;
  noBorder?: boolean;
}>) {
  return (
    <section
      className={noBorder ? "py-3.5" : "border-b border-[#1e1e1e] py-3.5"}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
        <div className="max-w-[474px] min-w-0">
          <h3 className="text-[14px] font-semibold leading-5 tracking-[-0.01em] text-white">
            {title}
          </h3>
          {description ? (
            <p className="mt-0.5 text-[12px] leading-4 text-[#6b7280]">
              {description}
            </p>
          ) : null}
        </div>
        <div className="w-full max-w-[264px] shrink-0">{control}</div>
      </div>
    </section>
  );
}
