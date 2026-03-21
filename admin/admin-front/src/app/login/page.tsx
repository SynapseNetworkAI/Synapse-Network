"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, useTransition } from "react";

import { clearPendingMfaEnrollment, savePendingMfaEnrollment } from "@/lib/admin-mfa-enrollment";
import {
  getAdminAuthPolicy,
  getCurrentAdmin,
  isAdminApiError,
  loginAdmin,
  type AdminAuthSecurityPolicy,
  type MfaEnrollmentRequiredData,
} from "@/services/admin-api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("super@synapse.network");
  const [otpCode, setOtpCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [security, setSecurity] = useState<AdminAuthSecurityPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    clearPendingMfaEnrollment();

    void getAdminAuthPolicy()
      .then((policy) => {
        if (!cancelled) {
          setSecurity(policy);
        }
      })
      .catch(() => undefined);

    void getCurrentAdmin("cookie-session")
      .then(() => {
        if (!cancelled) {
          router.replace("/dashboard");
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [router]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await loginAdmin({
          email,
          password,
          otpCode: security?.loginTotpRequired ? otpCode : undefined,
        });
        router.push("/dashboard");
      } catch (submitError) {
        if (isAdminApiError(submitError) && submitError.code === "MFA_ENROLLMENT_REQUIRED") {
          const enrollment = submitError.data as MfaEnrollmentRequiredData | undefined;
          if (enrollment?.enrollmentToken) {
            savePendingMfaEnrollment(enrollment);
            router.push("/login/mfa-enroll");
            return;
          }
        }
        setError(submitError instanceof Error ? submitError.message : "登录失败");
      }
    });
  }

  return (
    <main className="auth-screen">
      <div className="auth-screen__grid" />
      <div className="auth-screen__dots" />
      <div className="auth-screen__scanline" />
      <div className="auth-screen__orb auth-screen__orb--left">
        <div className="auth-screen__orb-core" />
      </div>
      <div className="auth-screen__orb auth-screen__orb--right">
        <div className="auth-screen__orb-core auth-screen__orb-core--reverse" />
      </div>

      <header className="auth-header">
        <div className="auth-header__brand">
          <div className="auth-header__logo" aria-hidden="true">
            <span className="auth-header__logo-dot" />
          </div>
          <span className="auth-header__title">Synapse Network</span>
          <span className="auth-header__badge">Admin_Portal</span>
        </div>
        <div className="auth-header__status">
          <span className="auth-header__node-dot" />
          <span>NODE_ACTIVE :: 0x4F...32A</span>
          <span className="auth-header__shield">SEC</span>
        </div>
      </header>

      <section className="auth-main">
        <div className="auth-panel-corners" aria-hidden="true" />
        <div className="auth-panel">
          <div className="auth-panel__lead">
            <div className="auth-panel__lead-bar" aria-hidden="true" />
            <h1>System Authorization</h1>
            <p>Gateway Control Plane v4.0.8</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-field" htmlFor="admin-email">
              <span className="auth-field__label">Operator Identification</span>
              <input
                id="admin-email"
                className="auth-field__input"
                type="email"
                placeholder="EMAIL_UID"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="auth-field" htmlFor="admin-password">
              <span className="auth-field__row">
                <span className="auth-field__label">Access Cipher</span>
                <button className="auth-field__link" type="button" onClick={() => setPassword("")}>RECOVER_KEY</button>
              </span>
              <span className="auth-field__password-wrap">
                <input
                  id="admin-password"
                  className="auth-field__input"
                  type={showPassword ? "text" : "password"}
                  placeholder="PASSWORD"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="auth-field__toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? "HIDE" : "SHOW"}
                </button>
              </span>
            </label>

            <label className="auth-field" htmlFor="admin-otp">
              <span className="auth-field__label">Google Authenticator Token</span>
              <div className="auth-token-row">
                <div className="auth-token-input-wrap">
                  <span className="auth-token-icon" aria-hidden="true">OTP</span>
                  <input
                    id="admin-otp"
                    className="auth-field__input auth-field__input--token"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    value={otpCode}
                    onChange={(event) => setOtpCode(event.target.value.replaceAll(/\D/g, "").slice(0, 6))}
                  />
                </div>
                <div className="auth-token-clock" aria-hidden="true">SYNC</div>
              </div>
            </label>

            {security ? (
              <>
                <p className="auth-panel__meta">
                  Issuer: {security.totpIssuer} · 登录 TOTP {security.loginTotpRequired ? "ENABLED" : "OPTIONAL"} · 高风险二次验证 {security.highRiskTotpRequired ? "ACTIVE" : "OFF"}
                </p>
                <p className="auth-panel__hint">
                  Bootstrap admins are already MFA-bound. Only accounts without an active Google Authenticator factor will enter enrollment.
                </p>
              </>
            ) : (
              <p className="auth-panel__meta">Security policy handshake in progress...</p>
            )}

            {error ? <p className="form-message form-message--error">{error}</p> : null}

            <button type="submit" className="auth-submit" disabled={isPending}>
              <span>{isPending ? "Executing..." : "Execute Initialization"}</span>
              <span aria-hidden="true">&gt;_</span>
            </button>
          </form>

          <div className="auth-monitor">
            <div className="auth-monitor__row">
              <span>Terminal_Status</span>
              <span className="auth-monitor__accent">Encrypted_Link</span>
            </div>
            <div className="auth-monitor__track">
              <div className="auth-monitor__progress" />
            </div>
          </div>
        </div>

        <div className="auth-main__meta">
          <div className="auth-main__meta-line" />
          <span>Layer-2 Validation Active</span>
          <div className="auth-main__meta-line" />
        </div>
        <p className="auth-main__meta-copy">SECURE_SENTINEL_PROTOCOL_v4.2 // AGENT_ID: 88-ALPHA</p>
      </section>

      <footer className="auth-footer">
        <span>© 2024 Synapse Network. Consensus Reached.</span>
        <div className="auth-footer__links">
          <button type="button">Neural_Net_TOS</button>
          <button type="button" className="auth-footer__links--active">Blockchain_Sec</button>
          <button type="button">Node_Metrics</button>
        </div>
      </footer>
    </main>
  );
}
