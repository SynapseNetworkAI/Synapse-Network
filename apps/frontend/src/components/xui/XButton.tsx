"use client";

import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/components/xui/cx";

type XButtonVariant = "primary" | "ghost" | "danger" | "icon";
type XButtonSize = "pill" | "modal" | "credential" | "icon";

const VARIANT_CLASSES: Record<XButtonVariant, string> = {
  primary: "x-button-primary",
  ghost: "x-button-ghost",
  danger: "x-button-danger",
  icon: "x-icon-button",
};

const SIZE_CLASSES: Record<XButtonSize, string> = {
  pill: "x-action-label inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 font-semibold",
  modal: "x-modal-action",
  credential: "x-credential-action",
  icon: "inline-flex items-center justify-center rounded-lg p-2",
};

export type XButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: XButtonVariant;
  size?: XButtonSize;
  fullWidth?: boolean;
};

export function XButton({
  variant = "ghost",
  size = "pill",
  fullWidth = false,
  className,
  type = "button",
  ...props
}: Readonly<XButtonProps>) {
  return (
    <button
      type={type}
      className={cx(
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth && "w-full",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
