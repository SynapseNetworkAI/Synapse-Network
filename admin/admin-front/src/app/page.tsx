import Link from "next/link";

const landingMenu = [
  "Dashboard",
  "Users",
  "Role Permissions",
  "Menu Config",
  "Approvals",
  "Finance",
  "Risk",
  "System",
];

const landingMetrics = [
  { label: "Protected operators", value: "1,024", meta: "MFA-bound admin identities" },
  { label: "Approval latency", value: "182ms", meta: "median review dispatch" },
  { label: "Ledger integrity", value: "99.98%", meta: "reconciliation confidence" },
  { label: "Watchpoints", value: "42", meta: "critical events in queue" },
];

const landingFeeds = [
  { code: "FINANCE_OVERVIEW", detail: "Stable read models for deposit, refund, liability, and vault delta." },
  { code: "RISK_ACTIVITY", detail: "High-signal threat stream with manual review pivots and escalation guardrails." },
  { code: "SYSTEM_STATUS", detail: "Gateway, indexer, reconciliation, and auth sentinel health in one command rail." },
];

export default function HomePage() {
  return (
    <main className="landing-page">
      <div className="landing-page__glow landing-page__glow--left" />
      <div className="landing-page__glow landing-page__glow--right" />

      <header className="landing-topbar">
        <div className="landing-topbar__brand">
          <span className="landing-topbar__logo">SN</span>
          <div>
            <strong>Synapse Sentinel</strong>
            <p>The Settlement Layer for AI Agents</p>
          </div>
        </div>
        <nav className="landing-topbar__nav" aria-label="Homepage menu">
          <a href="#overview">Overview</a>
          <a href="#modules">Modules</a>
          <a href="#guardrails">Guardrails</a>
          <a href="#command">Command Rail</a>
        </nav>
        <div className="landing-topbar__actions">
          <Link href="/login" className="button button--secondary">Operator Login</Link>
          <Link href="/dashboard" className="button button--primary">Open Control Plane</Link>
        </div>
      </header>

      <section className="landing-hero" id="overview">
        <div className="landing-hero__copy">
          <p className="landing-hero__eyebrow">Monolithic Sentinel</p>
          <h1>Guard the money rail like a command tower, not a CRUD panel.</h1>
          <p className="landing-hero__text">
            Synapse Admin compresses finance, approvals, risk, system health, and audit into one hardened control surface.
            The interface stays still, the operators stay fast, and the money path stays legible.
          </p>
          <div className="landing-hero__actions">
            <Link href="/login" className="button button--primary">Authorize Session</Link>
            <a href="#modules" className="button button--secondary">Inspect Modules</a>
          </div>
          <div className="landing-hero__signal-row">
            {landingMetrics.map((metric) => (
              <article key={metric.label} className="landing-signal-card">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.meta}</small>
              </article>
            ))}
          </div>
        </div>

        <aside className="landing-sentinel-panel" aria-label="Sentinel shell preview">
          <div className="landing-sentinel-panel__header">
            <div>
              <p>Sentinel Shell</p>
              <strong>Admin command rail preview</strong>
            </div>
            <span>NODE ACTIVE</span>
          </div>
          <div className="landing-sentinel-panel__layout">
            <nav className="landing-sentinel-panel__menu">
              {landingMenu.map((item, index) => (
                <div key={item} className={`landing-sentinel-panel__menu-item${index === 0 ? " landing-sentinel-panel__menu-item--active" : ""}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{item}</strong>
                </div>
              ))}
            </nav>
            <div className="landing-sentinel-panel__canvas">
              <div className="landing-sentinel-panel__search">QUERY_SYSTEM...</div>
              <div className="landing-sentinel-panel__metrics">
                <article>
                  <span>TOTAL_TRANSACTION_VOLUME</span>
                  <strong>$4.82B</strong>
                </article>
                <article>
                  <span>ACTIVE_NODE_COUNT</span>
                  <strong>1,024</strong>
                </article>
                <article>
                  <span>PENDING_APPROVALS</span>
                  <strong>42</strong>
                </article>
              </div>
            </div>
          </div>
        </aside>
      </section>

      <section className="landing-module-grid" id="modules">
        {landingFeeds.map((feed) => (
          <article key={feed.code} className="landing-module-card">
            <p>{feed.code}</p>
            <h2>{feed.detail}</h2>
            <span>Control-plane read surface</span>
          </article>
        ))}
      </section>

      <section className="landing-command-strip" id="guardrails">
        <article>
          <span>Guardrail 01</span>
          <strong>Menu visibility stays server-side.</strong>
        </article>
        <article>
          <span>Guardrail 02</span>
          <strong>High-risk operations stay behind CSRF + step-up OTP.</strong>
        </article>
        <article>
          <span>Guardrail 03</span>
          <strong>Stable read models keep operators off raw ledger joins.</strong>
        </article>
      </section>

      <section className="landing-command-board" id="command">
        <div>
          <p className="landing-hero__eyebrow">Command Board</p>
          <h2>One shell for approvals, funds, risk, and runtime posture.</h2>
        </div>
        <div className="landing-command-board__actions">
          <Link href="/dashboard" className="button button--primary">Launch Dashboard</Link>
          <Link href="/login" className="button button--secondary">Bind Operator Session</Link>
        </div>
      </section>
    </main>
  );
}
