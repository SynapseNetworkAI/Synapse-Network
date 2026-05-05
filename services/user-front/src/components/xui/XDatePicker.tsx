"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "@/components/xui/cx";

type XDatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  max?: string;
  min?: string;
  ariaLabel: string;
  previousMonthLabel?: string;
  nextMonthLabel?: string;
  todayLabel?: string;
  locale?: string;
  className?: string;
  triggerVariant?: "default" | "payments";
};

type CalendarPopoverProps = {
  visibleMonth: Date;
  selectedDate: Date;
  days: Date[];
  minDate: Date | null;
  maxDate: Date | null;
  previousMonthLabel: string;
  nextMonthLabel: string;
  todayLabel: string;
  locale: string;
  onMonthChange: (month: Date) => void;
  onSelectDate: (date: Date) => void;
};

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTriggerLabel(value: string, locale: string): string {
  return parseDate(value).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMonthLabel(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
  });
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isSameMonth(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth()
  );
}

function monthKey(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

function buildCalendarDays(visibleMonth: Date): Date[] {
  const firstDay = startOfMonth(visibleMonth);
  const firstCell = new Date(firstDay);
  firstCell.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const cell = new Date(firstCell);
    cell.setDate(firstCell.getDate() + index);
    return cell;
  });
}

function CalendarPopover({
  visibleMonth,
  selectedDate,
  days,
  minDate,
  maxDate,
  previousMonthLabel,
  nextMonthLabel,
  todayLabel,
  locale,
  onMonthChange,
  onSelectDate,
}: Readonly<CalendarPopoverProps>) {
  const previousMonth = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() - 1,
    1
  );
  const nextMonth = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() + 1,
    1
  );
  const previousDisabled = minDate
    ? monthKey(previousMonth) < monthKey(startOfMonth(minDate))
    : false;
  const nextDisabled = maxDate
    ? monthKey(nextMonth) > monthKey(startOfMonth(maxDate))
    : false;

  return (
    <div className="x-date-popover">
      <div className="x-date-popover-header">
        <button
          type="button"
          className="x-date-nav"
          onClick={() => !previousDisabled && onMonthChange(previousMonth)}
          disabled={previousDisabled}
          aria-label={previousMonthLabel}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="x-date-month-label">
          {formatMonthLabel(visibleMonth, locale)}
        </p>
        <button
          type="button"
          className="x-date-nav"
          onClick={() => !nextDisabled && onMonthChange(nextMonth)}
          disabled={nextDisabled}
          aria-label={nextMonthLabel}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="x-date-weekdays">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="x-date-grid">
        {days.map((day) => (
          <CalendarDayButton
            key={formatDateValue(day)}
            day={day}
            visibleMonth={visibleMonth}
            selectedDate={selectedDate}
            minDate={minDate}
            maxDate={maxDate}
            onSelectDate={onSelectDate}
          />
        ))}
      </div>

      <div className="x-date-footer">
        <button
          type="button"
          className="x-date-footer-action"
          onClick={() => onSelectDate(maxDate ?? new Date())}
        >
          {todayLabel}
        </button>
      </div>
    </div>
  );
}

function CalendarDayButton({
  day,
  visibleMonth,
  selectedDate,
  minDate,
  maxDate,
  onSelectDate,
}: Readonly<{
  day: Date;
  visibleMonth: Date;
  selectedDate: Date;
  minDate: Date | null;
  maxDate: Date | null;
  onSelectDate: (date: Date) => void;
}>) {
  const beforeMin = minDate ? day < minDate : false;
  const afterMax = maxDate ? day > maxDate : false;
  const disabled = beforeMin || afterMax;
  const inMonth = isSameMonth(day, visibleMonth);
  const selected = isSameDay(day, selectedDate);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onSelectDate(day)}
      className={cx(
        "x-date-cell",
        !inMonth && "x-date-cell-outside",
        disabled && "x-date-cell-disabled",
        selected && "x-date-cell-selected"
      )}
    >
      {day.getDate()}
    </button>
  );
}

export function XDatePicker({
  value,
  onChange,
  max,
  min,
  ariaLabel,
  previousMonthLabel = "Previous month",
  nextMonthLabel = "Next month",
  todayLabel = "Today",
  locale = "en-US",
  className,
  triggerVariant = "default",
}: Readonly<XDatePickerProps>) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(parseDate(value))
  );

  const selectedDate = useMemo(() => parseDate(value), [value]);
  const minDate = useMemo(() => (min ? parseDate(min) : null), [min]);
  const maxDate = useMemo(() => (max ? parseDate(max) : null), [max]);
  const days = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);

  useEffect(() => {
    if (open) {
      setVisibleMonth(startOfMonth(selectedDate));
    }
  }, [open, selectedDate]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const selectDate = (date: Date) => {
    onChange(formatDateValue(date));
    setVisibleMonth(startOfMonth(date));
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className={cx("relative", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cx(
          "x-date-trigger",
          triggerVariant === "payments" && "x-date-trigger-payments"
        )}
      >
        <CalendarDays className="h-4 w-4 text-[#d6d9db]" />
        <span>{formatTriggerLabel(value, locale)}</span>
      </button>

      {open ? (
        <CalendarPopover
          visibleMonth={visibleMonth}
          selectedDate={selectedDate}
          days={days}
          minDate={minDate}
          maxDate={maxDate}
          previousMonthLabel={previousMonthLabel}
          nextMonthLabel={nextMonthLabel}
          todayLabel={todayLabel}
          locale={locale}
          onMonthChange={setVisibleMonth}
          onSelectDate={selectDate}
        />
      ) : null}
    </div>
  );
}
