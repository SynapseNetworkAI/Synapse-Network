import type { ReactNode } from "react";

interface StepItemProps {
  num: string;         // "01" .. "06"
  title: string;
  accent: string;      // hex color for the step accent
  children: ReactNode;
  last?: boolean;
  id?: string;         // scroll-target for IntersectionObserver
}

export function StepItem({ num, title, accent, children, last = false, id }: Readonly<StepItemProps>) {
  return (
    <div id={id} className="relative flex gap-5">
      {/* Vertical connector line */}
      {!last && (
        <div
          className="absolute left-[19px] top-[48px] w-px bottom-0 -mb-6"
          style={{ background: `${accent}20` }}
        />
      )}

      {/* Step badge */}
      <div className="shrink-0 flex flex-col items-center">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center font-mono text-[11px] font-bold border"
          style={{
            borderColor: `${accent}40`,
            background: `${accent}10`,
            color: accent,
          }}
        >
          {num}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 pb-12 space-y-3">
        <h3 className="text-[16px] font-semibold text-white leading-tight pt-2">{title}</h3>
        {children}
      </div>
    </div>
  );
}

interface StepTipProps {
  accent: string;
  children: ReactNode;
}

export function StepTip({ accent, children }: Readonly<StepTipProps>) {
  return (
    <div
      className="rounded-xl p-4 flex gap-3 mt-2"
      style={{ background: `${accent}08`, border: `1px solid ${accent}18` }}
    >
      <span style={{ color: accent }} className="mt-0.5 shrink-0 text-[14px]">💡</span>
      <p className="text-[13px] text-[#71767b] leading-relaxed">{children}</p>
    </div>
  );
}
