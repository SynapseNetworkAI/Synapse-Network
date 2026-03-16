type SummaryCardsProps = {
  metrics: {
    pendingApprovals: number;
    depositExceptions: number;
    auditAlerts: number;
  };
};

export function SummaryCards({ metrics }: Readonly<SummaryCardsProps>) {
  const dashboardCards = [
    {
      label: "待审批高风险操作",
      value: String(metrics.pendingApprovals),
      hint: "包含退款、提现复核、风控白名单变更",
    },
    {
      label: "今日充值异常",
      value: String(metrics.depositExceptions),
      hint: "建议优先排查链上确认延迟与回放任务状态",
    },
    {
      label: "审计告警",
      value: String(metrics.auditAlerts),
      hint: "单个管理员在 10 分钟内连续触发敏感配置查看",
    },
  ];

  return (
    <section className="card-grid">
      {dashboardCards.map((card) => (
        <article key={card.label} className="metric-card">
          <p className="metric-card__label">{card.label}</p>
          <p className="metric-card__value">{card.value}</p>
          <p className="metric-card__hint">{card.hint}</p>
        </article>
      ))}
    </section>
  );
}
