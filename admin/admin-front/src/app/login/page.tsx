"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, useTransition } from "react";

import { getAdminAuthPolicy, getCurrentAdmin, loginAdmin, type AdminAuthSecurityPolicy } from "@/services/admin-api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("super@synapse.network");
  const [otpCode, setOtpCode] = useState("");
  const [password, setPassword] = useState("");
  const [security, setSecurity] = useState<AdminAuthSecurityPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

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
        setError(submitError instanceof Error ? submitError.message : "登录失败");
      }
    });
  }

  return (
    <main className="login-page">
      <section className="login-hero">
        <p className="hero-chip">Synapse Admin Front</p>
        <h1>把高风险运营动作从交易流量里拆出去。</h1>
        <p>
          管理后台仅承载控制面职责：管理员认证、审批流、审计查询、财务受控操作。
        </p>
        <div className="hero-actions">
          <Link href="/dashboard" className="button button--primary">
            进入控制台样例
          </Link>
          <Link href="/users" className="button button--secondary">
            查看后台模块树
          </Link>
        </div>
      </section>
      <section className="login-card">
        <div>
          <p className="login-card__eyebrow">管理员登录</p>
          <h2>SSO + Google Authenticator</h2>
          <p className="login-card__text">
            当前登录策略由 gateway-admin 服务端下发，支持按配置开启登录态 Google Authenticator 校验。
          </p>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            <span>邮箱</span>
            <input
              type="email"
              placeholder="admin@synapse.network"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            <span>初始密码</span>
            <input
              type="password"
              placeholder="Init@StrongPassword"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {security?.loginTotpRequired ? (
            <label>
              <span>Google Authenticator 验证码</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="123456"
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value)}
              />
            </label>
          ) : (
            <p className="login-card__text">当前环境未开启登录 TOTP，可使用邮箱与密码直接建立管理员会话。</p>
          )}
          {security ? (
            <p className="panel__text">Issuer: {security.totpIssuer} · 高风险动作 {security.highRiskTotpRequired ? "仍需二次验证码" : "当前未要求二次验证码"}</p>
          ) : null}
          {error ? <p className="form-message form-message--error">{error}</p> : null}
          <button type="submit" className="button button--primary button--full" disabled={isPending}>
            {isPending ? "登录中..." : "登录并进入控制台"}
          </button>
        </form>
      </section>
    </main>
  );
}
