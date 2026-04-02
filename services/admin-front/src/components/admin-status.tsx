import type { AdminProfile, SystemStatus } from "@/services/admin-api";

type AdminStatusProps = {
  admin: AdminProfile;
  status?: SystemStatus | null;
};

export function AdminStatus({ admin, status }: Readonly<AdminStatusProps>) {
  return (
    <section className="panel admin-status">
      <div className="admin-status__identity">
        <p className="panel__eyebrow">Active Session</p>
        <h3 className="panel__title">{admin.displayName}</h3>
        <p className="panel__text">{admin.email} · {admin.role}</p>
      </div>
      <div className="admin-status__metrics">
        <div>
          <p className="metric-card__label">gateway-admin</p>
          <p className="admin-status__value">{status?.gatewayAdmin ?? "loading"}</p>
        </div>
        <div>
          <p className="metric-card__label">gateway</p>
          <p className="admin-status__value">{status?.gateway ?? "loading"}</p>
        </div>
      </div>
    </section>
  );
}
