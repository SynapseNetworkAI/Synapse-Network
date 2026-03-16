"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, useTransition } from "react";

import { clearAdminSession, persistAdminSession, readAdminToken } from "@/lib/admin-session";
import { loginAdmin } from "@/services/admin-api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("ops@synapse.network");
  const [otpCode, setOtpCode] = useState("123456");
  const [password, setPassword] = useState("phase1-placeholder");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (readAdminToken()) {
      router.replace("/dashboard");
    }
  }, [router]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        clearAdminSession();
        const response = await loginAdmin({ email, password, otpCode });
        persistAdminSession(response.accessToken, response.admin);
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
          <Link href="/approvals" className="button button--secondary">
            查看审批中心
          </Link>
        </div>
      </section>
      <section className="login-card">
        <div>
          <p className="login-card__eyebrow">管理员登录</p>
          <h2>SSO + MFA</h2>
          <p className="login-card__text">当前为骨架页面，后续接入企业 SSO、设备校验和二次认证。</p>
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
            <span>占位密码</span>
            <input
              type="password"
              placeholder="phase1-placeholder"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            <span>一次性验证码</span>
            <input
              type="text"
              placeholder="123456"
              value={otpCode}
              onChange={(event) => setOtpCode(event.target.value)}
            />
          </label>
          {error ? <p className="form-message form-message--error">{error}</p> : null}
          <button type="submit" className="button button--primary button--full" disabled={isPending}>
            {isPending ? "登录中..." : "登录并进入控制台"}
          </button>
        </form>
      </section>
    </main>
  );
}
