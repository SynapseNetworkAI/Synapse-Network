import type { FinanceOverview } from "@/services/admin-api";

type FinanceOverviewPanelProps = {
  overview: FinanceOverview;
};

const financeCards = [
  { label: "今日扣费", key: "todayChargeUsdc" },
  { label: "今日充值", key: "todayDepositUsdc" },
  { label: "今日退款", key: "todayRefundUsdc" },
  { label: "今日提现", key: "todayWithdrawalUsdc" },
  { label: "Owner 负债", key: "ownerLiabilityUsdc" },
  { label: "Provider 应付", key: "providerPayableUsdc" },
  { label: "平台手续费余额", key: "platformFeeBalanceUsdc" },
  { label: "Vault 对账差额", key: "vaultLedgerDeltaUsdc" },
] as const satisfies Array<{ label: string; key: keyof FinanceOverview }>;

export function FinanceOverviewPanel({ overview }: Readonly<FinanceOverviewPanelProps>) {
  return (
    <section className="dashboard-section">
      <div className="dashboard-section__header">
        <div>
          <p className="panel__eyebrow">Stable Read Model 01</p>
          <h3 className="panel__title">Finance Overview</h3>
          <p className="panel__text">按资金语义拆分的只读快照，统一展示当日流水、账本义务和对账差额。</p>
        </div>
        <span className="dashboard-section__stamp">{overview.projectedAt ?? "projection pending"}</span>
      </div>
      <div className="dashboard-metric-grid">
        {financeCards.map((card) => (
          <article key={card.label} className="dashboard-mini-card">
            <p className="metric-card__label">{card.label}</p>
            <p className="dashboard-mini-card__value">{overview[card.key]} USDC</p>
          </article>
        ))}
        <article className="dashboard-mini-card">
          <p className="metric-card__label">待确认充值</p>
          <p className="dashboard-mini-card__value">{overview.pendingDepositCount}</p>
        </article>
        <article className="dashboard-mini-card">
          <p className="metric-card__label">待出账提现</p>
          <p className="dashboard-mini-card__value">{overview.pendingWithdrawalCount}</p>
        </article>
      </div>
    </section>
  );
}
