"use client";

import type { InputHTMLAttributes } from "react";
import { cx } from "@/components/xui/cx";

export type XInputProps = InputHTMLAttributes<HTMLInputElement>;

export function XInput({ className, ...props }: Readonly<XInputProps>) {
  return (
    <input
      className={cx(
        "x-input-flat w-full rounded-2xl px-4 py-3.5 text-base text-white placeholder:text-gray-500",
        className,
      )}
      {...props}
    />
  );
}
