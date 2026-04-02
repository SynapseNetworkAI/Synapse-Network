import { useEffect } from "react";
import { useDocsActive } from "./active-context";

/**
 * Sets up IntersectionObserver to track which doc section is on screen,
 * updating the global activeId in DocsActiveContext.
 *
 * @param sectionIds  Ordered list of section element IDs on this page.
 * @param initialId   The section ID to activate immediately on mount.
 */
export function useActiveSection(sectionIds: string[], initialId: string) {
  const { setActiveId } = useDocsActive();

  useEffect(() => {
    setActiveId(initialId);

    const observers: IntersectionObserver[] = [];

    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveId(id);
        },
        { rootMargin: "-30% 0px -60% 0px", threshold: 0 },
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
    // setActiveId is stable; sectionIds/initialId are declared as constants per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
