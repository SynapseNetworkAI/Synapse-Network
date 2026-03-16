import type { ApprovalItem } from "@/services/admin-api";

type ApprovalQueueProps = {
  items: ApprovalItem[];
};

const statusLabelMap: Record<string, string> = {
  SUBMITTED: "待分派",
  UNDER_REVIEW: "审核中",
  APPROVED_PENDING_EXECUTION: "待执行",
  REJECTED: "已拒绝",
  EXECUTED: "已执行",
};

export function ApprovalQueue({ items }: Readonly<ApprovalQueueProps>) {
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Approval Queue</p>
          <h3 className="panel__title">待处理审批单</h3>
        </div>
        <span className="panel__pill">按风险等级排序</span>
      </div>
      <div className="queue">
        {items.map((item) => (
          <article key={item.approvalId} className="queue__item">
            <div>
              <p className="queue__id">{item.approvalId}</p>
              <p className="queue__meta">{item.approvalType} · {item.requesterRole}</p>
            </div>
            <div className="queue__right">
              <span className="queue__level">{item.approvalLevel}</span>
              <span className="queue__status">{statusLabelMap[item.status] ?? item.status}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
