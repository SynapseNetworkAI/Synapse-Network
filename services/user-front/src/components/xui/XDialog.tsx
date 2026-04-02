"use client";

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cx } from "@/components/xui/cx";

export type XDialogProps = {
  open: boolean;
  ariaLabelledby: string;
  children: ReactNode;
  overlayClassName?: string;
  onDismiss?: () => void;
};

export function XDialog({ open, ariaLabelledby, children, overlayClassName, onDismiss }: Readonly<XDialogProps>) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!open || !isMounted) {
    return null;
  }

  return createPortal(
    <div
      className={cx("x-dialog-shell x-modal-overlay", overlayClassName)}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledby}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss?.();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function XDialogSurface({ className, ...props }: Readonly<HTMLAttributes<HTMLElement>>) {
  return <section className={cx("x-modal-flat x-modal-surface", className)} {...props} />;
}

export function XDialogHeader({ className, ...props }: Readonly<HTMLAttributes<HTMLElement>>) {
  return <header className={cx("x-modal-header x-divider", className)} {...props} />;
}

export function XDialogHeaderCopy({ className, ...props }: Readonly<HTMLAttributes<HTMLDivElement>>) {
  return <div className={cx("x-modal-header-copy", className)} {...props} />;
}

export function XDialogBody({ className, ...props }: Readonly<HTMLAttributes<HTMLElement>>) {
  return <section className={cx("x-modal-body", className)} {...props} />;
}

export function XDialogFooter({ className, ...props }: Readonly<HTMLAttributes<HTMLDivElement>>) {
  return <div className={cx("x-modal-footer", className)} {...props} />;
}

export function XDialogCloseButton({ className, children, ...props }: Readonly<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button type="button" className={cx("x-modal-close", className)} {...props}>
      {children ?? <X className="h-5 w-5" />}
    </button>
  );
}
