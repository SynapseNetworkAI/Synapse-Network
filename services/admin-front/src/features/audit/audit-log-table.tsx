import type { AuditActionItem } from "@/services/admin-api";


type AuditLogTableProps = {
  items: AuditActionItem[];
};


export function AuditLogTable({ items }: Readonly<AuditLogTableProps>) {
  return (
    <section className="dashboard-section">
      <div className="dashboard-section__header">
        <div>
          <p className="panel__eyebrow">Audit Trail</p>
          <h3 className="panel__title">管理员操作日志</h3>
          <p className="panel__text">按 operator、approval、job、resultStatus 聚合搜索，确保高风险动作具备可追溯链路。</p>
        </div>
        <span className="dashboard-section__stamp">{items.length} events</span>
      </div>
      <div className="data-table">
        <table>
          <thead>
            <tr>
              <th>动作</th>
              <th>操作人</th>
              <th>资源</th>
              <th>审批 / 执行</th>
              <th>结果</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.auditId ?? item.createdAt}-${item.actionType}`}>
                <td>
                  <strong>{item.actionType}</strong>
                  <div className="table-subtext">{item.operatorRole ?? "unknown role"}</div>
                </td>
                <td>
                  <strong>{item.operatorEmail ?? item.operatorId ?? "system"}</strong>
                  <div className="table-subtext">{item.operatorId ?? "-"}</div>
                </td>
                <td>
                  <strong>{item.resourceType ?? "-"}</strong>
                  <div className="table-subtext">{item.resourceId ?? "-"}</div>
                </td>
                <td>
                  <div className="table-subtext">approval: {item.approvalId ?? "-"}</div>
                  <div className="table-subtext">job: {item.jobId ?? "-"}</div>
                </td>
                <td>
                  <span className={`status-pill ${item.resultStatus === "success" ? "status-pill--healthy" : "status-pill--alert"}`}>
                    {item.resultStatus}
                  </span>
                  {item.errorCode ? <div className="table-subtext">{item.errorCode}</div> : null}
                </td>
                <td>{item.createdAt ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}