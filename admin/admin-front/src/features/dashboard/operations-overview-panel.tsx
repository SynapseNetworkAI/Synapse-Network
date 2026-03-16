import type { OperationsOverview } from "@/services/admin-api";

type OperationsOverviewPanelProps = {
  overview: OperationsOverview;
};

function statusClassName(status: string, alert: boolean): string {
  if (alert) {
    return "status-pill status-pill--alert";
  }
  return status === "healthy" ? "status-pill status-pill--healthy" : "status-pill status-pill--degraded";
}

export function OperationsOverviewPanel({ overview }: Readonly<OperationsOverviewPanelProps>) {
  return (
    <section className="dashboard-section">
      <div className="dashboard-section__header">
        <div>
          <p className="panel__eyebrow">Stable Read Model 03</p>
          <h3 className="panel__title">Operations Overview</h3>
          <p className="panel__text">只暴露已持久化的 indexer、backfill、reconciliation 与失败计数，不把内存态字段混进稳定投影。</p>
        </div>
        <span className={statusClassName(overview.gatewayStatus, overview.reconciliationAlert)}>
          {overview.gatewayStatus}
        </span>
      </div>
      <div className="dashboard-ops-grid">
        <article className="dashboard-mini-card">
          <p className="metric-card__label">Indexer last processed</p>
          <p className="dashboard-mini-card__value">{overview.indexerLastProcessedAt ?? "n/a"}</p>
        </article>
        <article className="dashboard-mini-card">
          <p className="metric-card__label">Backfill last scan</p>
          <p className="dashboard-mini-card__value">{overview.backfillLastScanAt ?? "n/a"}</p>
        </article>
        <article className="dashboard-mini-card">
          <p className="metric-card__label">Backfill block</p>
          <p className="dashboard-mini-card__value">{overview.backfillLastScannedBlock ?? "n/a"}</p>
        </article>
        <article className="dashboard-mini-card">
          <p className="metric-card__label">Recent gateway failures</p>
          <p className="dashboard-mini-card__value">{overview.recentGatewayFailures}</p>
        </article>
        <article className="dashboard-mini-card">
          <p className="metric-card__label">Failed deposits</p>
          <p className="dashboard-mini-card__value">{overview.failedDepositCount}</p>
        </article>
        <article className="dashboard-mini-card">
          <p className="metric-card__label">Recent audit alerts</p>
          <p className="dashboard-mini-card__value">{overview.recentAuditAlerts}</p>
        </article>
        <article className="dashboard-mini-card">
          <p className="metric-card__label">Last reconciliation</p>
          <p className="dashboard-mini-card__value">{overview.lastReconciliationAt ?? "n/a"}</p>
        </article>
        <article className="dashboard-mini-card">
          <p className="metric-card__label">Reconciliation delta</p>
          <p className="dashboard-mini-card__value">{overview.reconciliationDeltaUsdc} USDC</p>
        </article>
      </div>
      {overview.reconciliationLastError ? (
        <p className="form-message form-message--error">Last reconciliation error: {overview.reconciliationLastError}</p>
      ) : null}
    </section>
  );
}
