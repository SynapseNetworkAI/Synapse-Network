"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import CopyableValue from "@/components/xui/CopyableValue";
import { XDatePicker } from "@/components/xui/XDatePicker";
import { PAYMENTS_RENDER_LIMIT, useFundsData } from "@/hooks/useFundsData";
import { getTransactionExplorerUrl } from "@/utils/explorer";
import { nowDateTimeString } from "@/utils/time";

type Translate = (key: string) => string;
type BillingRecord = ReturnType<typeof useFundsData>["records"][number];

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDateLabel(timestamp: number): string {
  return nowDateTimeString(new Date(timestamp));
}

function paymentMethodForRecord(type: string, t: Translate): string {
  if (type === "Refund" || type === "Claim") {
    return t("billingPage.paymentMethodVoucher");
  }
  return t("billingPage.paymentMethodWallet");
}

function typeLabelForRecord(
  type: string,
  t: Translate
): { label: string; cls: string } {
  if (type === "Withdraw") {
    return { label: t("billingPage.actionWithdraw"), cls: "text-orange-400" };
  }
  if (type === "Refund") {
    return { label: t("billingPage.actionRefund"), cls: "text-sky-400" };
  }
  if (type === "Claim") {
    return { label: t("billingPage.actionClaim"), cls: "text-purple-400" };
  }
  return { label: t("billingPage.actionDeposit"), cls: "text-green-400" };
}

function formatBillingAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) {
    return "$0.00";
  }
  return `$${amount.toFixed(2)}`;
}

function statusDisplay(
  row: BillingRecord,
  t: (key: string) => string
): {
  className: string;
  label: string;
} {
  if (row.status === "COMPLETED") {
    return {
      className: "font-medium text-[#35d07f]",
      label: t("billingPage.statusSucceeded"),
    };
  }
  if (row.status === "FAILED") {
    return {
      className: "font-medium text-[#ff6b6b]",
      label: t("billingPage.statusFailed"),
    };
  }
  if (row.type === "Withdraw") {
    return {
      className: "font-medium text-[#f3b24d]",
      label: t("billingPage.statusWithdrawPending"),
    };
  }
  return {
    className: "font-medium text-[#f3b24d]",
    label: t("billingPage.statusPendingSyncing"),
  };
}

function transactionIdForRecord(id: string): string {
  if (id.length <= 8) {
    return id;
  }
  return `${id.slice(0, 2)}...${id.slice(-4)}`;
}

function BillingTableMessage({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <tr className="border-b border-[#232323]">
      <td
        colSpan={7}
        className="px-4 py-8 text-center text-[15px] leading-6 text-[#9ca3af]"
      >
        {children}
      </td>
    </tr>
  );
}

