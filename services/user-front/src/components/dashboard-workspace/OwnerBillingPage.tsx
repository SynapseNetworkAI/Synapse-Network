"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { XDatePicker } from "@/components/xui/XDatePicker";
import { useFundsData } from "@/hooks/useFundsData";
import { nowDateTimeString } from "@/utils/time";

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDateLabel(timestamp: number): string {
  return nowDateTimeString(new Date(timestamp));
}

function paymentMethodForRecord(type: string): string {
  if (type === "Refund" || type === "Claim") {
    return "Voucher";
  }
  return "Wallet";
}

function typeLabelForRecord(type: string): { label: string; cls: string } {
  if (type === "Withdraw") return { label: "Withdraw", cls: "text-orange-400" };
  if (type === "Refund")   return { label: "Refund",   cls: "text-sky-400" };
  if (type === "Claim")    return { label: "Claim",    cls: "text-purple-400" };
  return { label: "Deposit", cls: "text-green-400" };
}

function statusDisplay(status: string, t: (key: string) => string): {
  className: string;
  label: string;
} {
  if (status === "COMPLETED") {
    return {
      className: "font-medium text-[#35d07f]",
      label: t("billingPage.statusSucceeded"),
    };
  }
  if (status === "FAILED") {
    return {
      className: "font-medium text-[#ff6b6b]",
      label: t("billingPage.statusFailed"),
    };
  }
  return {
    className: "font-medium text-[#f3b24d]",
    label: t("billingPage.statusPending"),
  };
}

function transactionIdForRecord(id: string): string {
  if (id.length <= 8) {
    return id;
  }
  return `${id.slice(0, 2)}...${id.slice(-4)}`;
}

export default function OwnerBillingPage() {
  const { t } = useLanguage();
  const { records, loading } = useFundsData();
  const today = useMemo(() => formatDateInput(new Date()), []);
  const [fromDate, setFromDate] = useState("2026-01-01");
  const [toDate, setToDate] = useState(today);

  const filteredRecords = useMemo(() => {
    const from = new Date(`${fromDate}T00:00:00`).getTime();
    const to = new Date(`${toDate}T23:59:59`).getTime();
    return records.filter((row) => row.timestamp >= from && row.timestamp <= to);
  }, [fromDate, records, toDate]);

  const tableRows = useMemo(() => {
    if (loading) {
      return (
        <tr className="border-b border-[#232323]">
          <td
            colSpan={7}
            className="px-4 py-8 text-center text-[15px] leading-6 text-[#9ca3af]"
          >
            {t("billingPage.loading")}
          </td>
        </tr>
      );
    }

    if (filteredRecords.length === 0) {
      return (
        <tr className="border-b border-[#232323]">
          <td
            colSpan={7}
            className="px-4 py-8 text-center text-[15px] leading-6 text-[#9ca3af]"
          >
            {t("billingPage.empty")}
          </td>
        </tr>
      );
    }

    return filteredRecords.map((row) => {
      const status = statusDisplay(row.status, t);
      const type = typeLabelForRecord(row.type);

      return (
        <tr
          key={row.id}
          className="border-b border-[#232323] last:border-b-0"
        >
          <td className="px-4 py-4 font-mono text-[16px] font-medium leading-6 text-white">
            {transactionIdForRecord(row.id)}
          </td>
          <td className="px-4 py-4 text-[16px] leading-6">
            <span className={status.className}>{status.label}</span>
          </td>
          <td className="px-4 py-4 text-[14px] leading-6">
            <span className={`font-medium ${type.cls}`}>{type.label}</span>
          </td>
          <td className="hidden px-4 py-4 text-[16px] leading-6 text-[#71767b] sm:table-cell">
            {paymentMethodForRecord(row.type)}
          </td>
          <td className="px-4 py-4 text-[16px] leading-6 text-white">
            ${row.amount.toFixed(2)}
          </td>
          <td className="px-4 py-4 text-[16px] leading-6 text-[#71767b]">
            {formatDateLabel(row.timestamp)}
          </td>
          <td className="px-4 py-4 text-right">
            {row.txHash ? (
              <a
                href={`https://etherscan.io/tx/${row.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-end text-[#71767b] transition hover:text-white"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : (
              <span className="text-[#5f6468]">--</span>
            )}
          </td>
        </tr>
      );
    });
  }, [filteredRecords, loading, t]);

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

  return (
    <div className="mx-auto w-full max-w-[1024px] px-4 pb-24 pt-12 sm:px-6 lg:px-0">
      <div className="border-b border-[#2f3336] pb-8">
        <h1 className="text-[24px] font-normal leading-[32px] tracking-[-0.01em] text-white">
          {t("billingPage.title")}
        </h1>
        <p className="mt-2 text-[16px] leading-[24px] text-[#9ca3af]">
          {t("billingPage.description")}
        </p>
      </div>

      <section className="py-8">
        <div className="rounded-[12px] border border-[#232323] bg-[#0d0d0d] p-4">
          <div className="rounded-[8px] border border-[#323232] bg-[#1a1a1a] p-6">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="flex w-full flex-col gap-2 sm:max-w-xs">
                <p className="text-[12px] font-medium uppercase leading-[16px] tracking-[0.08em] text-[#a3a3a3]">
                  {t("billingPage.fromLabel")}
                </p>
                <XDatePicker
                  value={fromDate}
                  onChange={handleFromDateChange}
                  max={today}
                  ariaLabel={t("billingPage.fromLabel")}
                  triggerVariant="payments"
                />
              </div>

              <div className="flex w-full flex-col gap-2 sm:max-w-xs">
                <p className="text-[12px] font-medium uppercase leading-[16px] tracking-[0.08em] text-[#a3a3a3]">
                  {t("billingPage.toLabel")}
                </p>
                <XDatePicker
                  value={toDate}
                  onChange={handleToDateChange}
                  min={fromDate}
                  max={today}
                  ariaLabel={t("billingPage.toLabel")}
                  triggerVariant="payments"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setFromDate("2026-01-01");
                  setToDate(today);
                }}
                className="mt-2 h-8 w-full rounded-[6px] px-3 text-[14px] font-normal leading-[20px] text-[#6b7280] transition hover:bg-white/10 hover:text-[#9ca3af] sm:ml-auto sm:mt-0 sm:w-auto"
              >
                {t("billingPage.resetRange")}
              </button>
            </div>

            <div className="overflow-x-auto overflow-y-visible -mx-2 sm:mx-0">
              <table className="relative w-full min-w-[600px] sm:min-w-0">
                <thead>
                  <tr className="border-b border-[#373737]">
                    <th className="px-4 py-3 text-left text-[14px] font-medium leading-[20px] text-[#d1d5db]">
                      {t("billingPage.tableTransactionId")}
                    </th>
                    <th className="px-4 py-3 text-left text-[14px] font-medium leading-[20px] text-[#d1d5db]">
                      {t("billingPage.tableStatus")}
                    </th>
                    <th className="px-4 py-3 text-left text-[14px] font-medium leading-[20px] text-[#d1d5db]">
                      Type
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
                <tbody>{tableRows}</tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
