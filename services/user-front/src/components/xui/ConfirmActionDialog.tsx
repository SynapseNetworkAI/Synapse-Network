"use client";

import { AlertTriangle } from "lucide-react";
import { XButton } from "@/components/xui/XButton";
import {
  XDialog,
  XDialogBody,
  XDialogCloseButton,
  XDialogFooter,
  XDialogHeader,
  XDialogHeaderCopy,
  XDialogSurface,
} from "@/components/xui/XDialog";
import { XPanel } from "@/components/xui/XPanel";

type ConfirmActionTone = "default" | "danger";

export type ConfirmActionDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmActionTone;
  contextLabel?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export default function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  contextLabel,
  loading = false,
  onCancel,
  onConfirm,
}: Readonly<ConfirmActionDialogProps>) {
  return (
    <XDialog open={open} ariaLabelledby="confirm-action-title" onDismiss={loading ? undefined : onCancel}>
      <XDialogSurface className="max-w-[520px]">
        <XDialogHeader>
          <XDialogHeaderCopy>
            <p className="x-data-label mb-2 text-gray-500">
              {tone === "danger" ? "Destructive confirmation" : "Action confirmation"}
            </p>
            <h2 id="confirm-action-title" className="x-modal-title text-white">
              {title}
            </h2>
            <p className="x-body-copy mt-3 text-gray-400">{description}</p>
          </XDialogHeaderCopy>
          <XDialogCloseButton onClick={onCancel} disabled={loading} />
        </XDialogHeader>

        {contextLabel ? (
          <XDialogBody>
            <XPanel as="article" variant="muted" className="flex items-center gap-3 rounded-[20px] p-4">
              <AlertTriangle className={tone === "danger" ? "h-5 w-5 text-red-400" : "h-5 w-5 text-amber-300"} />
              <span className="font-mono text-sm text-gray-200">{contextLabel}</span>
            </XPanel>
          </XDialogBody>
        ) : null}

        <XDialogFooter className="justify-center border-t-0 pt-0">
          <XButton variant="ghost" size="modal" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </XButton>
          <XButton
            type="button"
            variant={tone === "danger" ? "danger" : "primary"}
            size="modal"
            onClick={() => void onConfirm()}
            disabled={loading}
          >
            {loading ? "Working..." : confirmLabel}
          </XButton>
        </XDialogFooter>
      </XDialogSurface>
    </XDialog>
  );
}
