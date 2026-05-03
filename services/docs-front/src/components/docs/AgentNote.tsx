import type { ReactNode } from "react";

export function AgentNote({
  children,
  title = "For AI agents",
}: Readonly<{ children: ReactNode; title?: string }>) {
  return (
    <aside className="synapse-callout my-6 rounded-[10px] p-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7ff7be]">
        {title}
      </p>
      <div className="text-sm leading-7 text-fd-muted-foreground">
        {children}
      </div>
    </aside>
  );
}

export function WarningNote({
  children,
  title = "Warning",
}: Readonly<{ children: ReactNode; title?: string }>) {
  return (
    <aside className="synapse-warning my-6 rounded-[10px] p-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f9c74f]">
        {title}
      </p>
      <div className="text-sm leading-7 text-fd-muted-foreground">
        {children}
      </div>
    </aside>
  );
}
