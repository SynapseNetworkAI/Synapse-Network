"use client";

import { ChevronDown } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type XSelectOption<T extends string = string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

type XSelectProps<T extends string = string> = {
  id?: string;
  value: T;
  options: readonly XSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder?: ReactNode;
  triggerClassName?: string;
  menuClassName?: string;
  optionClassName?: string;
  matchTriggerWidth?: boolean;
  align?: "start" | "end";
};

type MenuPosition = {
  top: number;
  left: number;
  width: number;
};

export default function XSelect<T extends string = string>({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  placeholder,
  triggerClassName,
  menuClassName,
  optionClassName,
  matchTriggerWidth = true,
  align = "start",
}: Readonly<XSelectProps<T>>) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  );

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
      const width = matchTriggerWidth ? rect.width : Math.max(rect.width, 180);
      const left =
        align === "end"
          ? rect.right - width + window.scrollX
          : rect.left + window.scrollX;
      setMenuPosition({
        top: rect.bottom + window.scrollY + 8,
        left,
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
  }, [align, matchTriggerWidth, open]);

  const menuStyle: CSSProperties | undefined = menuPosition
    ? {
        position: "absolute",
        top: menuPosition.top,
        left: menuPosition.left,
        width: menuPosition.width,
      }
    : undefined;

  return (
    <>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current);
          }
        }}
        className={
          triggerClassName ||
          "inline-flex min-h-10 w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0a0a0a] px-3 py-2 text-sm text-white transition hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        <span className="min-w-0 truncate text-left">
          {selectedOption?.label ?? placeholder ?? ""}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-white/55 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              className={
                menuClassName ||
                "z-[160] overflow-hidden rounded-2xl border border-white/12 bg-[#0d0f12]/98 p-1 shadow-[0_24px_80px_rgba(0,0,0,0.48)] backdrop-blur-2xl"
              }
              style={menuStyle}
            >
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    onClick={() => {
                      if (option.disabled) {
                        return;
                      }
                      onChange(option.value);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    className={
                      optionClassName ||
                      [
                        "flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm transition",
                        isSelected
                          ? "bg-white/[0.12] text-white"
                          : "text-white/80 hover:bg-white/[0.08] hover:text-white",
                        option.disabled ? "cursor-not-allowed opacity-40" : "",
                      ].join(" ")
                    }
                  >
                    <span className="truncate">{option.label}</span>
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
