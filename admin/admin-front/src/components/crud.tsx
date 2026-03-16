import type { ReactNode } from "react";


type CrudSectionProps = {
  eyebrow: string;
  title: string;
  description?: string;
  stamp?: string;
  toolbar?: ReactNode;
  message?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
};


type CrudFieldProps = {
  label: string;
  children: ReactNode;
  compact?: boolean;
};


type CrudDrawerProps = {
  open: boolean;
  eyebrow: string;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
};


type CrudTableProps = {
  children: ReactNode;
};


type CrudEmptyStateProps = {
  title: string;
  description: string;
};


export function CrudSection({ eyebrow, title, description, stamp, toolbar, message, error, children }: Readonly<CrudSectionProps>) {
  return (
    <section className="dashboard-section">
      <div className="dashboard-section__header">
        <div>
          <p className="panel__eyebrow">{eyebrow}</p>
          <h3 className="panel__title">{title}</h3>
          {description ? <p className="panel__text">{description}</p> : null}
        </div>
        {stamp ? <span className="dashboard-section__stamp">{stamp}</span> : null}
      </div>
      {toolbar}
      {message}
      {error}
      {children}
    </section>
  );
}


export function CrudToolbar({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="crud-toolbar">{children}</div>;
}


export function CrudToolbarFilters({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="crud-toolbar__filters">{children}</div>;
}


export function CrudField({ label, children, compact = false }: Readonly<CrudFieldProps>) {
  return (
    <label className={`crud-field${compact ? " crud-field--compact" : ""}`}>
      <span className="crud-field__label">{label}</span>
      {children}
    </label>
  );
}


export function CrudTable({ children }: Readonly<CrudTableProps>) {
  return <div className="data-table">{children}</div>;
}


export function CrudEmptyState({ title, description }: Readonly<CrudEmptyStateProps>) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p className="table-subtext">{description}</p>
    </div>
  );
}


export function CrudDrawer({ open, eyebrow, title, description, onClose, children }: Readonly<CrudDrawerProps>) {
  return (
    <>
      <button
        type="button"
        className={`crud-drawer-backdrop${open ? " crud-drawer-backdrop--open" : ""}`}
        onClick={onClose}
        aria-label="关闭抽屉"
      />
      <aside className={`crud-drawer${open ? " crud-drawer--open" : ""}`} aria-hidden={!open}>
        <div className="crud-drawer__header">
          <div>
            <p className="panel__eyebrow">{eyebrow}</p>
            <h3 className="panel__title">{title}</h3>
            {description ? <p className="panel__text">{description}</p> : null}
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>关闭</button>
        </div>
        {children}
      </aside>
    </>
  );
}