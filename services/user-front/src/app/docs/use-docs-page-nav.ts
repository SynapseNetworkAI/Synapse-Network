import { useEffect } from "react";
import { useDocsActive, type DocsPageNavItem } from "./active-context";

export function useDocsPageNav(items: DocsPageNavItem[]) {
  const { setPageNavItems } = useDocsActive();
  const signature = items.map((item) => `${item.id}:${item.label}`).join("|");

  useEffect(() => {
    setPageNavItems(items);
    return () => {
      setPageNavItems([]);
    };
  }, [setPageNavItems, signature]);
}
