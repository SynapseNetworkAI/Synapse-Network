"use client";

import { Check, ChevronDown, Globe2 } from "lucide-react";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/components/i18n/LanguageProvider";

type LanguageSwitcherProps = {
  className?: string;
};

type MenuPosition = {
  top: number;
  left: number;
  width: number;
};

export default function LanguageSwitcher({ className }: Readonly<LanguageSwitcherProps>) {
  const { lang, setLang, supportedLanguages } = useLanguage();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const selectedOption = useMemo(
    () => supportedLanguages.find((item) => item.code === lang),
    [lang, supportedLanguages],
  );

  const selectedLabel =
    selectedOption?.code === "en"
      ? "English"
      : selectedOption?.label ?? "English";

  useEffect(() => {
    if (!open) {
      return;
    }

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const width = Math.max(rect.width, 122);
      setMenuPosition({
        top: rect.bottom + window.scrollY + 8,
        left: rect.right + window.scrollX - width,
        width,
      });
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        (triggerRef.current && triggerRef.current.contains(target)) ||
        (menuRef.current && menuRef.current.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const menuStyle: CSSProperties | undefined = menuPosition
    ? {
        position: "absolute",
        top: menuPosition.top,
        left: menuPosition.left,
        width: menuPosition.width,
      }
    : undefined;

  const triggerClasses = [
    "relative inline-flex h-[36px] min-w-[121px] items-center overflow-hidden rounded-full border border-[#2f3336] bg-[#16181c] pl-[14px] pr-[32px] text-[15px] font-normal leading-none text-[#e7e9ea] transition hover:border-[#3d4043] hover:bg-[#1b1d21]",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Language"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={triggerClasses}
      >
        <span className="flex min-w-0 max-w-full items-center whitespace-nowrap leading-none">
          <Globe2 className="mr-[9px] h-[15px] w-[15px] shrink-0 text-[#71767b]" />
          <span className="truncate leading-none">{selectedLabel}</span>
        </span>
        <ChevronDown
          className={`pointer-events-none absolute right-[12px] top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-[#71767b] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              className="z-[160] overflow-hidden rounded-[16px] border border-[#536471] bg-[#000000] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.32)]"
              style={menuStyle}
            >
              {supportedLanguages.map((item) => {
                const label = item.code === "en" ? "English" : item.label;
                const isSelected = item.code === lang;
                return (
                  <button
                    key={item.code}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      setLang(item.code);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    className={[
                      "flex h-10 w-full items-center justify-between gap-3 px-4 text-left text-[15px] font-normal leading-none transition",
                      isSelected
                        ? "bg-[#16181c] text-[#e7e9ea]"
                        : "bg-transparent text-[#e7e9ea] hover:bg-[#080808]",
                    ].join(" ")}
                  >
                    <span className="truncate">{label}</span>
                    {isSelected ? (
                      <Check className="h-[18px] w-[18px] shrink-0 text-[#e7e9ea]" />
                    ) : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
