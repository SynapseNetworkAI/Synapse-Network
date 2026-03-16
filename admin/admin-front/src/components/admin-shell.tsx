"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { useAdminNavigation } from "@/lib/use-admin-navigation";
import type { AdminNavSection } from "@/lib/navigation";
import type { AdminProfile } from "@/services/admin-api";

type AdminShellProps = {
  admin: AdminProfile;
  title: string;
  eyebrow: string;
  description: string;
  children: ReactNode;
};

function buildNextOpenSections(
  current: Record<string, boolean>,
  navigation: AdminNavSection[],
  pathname: string,
): Record<string, boolean> {
  let changed = false;
  const next: Record<string, boolean> = {};

  navigation.forEach((section, index) => {
    const hasActiveChild = section.children.some((item) => pathname === item.href);
    const previous = current[section.id];
    const resolved = previous ?? (hasActiveChild || index === 0);
    const isOpen = hasActiveChild ? true : resolved;

    next[section.id] = isOpen;
    if (previous !== isOpen) {
      changed = true;
    }
  });

  if (!changed && Object.keys(current).length === Object.keys(next).length) {
    return current;
  }

  return next;
}

export function AdminShell({
  admin,
  title,
  eyebrow,
  description,
  children,
}: Readonly<AdminShellProps>) {
  const pathname = usePathname();
  const { navigation } = useAdminNavigation(admin);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setOpenSections((current) => buildNextOpenSections(current, navigation, pathname));
  }, [navigation, pathname]);

  function toggleSection(sectionId: string) {
    setOpenSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__top">
          <div>
            <p className="sidebar__eyebrow">Synapse Admin</p>
            <h1 className="sidebar__title">Control Plane</h1>
            <p className="sidebar__text">把财务、风控、审批和审计集中到独立控制面，不直接混入交易网关。</p>
          </div>
          <nav className="sidebar__tree" aria-label="Admin navigation tree">
            {navigation.map((section) => {
              const isOpen = openSections[section.id] ?? false;
              const hasActiveChild = section.children.some((item) => pathname === item.href);

              return (
                <section key={section.id} className={`sidebar__group${hasActiveChild ? " sidebar__group--active" : ""}`}>
                  <button
                    type="button"
                    className="sidebar__group-trigger"
                    aria-expanded={isOpen}
                    onClick={() => toggleSection(section.id)}
                  >
                    <span>
                      <span className="sidebar__group-title">{section.label}</span>
                      <small className="sidebar__group-description">{section.description}</small>
                    </span>
                    <span className={`sidebar__chevron${isOpen ? " sidebar__chevron--open" : ""}`}>▾</span>
                  </button>
                  <div className={`sidebar__panel${isOpen ? " sidebar__panel--open" : ""}`}>
                    <div className="sidebar__nav">
                      {section.children.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={`sidebar__link sidebar__child-link${isActive ? " sidebar__link--active" : ""}`}
                          >
                            <span>
                              <strong className="sidebar__link-title">{item.label}</strong>
                              <small className="sidebar__link-description">{item.description}</small>
                            </span>
                            {item.badge ? <span className="sidebar__badge">{item.badge}</span> : null}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </section>
              );
            })}
          </nav>
        </div>
        <section className="sidebar__profile">
          <p className="sidebar__eyebrow">Active Session</p>
          <strong className="sidebar__profile-name">{admin.displayName}</strong>
          <p className="sidebar__profile-meta">{admin.email}</p>
          <p className="sidebar__profile-meta">{admin.role}</p>
          <p className="sidebar__profile-meta">{admin.permissions.length} permissions</p>
        </section>
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
