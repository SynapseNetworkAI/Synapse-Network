import {
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCcw,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import type { LedgerRecord } from "@/hooks/useFundsData";
import { getTransactionExplorerUrl } from "@/utils/explorer";

function getStatusDot(status: LedgerRecord["status"]) {
  if (status === "PENDING") {
    return (
      <>
        <span className="absolute inline-flex w-full h-full rounded-full opacity-75 bg-amber-400 animate-ping"></span>
        <span className="relative inline-flex rounded-full w-2 h-2 bg-amber-500"></span>
      </>
    );
  }

  if (status === "FAILED") {
    return (
      <span className="relative inline-flex w-2 h-2 bg-red-500 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span>
    );
  }

  return (
    <span className="relative inline-flex w-2 h-2 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.8)]"></span>
  );
}

function getAmountTone(isFailed: boolean, isPositive: boolean): string {
  if (isFailed) {
    return "text-gray-500 line-through";
  }
  return isPositive ? "text-green-400" : "text-orange-400";
}

function getAmountPrefix(isFailed: boolean, isPositive: boolean): string {
  if (isFailed) {
    return "";
  }
  return isPositive ? "+" : "-";
}

function StatusCell({
  isFailed,
  isPending,
  label,
  failureReason,
  failedLabel,
}: Readonly<{
  isFailed: boolean;
  isPending: boolean;
  label: string;
  failureReason?: string;
  failedLabel: string;
}>) {
  let statusTone: LedgerRecord["status"] = "COMPLETED";
  if (isFailed) {
    statusTone = "FAILED";
  } else if (isPending) {
    statusTone = "PENDING";
  }

  return (
    <div className="flex items-center space-x-2">
      <span className="relative flex w-2 h-2">{getStatusDot(statusTone)}</span>
      {isFailed ? (
        <div className="flex items-center space-x-1 group relative">
          <span className="text-xs tracking-wider text-red-500 font-bold">
            {label}
          </span>
          <AlertCircle className="w-3 h-3 text-red-400 opacity-60 flex-shrink-0 cursor-help" />
          <div className="absolute left-0 mt-5 w-48 hidden group-hover:block z-50 p-2 text-xs text-white bg-gray-900 border border-red-500/50 rounded-lg shadow-xl shadow-black/50 overflow-hidden whitespace-normal break-words">
            {failureReason || failedLabel}
          </div>
        </div>
      ) : (
        <span
          className={`text-xs tracking-wider ${
            isPending ? "text-amber-400" : "text-green-500"
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
}

function LedgerRecordRow({
  row,
  actionLabel,
  statusLabel,
  failedLabel,
  noTransactionLabel,
  locale,
}: Readonly<{
  row: LedgerRecord;
  actionLabel: string;
  statusLabel: string;
  failedLabel: string;
  noTransactionLabel: string;
  locale: string;
}>) {
  const isPositive = row.type === "Deposit" || row.type === "Refund";
  const isPending = row.status === "PENDING";
  const isFailed = row.status === "FAILED";
  const amountTone = getAmountTone(isFailed, isPositive);
  const amountPrefix = getAmountPrefix(isFailed, isPositive);
  const txHash = row.txHash ?? "";
  const transactionExplorerUrl = getTransactionExplorerUrl(txHash);

  return (
    <tr key={row.id} className="transition-colors hover:bg-gray-800/30">
      <td className="px-6 py-4 text-gray-300">
        {new Date(row.timestamp).toLocaleString(locale)}
      </td>
      <td className="px-6 py-4">
        <span
          className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
            isPositive
              ? "bg-green-500/10 text-green-400 border border-green-500/20"
              : "bg-orange-500/10 text-orange-400 border border-orange-500/20"
          }`}
        >
          {isPositive ? (
            <ArrowDownRight className="w-3 h-3 mr-1" />
          ) : (
            <ArrowUpRight className="w-3 h-3 mr-1" />
          )}
          {actionLabel}
        </span>
      </td>
      <td className="px-6 py-4">
        <StatusCell
          isFailed={isFailed}
          isPending={isPending}
          label={statusLabel}
          failureReason={row.failureReason}
          failedLabel={failedLabel}
        />
      </td>
      <td className="px-6 py-4">
        <span className={`font-mono ${amountTone}`}>
          {amountPrefix}
          {row.amount.toFixed(4)}
        </span>
      </td>
      <td className="px-6 py-4 font-mono text-xs text-right">
        {transactionExplorerUrl ? (
          <a
            href={transactionExplorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center text-blue-400 hover:text-blue-300"
          >
            {txHash.slice(0, 10)}...{txHash.slice(-8)}
            <ExternalLink className="w-3 h-3 ml-1" />
          </a>
        ) : (
          <span className="text-gray-600">{noTransactionLabel}</span>
        )}
      </td>
    </tr>
  );
}

export default function FundsLedgerTable({
  loading,
  records,
}: Readonly<{
  loading: boolean;
  records: LedgerRecord[];
}>) {
  const { t, lang } = useLanguage();
  const locale = lang === "zh" ? "zh-CN" : "en-US";

  const actionLabelMap: Record<LedgerRecord["type"], string> = {
    Deposit: t("billingPage.actionDeposit"),
    Withdraw: t("billingPage.actionWithdraw"),
    Refund: t("billingPage.actionRefund"),
    Claim: t("billingPage.actionClaim"),
  };

  const statusLabelMap: Record<LedgerRecord["status"], string> = {
    PENDING: t("billingPage.statusPending"),
    COMPLETED: t("billingPage.statusCompleted"),
    FAILED: t("billingPage.statusFailed"),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 border border-gray-800 rounded-xl bg-black/40">
        <Loader2 className="w-8 h-8 text-green-400 animate-spin" />
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-gray-400 border border-gray-800 rounded-xl bg-black/40">
        <p>{t("billingPage.noFundsFlow")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden border border-gray-800 rounded-xl bg-black/40">
      <div className="p-4 border-b border-gray-800 bg-gray-900/50">
        <h3 className="flex items-center text-lg font-semibold text-white">
          <RefreshCcw className="w-5 h-5 mr-2 text-green-400" />
          {t("billingPage.ledgerTitle")}
        </h3>
        <p className="mt-1 text-sm text-gray-400">
          {t("billingPage.ledgerDescription")}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-500 uppercase border-b border-gray-800 bg-gray-900/30">
            <tr>
              <th className="px-6 py-4">{t("billingPage.tableTime")}</th>
              <th className="px-6 py-4">{t("billingPage.tableActionType")}</th>
              <th className="px-6 py-4">{t("billingPage.tableStatus")}</th>
              <th className="px-6 py-4">{t("billingPage.tableAmount")}</th>
              <th className="px-6 py-4 text-right">
                {t("billingPage.tableTransaction")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {records.map((row) => (
              <LedgerRecordRow
                key={row.id}
                row={row}
                actionLabel={actionLabelMap[row.type]}
                statusLabel={statusLabelMap[row.status]}
                failedLabel={t("billingPage.transactionFailed")}
                noTransactionLabel={t("billingPage.noTransaction")}
                locale={locale}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
