"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent, Ref, SetStateAction } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { QUICK_ACCESS_CONFIG } from "@/components/quickAccessConfig";
import type { QuickAccessEntryConfig } from "@/components/quickAccessConfig";
import { XDialog, XDialogSurface } from "@/components/xui/XDialog";
import { XInput } from "@/components/xui/XInput";

type QuickAccessDialogProps = {
  open: boolean;
  onClose: () => void;
};

type QuickAccessEntry = {
  label: string;
  description: string;
} & QuickAccessEntryConfig;

type QuickAccessSurfaceProps = {
  activeIndex: number;
  filteredEntries: QuickAccessEntry[];
  inputRef: Ref<HTMLInputElement>;
  onActivateEntry: (entry: QuickAccessEntry) => void;
  onClose: () => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  pathname: string;
  query: string;
  setActiveIndex: (index: number) => void;
  setQuery: (query: string) => void;
  t: (key: string) => string;
};

function QuickAccessSurface({
  activeIndex,
  filteredEntries,
  inputRef,
  onActivateEntry,
  onClose,
  onInputKeyDown,
  pathname,
  query,
  setActiveIndex,
  setQuery,
  t,
}: Readonly<QuickAccessSurfaceProps>) {
  return (
    <XDialog
      open
      ariaLabelledby="quick-access-title"
      onDismiss={onClose}
      overlayClassName="items-start pt-[92px]"
    >
      <XDialogSurface className="max-w-[560px] rounded-[24px] border-white/10 bg-[linear-gradient(180deg,rgba(10,10,12,0.98),rgba(6,7,9,0.985))] shadow-[0_32px_140px_rgba(0,0,0,0.55)]">
        <div className="border-b border-white/6 px-4 pb-3 pt-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl text-white/68">
              <Search className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p id="quick-access-title" className="sr-only">
                {t("nav.quickAccess")}
              </p>
              <XInput
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder={t("nav.searchPlaceholder")}
                className="h-11 border-0 bg-transparent px-0 py-0 text-[1.15rem] font-medium text-white placeholder:text-white/34 focus:ring-0"
              />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 min-w-[44px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55 transition hover:border-white/16 hover:bg-white/[0.06] hover:text-white/84"
            >
              ESC
            </button>
          </div>
        </div>

        <QuickAccessResults
          activeIndex={activeIndex}
          entries={filteredEntries}
          pathname={pathname}
          onActivateEntry={onActivateEntry}
          setActiveIndex={setActiveIndex}
          t={t}
        />
      </XDialogSurface>
    </XDialog>
  );
}

function QuickAccessResults({
  activeIndex,
  entries,
  pathname,
  onActivateEntry,
  setActiveIndex,
  t,
}: Readonly<{
  activeIndex: number;
  entries: QuickAccessEntry[];
  pathname: string;
  onActivateEntry: (entry: QuickAccessEntry) => void;
  setActiveIndex: (index: number) => void;
  t: (key: string) => string;
}>) {
  return (
    <div className="px-4 pb-3 pt-3">
      <div className="mb-3 flex items-center justify-between px-1">
        <div>
          <p className="text-[13px] font-semibold text-white/88">
            {t("nav.quickAccess")}
          </p>
          <p className="mt-1 text-[13px] text-white/42">
            {t("nav.quickAccessHint")}
          </p>
        </div>
      </div>

      <div className="max-h-[420px] overflow-y-auto pr-1">
        {entries.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/46">
            {t("nav.quickAccessEmpty")}
          </div>
        ) : (
          <div className="space-y-1.5">
            {entries.map((entry, index) => (
              <QuickAccessResult
                key={entry.href}
                active={entry.matches(pathname)}
                entry={entry}
                selected={index === activeIndex}
                onActivateEntry={onActivateEntry}
                onHover={() => setActiveIndex(index)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QuickAccessResult({
  active,
  entry,
  selected,
  onActivateEntry,
  onHover,
}: Readonly<{
  active: boolean;
  entry: QuickAccessEntry;
  selected: boolean;
  onActivateEntry: (entry: QuickAccessEntry) => void;
  onHover: () => void;
}>) {
  const Icon = entry.icon;
  return (
    <button
      type="button"
      data-testid="quick-access-result"
      data-href={entry.href}
      onMouseEnter={onHover}
      onClick={() => onActivateEntry(entry)}
      className={[
        "flex w-full items-start gap-3 rounded-[18px] px-4 py-3 text-left transition-[background-color,box-shadow,transform]",
        selected
          ? "bg-white/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
          : "hover:bg-white/[0.04]",
      ].join(" ")}
    >
      <span
        className={[
          "mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors",
          active
            ? "border-[#7ff7be]/18 bg-[#7ff7be]/[0.08] text-[#7ff7be]"
            : "border-white/8 bg-white/[0.025] text-white/54",
        ].join(" ")}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[15px] font-medium text-white">
          {entry.label}
          {active ? (
            <span
              className="inline-flex h-2 w-2 rounded-full bg-[#7ff7be] shadow-[0_0_10px_rgba(127,247,190,0.55)]"
              aria-hidden="true"
            ></span>
          ) : null}
        </span>
        <span className="mt-1 block text-[13px] leading-5 text-white/42">
          {entry.description}
        </span>
      </span>
    </button>
  );
}

function useQuickAccessInputHandler({
  activeIndex,
  activateEntry,
  filteredEntries,
  setActiveIndex,
}: {
  activeIndex: number;
  activateEntry: (entry: QuickAccessEntry) => void;
  filteredEntries: QuickAccessEntry[];
  setActiveIndex: Dispatch<SetStateAction<number>>;
}) {
  return useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) =>
          filteredEntries.length === 0
            ? 0
            : (current + 1) % filteredEntries.length
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) =>
          filteredEntries.length === 0
            ? 0
            : (current - 1 + filteredEntries.length) % filteredEntries.length
        );
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const target = filteredEntries[activeIndex];
        if (target) {
          activateEntry(target);
        }
      }
    },
    [activateEntry, activeIndex, filteredEntries, setActiveIndex]
  );
}

export default function QuickAccessDialog({
  open,
  onClose,
}: Readonly<QuickAccessDialogProps>) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const entries = useMemo<QuickAccessEntry[]>(
    () =>
      QUICK_ACCESS_CONFIG.map((entry) => ({
        ...entry,
        label: t(entry.labelKey),
        description: t(entry.descriptionKey),
      })),
    [t]
  );

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return entries;
    }

    return entries.filter((entry) =>
      [entry.label, entry.description, ...entry.keywords].some((value) =>
        value.toLowerCase().includes(normalized)
      )
    );
  }, [entries, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery("");
    setActiveIndex(0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
    };
  }, [onClose, open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const activateEntry = useCallback(
    (entry: QuickAccessEntry) => {
      if (entry.matches(pathname)) {
        onClose();
        return;
      }

      router.push(entry.href);
      onClose();
    },
    [onClose, pathname, router]
  );

  const handleInputKeyDown = useQuickAccessInputHandler({
    activeIndex,
    activateEntry,
    filteredEntries,
    setActiveIndex,
  });

  if (!open) {
    return null;
  }

  return (
    <QuickAccessSurface
      activeIndex={activeIndex}
      filteredEntries={filteredEntries}
      inputRef={inputRef}
      onActivateEntry={activateEntry}
      onClose={onClose}
      onInputKeyDown={handleInputKeyDown}
      pathname={pathname}
      query={query}
      setActiveIndex={setActiveIndex}
      setQuery={setQuery}
      t={t}
    />
  );
}
