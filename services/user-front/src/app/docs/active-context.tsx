"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

interface DocsActiveCtx {
  activeId: string;
  setActiveId: Dispatch<SetStateAction<string>>;
}

export const DocsActiveContext = createContext<DocsActiveCtx>({
  activeId: "",
  setActiveId: () => {},
});

export function DocsActiveProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [activeId, setActiveId] = useState("");
  const value = useMemo(() => ({ activeId, setActiveId }), [activeId]);
  return (
    <DocsActiveContext.Provider value={value}>
      {children}
    </DocsActiveContext.Provider>
  );
}

export const useDocsActive = () => useContext(DocsActiveContext);