function BillingRecordRow({
  row,
  t,
}: Readonly<{
  row: BillingRecord;
  t: Translate;
}>) {
  const status = statusDisplay(row, t);
  const type = typeLabelForRecord(row.type, t);
  const transactionExplorerUrl = getTransactionExplorerUrl(row.txHash);

  return (
    <tr key={row.id} className="border-b border-[#232323] last:border-b-0">
      <td className="px-4 py-4 font-mono text-[16px] font-medium leading-6 text-white">
        <CopyableValue
          value={row.id}
          displayValue={transactionIdForRecord(row.id)}
          label={t("billingPage.tableTransactionId")}
          valueClassName="text-white"
          startChars={2}
          endChars={4}
        />
      </td>
      <td className="px-4 py-4 text-[16px] leading-6">
        <span className={status.className}>{status.label}</span>
      </td>
      <td className="px-4 py-4 text-[14px] leading-6">
        <span className={`font-medium ${type.cls}`}>{type.label}</span>
      </td>
      <td className="hidden px-4 py-4 text-[16px] leading-6 text-[#71767b] sm:table-cell">
        {paymentMethodForRecord(row.type, t)}
      </td>
      <td className="px-4 py-4 text-[16px] leading-6 text-white">
        {formatBillingAmount(row.amount)}
      </td>
      <td className="px-4 py-4 text-[16px] leading-6 text-[#71767b]">
        {formatDateLabel(row.timestamp)}
      </td>
      <td className="px-4 py-4 text-right">
        {row.txHash ? (
          <span className="inline-flex items-center justify-end gap-1">
            <CopyableValue
              value={row.txHash}
              displayValue=""
              label={t("billingPage.transactionHashLabel")}
              className="gap-0"
              valueClassName="sr-only"
            />
            {transactionExplorerUrl ? (
              <a
                href={transactionExplorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#71767b] transition hover:bg-white/10 hover:text-white"
                aria-label={t("billingPage.openTransactionExplorer")}
                title={t("billingPage.openTransactionExplorer")}
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
          </span>
        ) : (
          <span className="text-[#5f6468]">--</span>
        )}
      </td>
    </tr>
  );
}

function BillingTableHeader({ t }: Readonly<{ t: Translate }>) {
  return (
    <thead>
      <tr className="border-b border-[#373737]">
        <th className="px-4 py-3 text-left text-[14px] font-medium leading-[20px] text-[#d1d5db]">
          {t("billingPage.tableTransactionId")}
        </th>
        <th className="px-4 py-3 text-left text-[14px] font-medium leading-[20px] text-[#d1d5db]">
          {t("billingPage.tableStatus")}
        </th>
        <th className="px-4 py-3 text-left text-[14px] font-medium leading-[20px] text-[#d1d5db]">
          {t("billingPage.tableType")}
        </th>
        <th className="hidden px-4 py-3 text-left text-[14px] font-medium leading-[20px] text-[#d1d5db] sm:table-cell">
          {t("billingPage.tablePaymentMethod")}
        </th>
        <th className="px-4 py-3 text-left text-[14px] font-medium leading-[20px] text-[#d1d5db]">
          {t("billingPage.tableAmount")}
        </th>
        <th className="px-4 py-3 text-left text-[14px] font-medium leading-[20px] text-[#d1d5db]">
          {t("billingPage.tableDate")}
        </th>
        <th className="px-4 py-3 text-right text-[14px] font-medium leading-[20px] text-[#d1d5db]">
          {t("billingPage.tableInvoice")}
        </th>
      </tr>
    </thead>
  );
}

function BillingIntro({ t }: Readonly<{ t: Translate }>) {
  return (
    <div className="border-b border-[#2f3336] pb-8">
      <h1 className="text-[24px] font-normal leading-[32px] tracking-[-0.01em] text-white">
        {t("billingPage.title")}
      </h1>
      <p className="mt-2 text-[16px] leading-[24px] text-[#9ca3af]">
        {t("billingPage.description")}
      </p>
      <p className="mt-3 text-[13px] leading-5 text-[#71767b]">
        {t("billingPage.depositStatusHint")}
      </p>
      <p className="mt-1 text-[13px] leading-5 text-[#71767b]">
        {t("billingPage.networkFeeHint")}
      </p>
    </div>
  );
}

function BillingDateFilters({
  fromDate,
  toDate,
  today,
  onFromDateChange,
  onToDateChange,
  onReset,
  t,
}: Readonly<{
  fromDate: string;
  toDate: string;
  today: string;
  onFromDateChange: (nextValue: string) => void;
  onToDateChange: (nextValue: string) => void;
  onReset: () => void;
  t: Translate;
}>) {
  const datePickerCopy = {
    previousMonthLabel: t("billingPage.datePickerPreviousMonth"),
    nextMonthLabel: t("billingPage.datePickerNextMonth"),
    todayLabel: t("billingPage.datePickerToday"),
    locale: t("billingPage.datePickerLocale"),
  };

  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="flex w-full flex-col gap-2 sm:max-w-xs">
        <p className="text-[12px] font-medium uppercase leading-[16px] tracking-[0.08em] text-[#a3a3a3]">
          {t("billingPage.fromLabel")}
        </p>
        <XDatePicker
          value={fromDate}
          onChange={onFromDateChange}
          max={today}
          ariaLabel={t("billingPage.fromLabel")}
          triggerVariant="payments"
          {...datePickerCopy}
        />
      </div>

      <div className="flex w-full flex-col gap-2 sm:max-w-xs">
        <p className="text-[12px] font-medium uppercase leading-[16px] tracking-[0.08em] text-[#a3a3a3]">
          {t("billingPage.toLabel")}
        </p>
        <XDatePicker
          value={toDate}
          onChange={onToDateChange}
          min={fromDate}
          max={today}
          ariaLabel={t("billingPage.toLabel")}
          triggerVariant="payments"
          {...datePickerCopy}
        />
      </div>

      <button
        type="button"
        onClick={onReset}
        className="mt-2 h-8 w-full rounded-[6px] px-3 text-[14px] font-normal leading-[20px] text-[#6b7280] transition hover:bg-white/10 hover:text-[#9ca3af] sm:ml-auto sm:mt-0 sm:w-auto"
      >
        {t("billingPage.resetRange")}
      </button>
    </div>
  );
}

export default function OwnerBillingPage() {
  const { t } = useLanguage();
  const { records, loading, paymentHistoryMayBeTruncated } = useFundsData();
  const today = useMemo(() => formatDateInput(new Date()), []);
  const [fromDate, setFromDate] = useState("2026-01-01");
  const [toDate, setToDate] = useState(today);

  const filteredRecords = useMemo(() => {
    const from = new Date(`${fromDate}T00:00:00`).getTime();
    const to = new Date(`${toDate}T23:59:59`).getTime();
    return records.filter(
      (row) => row.timestamp >= from && row.timestamp <= to
    );
  }, [fromDate, records, toDate]);
  const visibleRecords = useMemo(
    () => filteredRecords.slice(0, PAYMENTS_RENDER_LIMIT),
    [filteredRecords]
  );
  const showHistoryLimitHint =
    paymentHistoryMayBeTruncated ||
    filteredRecords.length > PAYMENTS_RENDER_LIMIT;

  const tableRows = useMemo(() => {
    if (loading) {
      return (
        <BillingTableMessage>{t("billingPage.loading")}</BillingTableMessage>
      );
    }

    if (visibleRecords.length === 0) {
      return (
        <BillingTableMessage>{t("billingPage.empty")}</BillingTableMessage>
      );
    }

    return visibleRecords.map((row) => (
      <BillingRecordRow key={row.id} row={row} t={t} />
    ));
  }, [loading, t, visibleRecords]);

  const handleFromDateChange = (nextValue: string) => {
    setFromDate(nextValue);
    if (nextValue > toDate) {
      setToDate(nextValue);
    }
  };

  const handleToDateChange = (nextValue: string) => {
    setToDate(nextValue);
    if (nextValue < fromDate) {
      setFromDate(nextValue);
    }
  };

  const handleResetRange = () => {
    setFromDate("2026-01-01");
    setToDate(today);
  };

  return (
    <div className="mx-auto w-full max-w-[1024px] px-4 pb-24 pt-12 sm:px-6 lg:px-0">
      <BillingIntro t={t} />

      <section className="py-8">
        <div className="rounded-[12px] border border-[#232323] bg-[#0d0d0d] p-4">
          <div className="rounded-[8px] border border-[#323232] bg-[#1a1a1a] p-6">
            <BillingDateFilters
              fromDate={fromDate}
              toDate={toDate}
              today={today}
              onFromDateChange={handleFromDateChange}
              onToDateChange={handleToDateChange}
              onReset={handleResetRange}
              t={t}
            />

            <div className="overflow-x-auto overflow-y-visible -mx-2 sm:mx-0">
              <table className="relative w-full min-w-[600px] sm:min-w-0">
                <BillingTableHeader t={t} />
                <tbody>{tableRows}</tbody>
              </table>
            </div>
            {showHistoryLimitHint ? (
              <p className="mt-4 text-[13px] leading-5 text-[#71767b]">
                {t("billingPage.historyLimitHint", {
                  count: PAYMENTS_RENDER_LIMIT,
                })}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
