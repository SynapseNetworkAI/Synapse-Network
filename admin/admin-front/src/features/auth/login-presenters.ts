import type { AdminAuthSecurityPolicy } from "@/services/admin-api";

export function isLoginTotpEnabled(security: AdminAuthSecurityPolicy | null): boolean {
  return Boolean(security?.loginTotpRequired);
}

export function buildLoginRailDescription(security: AdminAuthSecurityPolicy | null): string {
  if (isLoginTotpEnabled(security)) {
    return "输入管理员邮箱、密码和验证码后进入控制台。";
  }
  return "输入管理员邮箱和密码后进入控制台。";
}

export function buildLoginRailFacts(security: AdminAuthSecurityPolicy | null): Array<{ label: string; value: string }> {
  return [
    { label: "Primary Session", value: "cookie-session" },
    { label: "Login TOTP", value: isLoginTotpEnabled(security) ? "required" : "disabled" },
  ];
}