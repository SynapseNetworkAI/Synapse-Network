"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/components/i18n/LanguageProvider";

type DocsNavigationFeedbackContextValue = {
  beginNavigation: (href: string) => void;
  cancelNavigation: () => void;
  isNavigating: boolean;
  pendingHref: string | null;
};

const DocsNavigationFeedbackContext =
  createContext<DocsNavigationFeedbackContextValue | null>(null);

const MIN_TRANSITION_MS = 180;
const MAX_TRANSITION_MS = 8000;

function normalizePath(value: string | null | undefined): string {
  if (!value) {
    return "/docs";
  }

  const basePath = value.split("?")[0].replace(/\/+$/, "");
  return basePath || "/";
}

export function DocsNavigationFeedbackProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const startedAtRef = useRef<number>(0);

  const cancelNavigation = useCallback(() => {
    setPendingHref(null);
    setIsNavigating(false);
    startedAtRef.current = 0;
  }, []);

  const beginNavigation = useCallback(
    (href: string) => {
      if (normalizePath(href) === normalizePath(pathname)) {
        return;
      }

      startedAtRef.current =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      setPendingHref(href);
      setIsNavigating(true);
    },
    [pathname]
  );

  useEffect(() => {
    if (!pendingHref || !isNavigating) {
      return;
    }

    if (normalizePath(pathname) !== normalizePath(pendingHref)) {
      return;
    }

    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsed = now - startedAtRef.current;
    const delay = Math.max(0, MIN_TRANSITION_MS - elapsed);
    const timeoutId = globalThis.setTimeout(cancelNavigation, delay);

    return () => globalThis.clearTimeout(timeoutId);
  }, [cancelNavigation, isNavigating, pathname, pendingHref]);

  useEffect(() => {
    if (!pendingHref || !isNavigating) {
      return;
    }

    const timeoutId = globalThis.setTimeout(cancelNavigation, MAX_TRANSITION_MS);
    return () => globalThis.clearTimeout(timeoutId);
  }, [cancelNavigation, isNavigating, pendingHref]);

  const value = useMemo(
    () => ({
      beginNavigation,
      cancelNavigation,
      isNavigating,
      pendingHref,
    }),
    [beginNavigation, cancelNavigation, isNavigating, pendingHref]
  );

  return (
    <DocsNavigationFeedbackContext.Provider value={value}>
      {children}
    </DocsNavigationFeedbackContext.Provider>
  );
}

export function useDocsNavigationFeedback() {
  const context = useContext(DocsNavigationFeedbackContext);

  if (!context) {
    throw new Error(
      "useDocsNavigationFeedback must be used within DocsNavigationFeedbackProvider"
    );
  }

  return context;
}

export function DocsNavigationLoadingOverlay() {
  const { isNavigating } = useDocsNavigationFeedback();
  const { lang } = useLanguage();

  if (!isNavigating) {
    return null;
  }

  return (
    <div
      data-testid="docs-nav-loading-overlay"
      className="pointer-events-none absolute inset-0 z-20 bg-[#050505]/72 backdrop-blur-[3px]"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="absolute inset-x-0 top-0 h-[2px] overflow-hidden bg-white/[0.04]">
        <div className="h-full w-[32%] animate-[docsNavProgress_900ms_ease-in-out_infinite] rounded-full bg-[#7ff7be]" />
      </div>

      <div className="absolute right-6 top-6 rounded-2xl border border-white/[0.08] bg-[#0d1014]/90 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
          {lang === "zh" ? "文档切换中" : "Docs transition"}
        </p>
        <p className="mt-2 text-[14px] font-medium text-white/88">
          {lang === "zh" ? "先切页面，再流式加载内容" : "Switch the page shell first, then stream the content"}
        </p>
      </div>
    </div>
  );
}
