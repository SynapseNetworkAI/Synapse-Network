"use client";

import { ArrowUpRight, History } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { type RefundIntentRecord } from "@/utils/balanceApi";
import { getTransactionExplorerUrl } from "@/utils/explorer";
import { moneyStringToNumber } from "@/utils/money";

type Translate = ReturnType<typeof useLanguage>["t"];

type ConsumerWithdrawHistoryTableProps = {
  loadingWithdrawals: boolean;
  withdrawals: RefundIntentRecord[];
  t: Translate;
};

function formatDateLabel(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function statusKey(status?: string | null): string {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "COMPLETED") return "consumerWithdrawPage.statusCompleted";
  if (normalized === "FAILED" || normalized === "FAILED_EXPIRED") {
    return "consumerWithdrawPage.statusFailed";
  }
  if (normalized === "PENDING_MANUAL_REVIEW") {
    return "consumerWithdrawPage.statusReview";
  }
  if (
    normalized === "REQUESTED" ||
    normalized === "SIGNED" ||
    normalized === "TICKET_READY"
  ) {
    return "consumerWithdrawPage.statusReady";
  }
  return "consumerWithdrawPage.statusProcessing";
}

function ConsumerWithdrawHistoryRow({
  row,
  t,
}: Readonly<{ row: RefundIntentRecord; t: Translate }>) {
  const explorerUrl = getTransactionExplorerUrl(row.txHash);
  return (
    <tr className="border-b border-[#191919] last:border-0">
      <td className="px-5 py-4 font-mono text-white">
        {moneyStringToNumber(row.amountUsdc ?? "0").toFixed(2)} USDC
      </td>
      <td className="px-5 py-4 text-[#9ca3af]">{t(statusKey(row.status))}</td>
      <td className="px-5 py-4 text-[#9ca3af]">
        {formatDateLabel(row.createdAt ?? row.updatedAt)}
      </td>
      <td className="px-5 py-4">
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[#60a5fa] hover:text-[#93c5fd]"
          >
            {t("consumerWithdrawPage.historyOpen")}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        ) : (
          <span className="text-[#71767b]">--</span>
        )}
      </td>
    </tr>
  );
}

export default function ConsumerWithdrawHistoryTable({
  loadingWithdrawals,
  withdrawals,
  t,
}: Readonly<ConsumerWithdrawHistoryTableProps>) {
  return (
    <section className="mt-8 rounded-[16px] border border-[#2f3336] bg-[#111]">
      <div className="flex items-center gap-2 border-b border-[#232323] px-5 py-4">
        <History className="h-4 w-4 text-[#60a5fa]" />
        <h2 className="text-[16px] font-semibold text-white">
          {t("consumerWithdrawPage.historyTitle")}
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="text-[#71767b]">
            <tr className="border-b border-[#232323]">
              <th className="px-5 py-3 font-medium">
                {t("consumerWithdrawPage.historyAmount")}
              </th>
              <th className="px-5 py-3 font-medium">
                {t("consumerWithdrawPage.historyStatus")}
              </th>
              <th className="px-5 py-3 font-medium">
                {t("consumerWithdrawPage.historyDate")}
              </th>
              <th className="px-5 py-3 font-medium">
                {t("consumerWithdrawPage.historyReceipt")}
              </th>
            </tr>
          </thead>
          <tbody>
            {loadingWithdrawals || withdrawals.length === 0 ? (
              <tr>
                <td className="px-5 py-6 text-[#9ca3af]" colSpan={4}>
                  {loadingWithdrawals
                    ? t("consumerWithdrawPage.historyLoading")
                    : t("consumerWithdrawPage.historyEmpty")}
                </td>
              </tr>
            ) : (
              withdrawals
                .slice(0, 10)
                .map((row) => (
                  <ConsumerWithdrawHistoryRow key={row.id} row={row} t={t} />
                ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
