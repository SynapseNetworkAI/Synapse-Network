"use client";

import { usePathname } from "next/navigation";

/**
 * Wraps docs page content with a keyed div so that React re-mounts it on
 * every route change, triggering the x-docs-page-enter CSS entrance animation.
 * The key is the pathname so hash-only changes (anchor scrolling) don't re-animate.
 */
export function DocsContentWrapper({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="x-docs-page-enter">
      {children}
    </div>
  );
}
