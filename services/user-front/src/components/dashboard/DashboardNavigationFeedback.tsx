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
import DashboardPageLoadingState from "@/components/loading/DashboardPageLoadingState";

type DashboardNavigationFeedbackContextValue = {
  beginNavigation: (href: string) => void;
  cancelNavigation: () => void;
  isNavigating: boolean;
  pendingHref: string | null;
};

const DashboardNavigationFeedbackContext =
  createContext<DashboardNavigationFeedbackContextValue | null>(null);

const MIN_TRANSITION_MS = 180;
const MAX_TRANSITION_MS = 8000;

function normalizePath(value: string | null | undefined): string {
  if (!value) {
    return "/";
  }

  const basePath = value.split("?")[0].replace(/\/+$/, "");
  return basePath || "/";
}

export function DashboardNavigationFeedbackProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
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
    <DashboardNavigationFeedbackContext.Provider value={value}>
      {children}
    </DashboardNavigationFeedbackContext.Provider>
  );
}

export function useDashboardNavigationFeedback() {
  const context = useContext(DashboardNavigationFeedbackContext);

  if (!context) {
    throw new Error(
      "useDashboardNavigationFeedback must be used within DashboardNavigationFeedbackProvider"
    );
  }

  return context;
}

export function DashboardNavigationLoadingOverlay() {
  const { isNavigating } = useDashboardNavigationFeedback();

  if (!isNavigating) {
    return null;
  }

  return <DashboardPageLoadingState mode="overlay" />;
}