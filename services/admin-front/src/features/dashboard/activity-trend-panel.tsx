import type { ActivityTrendSeries } from "@/services/admin-api";

type ActivityTrendPanelProps = {
  trends: ActivityTrendSeries;
};

export function ActivityTrendPanel({ trends }: Readonly<ActivityTrendPanelProps>) {
  return (
    <section className="dashboard-section">
      <div className="dashboard-section__header">
        <div>
          <p className="panel__eyebrow">Stable Read Model 02</p>
          <h3 className="panel__title">Activity Trends</h3>
          <p className="panel__text">按天固化 7 日充值、扣费、退款、提现与净流入，用于前端趋势卡片和后续告警阈值判断。</p>
        </div>
        <span className="dashboard-section__stamp">7 day window</span>
      </div>
      <div className="trend-table">
        <table>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Deposit</th>
              <th scope="col">Charge</th>
              <th scope="col">Refund</th>
              <th scope="col">Withdrawal</th>
              <th scope="col">Net Flow</th>
            </tr>
          </thead>
          <tbody>
            {trends.points.map((point) => (
              <tr key={point.bucketDate}>
                <td>{point.bucketDate}</td>
                <td>{point.depositUsdc} USDC</td>
                <td>{point.chargeUsdc} USDC</td>
                <td>{point.refundUsdc} USDC</td>
                <td>{point.withdrawalUsdc} USDC</td>
                <td>{point.netFlowUsdc} USDC</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
