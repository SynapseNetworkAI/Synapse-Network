import Link from "next/link";
import type { ReactNode } from "react";

type LinkItem = {
  href: string;
  title: string;
  description: string;
};

export function QuickLinks({ items }: Readonly<{ items: LinkItem[] }>) {
  return (
    <div className="not-prose my-7 grid gap-3 md:grid-cols-2">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="rounded-[10px] border border-white/[0.08] bg-[#050708] p-4 transition hover:border-[#7ff7be]/35 hover:bg-[#07100b]"
        >
          <span className="block text-sm font-semibold text-fd-foreground">
            {item.title}
          </span>
          <span className="mt-2 block text-sm leading-6 text-fd-muted-foreground">
            {item.description}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function StatLine({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="not-prose my-6 rounded-[10px] border border-white/[0.08] bg-[#050708] px-4 py-3 font-mono text-xs leading-6 text-fd-muted-foreground">
      {children}
    </div>
  );
}
