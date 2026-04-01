"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { XDatePicker } from "@/components/xui/XDatePicker";
import { useFundsData } from "@/hooks/useFundsData";

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDateLabel(timestamp: number, lang: string): string {
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  return new Date(timestamp).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
}

function paymentMethodForRecord(type: string): string {
  if (type === "Refund" || type === "Claim") {
    return "Voucher";
  }
  return "Wallet";
}

function transactionIdForRecord(id: string): string {
  if (id.length <= 8) {
    return id;
  }
  return `${id.slice(0, 2)}...${id.slice(-4)}`;
}

export default function OwnerBillingPage() {
  const { t, lang } = useLanguage();
  const { records, loading } = useFundsData();
  const today = useMemo(() => formatDateInput(new Date()), []);
  const [fromDate, setFromDate] = useState("2026-01-01");
  const [toDate, setToDate] = useState(today);

  const filteredRecords = useMemo(() => {
    const from = new Date(`${fromDate}T00:00:00`).getTime();
    const to = new Date(`${toDate}T23:59:59`).getTime();
    return records.filter((row) => row.timestamp >= from && row.timestamp <= to);
  }, [fromDate, records, toDate]);

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
    <div className="mx-auto w-full max-w-[1040px] px-8 py-10">
      <div className="border-b border-white/8 pb-9">
        <h1 className="text-[43px] font-semibold tracking-[-0.04em] text-white">{t("billingPage.title")}</h1>
        <p className="mt-3 text-[18px] text-[#8b98b4]">{t("billingPage.description")}</p>
      </div>

      <section className="mt-12 rounded-[18px] border border-white/10 bg-[#1f1f1f] px-4 py-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
        <div className="rounded-[12px] border border-white/10 bg-[#232323] px-10 py-9">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_320px_1fr] lg:items-end">
            <div>
              <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#8b98b4]">{t("billingPage.fromLabel")}</p>
              <XDatePicker
                value={fromDate}
                onChange={handleFromDateChange}
                max={today}
                ariaLabel={t("billingPage.fromLabel")}
              />
            </div>

            <div>
              <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#8b98b4]">{t("billingPage.toLabel")}</p>
              <XDatePicker
                value={toDate}
                onChange={handleToDateChange}
                min={fromDate}
                max={today}
                ariaLabel={t("billingPage.toLabel")}
              />
            </div>

            <button
              type="button"
              onClick={() => {
                setFromDate("2026-01-01");
                setToDate(today);
              }}
              className="h-11 justify-self-start text-[14px] font-medium text-[#5f6468] transition hover:text-[#8b98b4] lg:justify-self-end lg:text-right"
            >
              {t("billingPage.resetRange")}
            </button>
          </div>

          <div className="mt-8 overflow-hidden rounded-[8px]">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-white/10 text-[12px] font-medium text-white">
                  <th className="px-4 py-4">{t("billingPage.tableTransactionId")}</th>
                  <th className="px-4 py-4">{t("billingPage.tableStatus")}</th>
                  <th className="px-4 py-4">{t("billingPage.tablePaymentMethod")}</th>
                  <th className="px-4 py-4">{t("billingPage.tableAmount")}</th>
                  <th className="px-4 py-4">{t("billingPage.tableDate")}</th>
                  <th className="px-4 py-4 text-right">{t("billingPage.tableInvoice")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr className="border-b border-white/10">
                    <td colSpan={6} className="px-4 py-8 text-center text-[15px] text-[#8b98b4]">
                      {t("billingPage.loading")}
                    </td>
                  </tr>
                ) : filteredRecords.length === 0 ? (
                  <tr className="border-b border-white/10">
                    <td colSpan={6} className="px-4 py-8 text-center text-[15px] text-[#8b98b4]">
                      {t("billingPage.empty")}
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((row) => {
                    const isSuccess = row.status === "COMPLETED";
                    return (
                      <tr key={row.id} className="border-b border-white/8 text-[15px] text-white last:border-b-0">
                        <td className="px-4 py-5 font-mono font-semibold text-[#dfe3e6]">{transactionIdForRecord(row.id)}</td>
                        <td className="px-4 py-5">
                          <span className={isSuccess ? "font-semibold text-[#35d07f]" : row.status === "FAILED" ? "font-semibold text-[#ff6b6b]" : "font-semibold text-[#f3b24d]"}>
                            {row.status === "COMPLETED"
                              ? t("billingPage.statusSucceeded")
                              : row.status === "FAILED"
                                ? t("billingPage.statusFailed")
                                : t("billingPage.statusPending")}
                          </span>
                        </td>
                        <td className="px-4 py-5">
                          <span className="inline-flex rounded-[6px] bg-white/8 px-3 py-1 text-[14px] text-[#dfe3e6]">
                            {paymentMethodForRecord(row.type)}
                          </span>
                        </td>
                        <td className="px-4 py-5 font-semibold text-white">${row.amount.toFixed(2)}</td>
                        <td className="px-4 py-5 text-[#dfe3e6]">{formatDateLabel(row.timestamp, lang)}</td>
                        <td className="px-4 py-5 text-right">
                          {row.txHash ? (
                            <a
                              href={`https://etherscan.io/tx/${row.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center justify-end text-[#8b98b4] transition hover:text-white"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          ) : (
                            <span className="text-[#5f6468]">--</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
