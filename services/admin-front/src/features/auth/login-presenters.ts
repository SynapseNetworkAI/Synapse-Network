import type { AdminAuthSecurityPolicy } from "@/services/admin-api";

export type LoginFeedback = {
  tone: "info" | "error";
  message: string;
};

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

export function buildLoginFeedback(error: string | null, security: AdminAuthSecurityPolicy | null): LoginFeedback {
  if (error) {
    return { tone: "error", message: error };
  }

  if (isLoginTotpEnabled(security)) {
    return { tone: "info", message: "请输入管理员邮箱、密码和 Google Authenticator 验证码后进入控制台。" };
  }

  return { tone: "info", message: "请输入管理员邮箱和密码后进入控制台。" };
}

export function buildLoginErrorMessage(code: string | null, message: string | null): string {
  if (code === "INVALID_GOOGLE_AUTHENTICATOR_CODE" || message === "Invalid Google Authenticator code") {
    return "验证码错误或已过期，请使用最新 6 位码重试。";
  }

  if (message === "otpCode is required when login TOTP is enabled") {
    return "请输入 Google Authenticator 的 6 位验证码。";
  }

  if (message === "Invalid admin credentials") {
    return "邮箱或密码不正确，请检查后重试。";
  }

  if (message === "Failed to fetch") {
    return "暂时无法连接管理后台，请稍后重试。";
  }

  return "登录失败，请检查登录信息后重试。";
}
