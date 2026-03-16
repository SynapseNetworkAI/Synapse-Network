import Link from "next/link";
import type { ReactNode } from "react";

import { adminNavigation } from "@/lib/navigation";

type AdminShellProps = {
  title: string;
  eyebrow: string;
  description: string;
  children: ReactNode;
};

export function AdminShell({
  title,
  eyebrow,
  description,
  children,
}: Readonly<AdminShellProps>) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <p className="sidebar__eyebrow">Synapse Admin</p>
          <h1 className="sidebar__title">Control Plane</h1>
          <p className="sidebar__text">把财务、风控、审批和审计集中到独立控制面，不直接混入交易网关。</p>
        </div>
        <nav className="sidebar__nav" aria-label="Admin navigation">
          {adminNavigation.map((item) => (
            <Link key={item.href} href={item.href} className="sidebar__link">
              <span>{item.label}</span>
              {item.badge ? <span className="sidebar__badge">{item.badge}</span> : null}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="content">
        <header className="hero">
          <div>
            <p className="hero__eyebrow">{eyebrow}</p>
            <h2 className="hero__title">{title}</h2>
            <p className="hero__description">{description}</p>
          </div>
          <div className="hero__status">
            <span className="status-dot" />
            <span>审计链路已启用</span>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
