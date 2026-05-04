"use client";

import { ShieldCheck, X } from "lucide-react";

type IntentRow = {
  label: string;
  value: string;
};

type WalletActionIntentDialogProps = {
  open: boolean;
  title: string;
  description: string;
  rows: IntentRow[];
  checklistTitle?: string;
  checklist?: string[];
  cancelLabel: string;
  continueLabel: string;
  closeLabel: string;
  onCancel: () => void;
  onContinue: () => void;
};

export default function WalletActionIntentDialog({
  open,
  title,
  description,
  rows,
  checklistTitle,
  checklist = [],
  cancelLabel,
  continueLabel,
  closeLabel,
  onCancel,
  onContinue,
}: Readonly<WalletActionIntentDialogProps>) {
  if (!open) return null;

  return (
    <dialog
      open
      className="x-dialog-shell x-modal-overlay"
      aria-labelledby="wallet-action-intent-title"
    >
      <section className="x-modal-flat x-modal-surface max-w-lg shadow-2xl">
        <header className="x-modal-header">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-2 text-emerald-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3
                id="wallet-action-intent-title"
                className="text-lg font-bold text-white"
              >
                {title}
              </h3>
              <p className="mt-1 text-sm leading-6 text-[#9ca3af]">
                {description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="x-modal-close"
            aria-label={closeLabel}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="x-modal-body space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <dl className="space-y-3 text-sm">
              {rows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-start justify-between gap-4"
                >
                  <dt className="shrink-0 text-[#86868b]">{row.label}</dt>
                  <dd className="break-all text-right font-mono text-white">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {checklist.length > 0 ? (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4">
              {checklistTitle ? (
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                  {checklistTitle}
                </p>
              ) : null}
              <ul className="mt-3 space-y-2 text-sm leading-6 text-[#c5c5c7]">
                {checklist.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="x-button-ghost x-modal-action x-modal-action-secondary text-sm font-semibold"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onContinue}
              className="x-button-primary x-modal-action x-modal-action-primary text-sm font-bold"
            >
              {continueLabel}
            </button>
          </div>
        </div>
      </section>
    </dialog>
  );
}
