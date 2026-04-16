import { useEffect } from "react";
import { useDocsActive, type DocsPageNavItem } from "./active-context";

export function useDocsPageNav(items: DocsPageNavItem[]) {
  const { setPageNavItems } = useDocsActive();

  useEffect(() => {
    setPageNavItems(items);
    return () => {
      setPageNavItems([]);
    };
  }, [items, setPageNavItems]);
}
