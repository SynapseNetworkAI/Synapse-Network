"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import toast from "react-hot-toast";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { cx } from "@/components/xui/cx";

type CopyableValueProps = {
  value?: string | null;
  displayValue?: string | null;
  label: string;
  className?: string;
  valueClassName?: string;
  buttonClassName?: string;
  emptyValue?: string;
  startChars?: number;
  endChars?: number;
};

export function shortenCopyValue(
  value?: string | null,
  startChars = 6,
  endChars = 4
): string {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.length <= startChars + endChars + 3) {
    return normalized;
  }
  return `${normalized.slice(0, startChars)}...${normalized.slice(-endChars)}`;
}

function writeClipboard(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value);
  }

  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("Clipboard unavailable"));
      return;
    }
    const textArea = document.createElement("textarea");
    textArea.value = value;
    textArea.setAttribute("readonly", "true");
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.select();
    try {
      const ok = document.execCommand("copy");
      if (!ok) {
        reject(new Error("Clipboard command failed"));
        return;
      }
      resolve();
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Clipboard failed"));
    } finally {
      document.body.removeChild(textArea);
    }
  });
}

export default function CopyableValue({
  value,
  displayValue,
  label,
  className,
  valueClassName,
  buttonClassName,
  emptyValue = "-",
  startChars = 6,
  endChars = 4,
}: Readonly<CopyableValueProps>) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const normalized = String(value || "").trim();
  const display = displayValue ?? shortenCopyValue(normalized, startChars, endChars);

  if (!normalized) {
    return <span className={valueClassName}>{emptyValue}</span>;
  }

  const handleCopy = async () => {
    try {
      await writeClipboard(normalized);
      setCopied(true);
      toast.success(t("copyable.copiedValue", { label }));
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error(t("copyable.copyFailed"));
    }
  };

  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1.5", className)}>
      <span className={cx("min-w-0 truncate", valueClassName)} title={normalized}>
        {display}
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void handleCopy();
        }}
        className={cx(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#71767b] transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/30",
          buttonClassName
        )}
        aria-label={t("copyable.copyValue", { label })}
        title={t("copyable.copyValue", { label })}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </span>
  );
}
