"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";

import { clearPendingMfaEnrollment, readPendingMfaEnrollment } from "@/lib/admin-mfa-enrollment";
import {
  beginAdminMfaEnrollment,
  isAdminApiError,
  verifyAdminMfaEnrollment,
  type MfaEnrollBeginResponse,
} from "@/services/admin-api";

function formatCountdown(msRemaining: number): string {
  const seconds = Math.max(0, Math.floor(msRemaining / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export default function MfaEnrollPage() {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState(() => readPendingMfaEnrollment());
  const [beginState, setBeginState] = useState<MfaEnrollBeginResponse | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());

  const expiresAt = useMemo(() => {
    if (!enrollment) {
      return 0;
    }
    return enrollment.createdAt + enrollment.expiresIn * 1000;
  }, [enrollment]);

  useEffect(() => {
    if (!enrollment?.enrollmentToken) {
      router.replace("/login");
      return;
    }

    let active = true;
    async function loadEnrollment(): Promise<void> {
      try {
        const result = await beginAdminMfaEnrollment(enrollment.enrollmentToken);
        if (!active) {
          return;
        }
        setBeginState(result);
        const dataUrl = await QRCode.toDataURL(result.otpauthUrl, {
          width: 220,
          margin: 1,
          color: {
            dark: "#e2f7ff",
            light: "#0000",
          },
        });
        if (active) {
          setQrCodeDataUrl(dataUrl);
        }
      } catch (beginError) {
        if (!active) {
          return;
        }
        setError(beginError instanceof Error ? beginError.message : "无法初始化 MFA 绑定");
      }
    }

    setError(null);
    loadEnrollment().catch(() => undefined);

    return () => {
      active = false;
    };
  }, [enrollment, router]);

  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, []);

  function handleRestart(): void {
    clearPendingMfaEnrollment();
    router.replace("/login");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!enrollment || !beginState) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await verifyAdminMfaEnrollment({
          enrollmentToken: enrollment.enrollmentToken,
          factorId: beginState.factorId,
          otpCode,
        });
        clearPendingMfaEnrollment();
        router.replace("/dashboard");
      } catch (submitError) {
        if (isAdminApiError(submitError) && Date.now() >= expiresAt) {
          clearPendingMfaEnrollment();
          setEnrollment(null);
        }
        setError(submitError instanceof Error ? submitError.message : "MFA 绑定失败");
      }
    });
  }

  if (!enrollment) {
    return null;
  }

  const msRemaining = Math.max(0, expiresAt - now);

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
          <span className="auth-header__badge">MFA_Enrollment</span>
        </div>
        <div className="auth-header__status">
          <span className="auth-header__node-dot" />
          <span>CHALLENGE_TTL :: {formatCountdown(msRemaining)}</span>
          <span className="auth-header__shield">OTP</span>
        </div>
      </header>

      <section className="auth-main">
        <div className="auth-panel-corners" aria-hidden="true" />
        <div className="auth-panel auth-panel--wide">
          <div className="auth-panel__lead">
            <div className="auth-panel__lead-bar" aria-hidden="true" />
            <h1>Bind Google Authenticator</h1>
            <p>Restricted Enrollment Channel</p>
          </div>

          <div className="auth-enroll__summary">
            <div>
              <span className="auth-enroll__eyebrow">Pending Operator</span>
              <strong>{enrollment.maskedEmail}</strong>
            </div>
            <div>
              <span className="auth-enroll__eyebrow">Issuer</span>
              <strong>{enrollment.totpIssuer}</strong>
            </div>
            <div>
              <span className="auth-enroll__eyebrow">Status</span>
              <strong>{msRemaining > 0 ? "Awaiting Verification" : "Challenge Expired"}</strong>
            </div>
          </div>

          <div className="auth-enroll__grid">
            <section className="auth-enroll__card auth-enroll__card--qr">
              <span className="auth-enroll__eyebrow">Authenticator QR</span>
              <div className="auth-enroll__qr-shell">
                {qrCodeDataUrl ? (
                  <Image
                    src={qrCodeDataUrl}
                    alt="Google Authenticator enrollment QR code"
                    className="auth-enroll__qr-image"
                    width={220}
                    height={220}
                    unoptimized
                  />
                ) : (
                  <span className="auth-enroll__qr-loading">Generating secure payload...</span>
                )}
              </div>
              <p className="auth-panel__meta">
                Scan with Google Authenticator on a second device. If scanning is unavailable, use the manual entry key below.
              </p>
            </section>

            <section className="auth-enroll__card">
              <span className="auth-enroll__eyebrow">Manual Entry Key</span>
              <code className="auth-enroll__secret">{beginState?.manualEntryKey ?? "Loading..."}</code>
              <p className="auth-panel__meta">Account: {beginState?.accountName ?? enrollment.maskedEmail}</p>

              <form className="auth-form" onSubmit={handleSubmit}>
                <label className="auth-field" htmlFor="mfa-enroll-otp">
                  <span className="auth-field__label">First Verification Code</span>
                  <div className="auth-token-row">
                    <div className="auth-token-input-wrap">
                      <span className="auth-token-icon" aria-hidden="true">OTP</span>
                      <input
                        id="mfa-enroll-otp"
                        className="auth-field__input auth-field__input--token"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="000000"
                        value={otpCode}
                        onChange={(event) => setOtpCode(event.target.value.replaceAll(/\D/g, "").slice(0, 6))}
                      />
                    </div>
                    <div className="auth-token-clock" aria-hidden="true">{formatCountdown(msRemaining)}</div>
                  </div>
                </label>

                <p className="auth-panel__hint">
                  No admin session is issued until this code is verified successfully.
                </p>

                {error ? <p className="form-message form-message--error">{error}</p> : null}

                <div className="auth-enroll__actions">
                  <button type="submit" className="auth-submit" disabled={isPending || !beginState || msRemaining <= 0}>
                    <span>{isPending ? "Verifying..." : "Activate MFA"}</span>
                    <span aria-hidden="true">&gt;_</span>
                  </button>
                  <button type="button" className="auth-secondary" onClick={handleRestart}>
                    Restart Login
                  </button>
                </div>
              </form>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}