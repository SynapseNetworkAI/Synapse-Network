"use client";

import { LifeBuoy, Mail, MessageSquareMore } from "lucide-react";

import {
  buildSupportMailto,
  getSupportEmail,
  getSupportPortalUrl,
} from "@/utils/supportContact";

type SupportContactPanelProps = {
  title: string;
  description: string;
  actionLabel: string;
  className?: string;
  subject?: string;
};

export default function SupportContactPanel({
  title,
  description,
  actionLabel,
  className = "",
  subject,
}: Readonly<SupportContactPanelProps>) {
  const supportEmail = getSupportEmail();
  const supportPortalUrl = getSupportPortalUrl();
  const supportMailto = buildSupportMailto(subject);
  const actionHref = supportPortalUrl || supportMailto;

  return (
    <div
      className={`rounded-2xl border border-[#2f3336] bg-[#111317] p-4 text-sm text-[#9ca3af] shadow-[0_0_0_1px_rgba(255,255,255,0.02)] ${className}`.trim()}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-white">
            <LifeBuoy className="h-4 w-4 text-[#7dd3fc]" />
            <p className="text-sm font-semibold">{title}</p>
          </div>
          <p className="mt-2 leading-6">{description}</p>
          {supportEmail ? (
            <p className="mt-2 flex items-center gap-2 text-xs text-[#cbd5e1]">
              <Mail className="h-3.5 w-3.5 text-[#7dd3fc]" />
              <span>{supportEmail}</span>
            </p>
          ) : null}
        </div>
        {actionHref ? (
          <a
            href={actionHref}
            target={supportPortalUrl ? "_blank" : undefined}
            rel={supportPortalUrl ? "noreferrer" : undefined}
            className="inline-flex min-h-[40px] min-w-[180px] items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
          >
            <MessageSquareMore className="h-4 w-4" />
            {actionLabel}
          </a>
        ) : (
          <div className="rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs text-amber-200">
            Configure `NEXT_PUBLIC_SUPPORT_EMAIL` or `NEXT_PUBLIC_SUPPORT_PORTAL_URL`.
          </div>
        )}
      </div>
    </div>
  );
}
