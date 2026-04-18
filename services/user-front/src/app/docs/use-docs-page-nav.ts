import { useEffect, useRef } from "react";
import { useDocsActive, type DocsPageNavItem } from "./active-context";

function sameNavItems(left: DocsPageNavItem[], right: DocsPageNavItem[]) {
  return (
    left.length === right.length
    && left.every((item, index) => item.id === right[index]?.id && item.label === right[index]?.label)
  );
}

export function useDocsPageNav(items: DocsPageNavItem[]) {
  const { setPageNavItems } = useDocsActive();
  const latestItems = useRef(items);
  latestItems.current = items;
  const navKey = items.map((item) => `${item.id}:${item.label}`).join("|");

  useEffect(() => {
    const nextItems = latestItems.current.map((item) => ({ ...item }));
    setPageNavItems((currentItems) => (
      sameNavItems(currentItems, nextItems) ? currentItems : nextItems
    ));
    return () => {
      setPageNavItems([]);
    };
  }, [navKey, setPageNavItems]);
}
