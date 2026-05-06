"use client";

import { Info } from "lucide-react";
import { formatUsd } from "@/utils/ownerCreditsFormat";

type CreditBucketTone = "default" | "pending" | "frozen";

type CreditBucketRowProps = Readonly<{
  label: string;
  amount: number;
  hint?: string;
  info?: string;
  tone?: CreditBucketTone;
}>;

export default function CreditBucketRow({
  label,
  amount,
  hint,
  info,
  tone = "default",
}: CreditBucketRowProps) {
  const amountTone =
    tone === "pending"
      ? "text-amber-200"
      : tone === "frozen"
      ? "text-sky-200"
      : "text-white";

  return (
    <div className="flex flex-col gap-1 rounded-[10px] border border-white/[0.06] bg-black/20 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-1.5">
          <p className="text-[13px] leading-5 text-[#9ca3af]">{label}</p>
          {info ? (
            <Info
              className="h-[13px] w-[13px] text-[#71767b]"
              aria-label={info}
            >
              <title>{info}</title>
            </Info>
          ) : null}
        </div>
        {hint ? (
          <p className="mt-1 max-w-[420px] text-[12px] leading-5 text-[#71767b]">
            {hint}
          </p>
        ) : null}
      </div>
      <p
        className={`font-mono text-[15px] font-semibold leading-6 ${amountTone}`}
      >
        {formatUsd(amount)}
      </p>
    </div>
  );
}
