"use client";

type AdminStepUpModalProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  issuer: string;
  code: string;
  error: string | null;
  expiredNotice: boolean;
  remainingSeconds: number;
  onCodeChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function AdminStepUpModal({
  open,
  title,
  description,
  confirmLabel,
  issuer,
  code,
  error,
  expiredNotice,
  remainingSeconds,
  onCodeChange,
  onCancel,
  onConfirm,
}: Readonly<AdminStepUpModalProps>) {
  return (
    <>
      <button
        type="button"
        className={`step-up-backdrop${open ? " step-up-backdrop--open" : ""}`}
        onClick={onCancel}
        aria-label="关闭二次验证窗口"
      />
      <section className={`step-up-modal${open ? " step-up-modal--open" : ""}`} aria-hidden={!open}>
        <div className="step-up-modal__header">
          <div>
            <p className="panel__eyebrow">Step-up Verification</p>
            <h3 className="panel__title">{title}</h3>
            <p className="panel__text">{description}</p>
          </div>
          <button type="button" className="ghost-button" onClick={onCancel}>取消</button>
        </div>
        <div className="step-up-modal__signal-row">
          <span className="status-pill status-pill--alert">high-risk action</span>
          <span className="permission-chip">issuer {issuer}</span>
          <span className={`permission-chip${remainingSeconds <= 5 ? " step-up-chip--warning" : ""}`}>
            code refresh in {remainingSeconds}s
          </span>
        </div>
        <form
          className="admin-form step-up-modal__form"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          <label>
            <span>Google Authenticator 验证码</span>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              placeholder="123456"
              value={code}
              onChange={(event) => onCodeChange(event.target.value)}
            />
          </label>
          <p className="panel__text">此验证码只用于当前一步高风险动作，不会替代当前管理员 session。</p>
          {expiredNotice ? <p className="form-message form-message--error">验证码已过期，请输入新的 6 位验证码。</p> : null}
          {error ? <p className="form-message form-message--error">{error}</p> : null}
          <div className="step-up-modal__actions">
            <button type="button" className="button button--secondary" onClick={onCancel}>取消</button>
            <button type="submit" className="button button--primary">{confirmLabel}</button>
          </div>
        </form>
      </section>
    </>
  );
}