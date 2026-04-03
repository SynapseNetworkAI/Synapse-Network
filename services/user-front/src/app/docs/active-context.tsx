"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

export interface DocsPageNavItem {
  id: string;
  label: string;
}

interface DocsActiveCtx {
  activeId: string;
  setActiveId: Dispatch<SetStateAction<string>>;
  pageNavItems: DocsPageNavItem[];
  setPageNavItems: Dispatch<SetStateAction<DocsPageNavItem[]>>;
}

export const DocsActiveContext = createContext<DocsActiveCtx>({
  activeId: "",
  setActiveId: () => {},
  pageNavItems: [],
  setPageNavItems: () => {},
});

export function DocsActiveProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [activeId, setActiveId] = useState("");
  const [pageNavItems, setPageNavItems] = useState<DocsPageNavItem[]>([]);
  const value = useMemo(
    () => ({ activeId, setActiveId, pageNavItems, setPageNavItems }),
    [activeId, pageNavItems],
  );
  return (
    <DocsActiveContext.Provider value={value}>
      {children}
    </DocsActiveContext.Provider>
  );
}

export const useDocsActive = () => useContext(DocsActiveContext);
