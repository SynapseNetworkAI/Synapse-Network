import { describe, expect, it } from "vitest";

import {
  buildLoginErrorMessage,
  buildLoginFeedback,
  buildLoginRailDescription,
  buildLoginRailFacts,
  isLoginTotpEnabled,
} from "./login-presenters";

const enabledPolicy = {
  loginTotpRequired: true,
  highRiskTotpRequired: true,
  totpIssuer: "Synapse Gateway Admin",
};

const disabledPolicy = {
  loginTotpRequired: false,
  highRiskTotpRequired: true,
  totpIssuer: "Synapse Gateway Admin",
};

describe("login presenters", () => {
  it("marks login totp as enabled only when policy requires it", () => {
    expect(isLoginTotpEnabled(enabledPolicy)).toBe(true);
    expect(isLoginTotpEnabled(disabledPolicy)).toBe(false);
    expect(isLoginTotpEnabled(null)).toBe(false);
  });

  it("builds rail description from login totp policy", () => {
    expect(buildLoginRailDescription(enabledPolicy)).toBe("输入管理员邮箱、密码和验证码后进入控制台。");
    expect(buildLoginRailDescription(disabledPolicy)).toBe("输入管理员邮箱和密码后进入控制台。");
  });

  it("builds rail facts from login totp policy", () => {
    expect(buildLoginRailFacts(enabledPolicy)).toEqual([
      { label: "Primary Session", value: "cookie-session" },
      { label: "Login TOTP", value: "required" },
    ]);
    expect(buildLoginRailFacts(disabledPolicy)).toEqual([
      { label: "Primary Session", value: "cookie-session" },
      { label: "Login TOTP", value: "disabled" },
    ]);
  });

  it("shows an informational login prompt until a real login error exists", () => {
    expect(buildLoginFeedback(null, disabledPolicy)).toEqual({
      tone: "info",
      message: "请输入管理员邮箱和密码后进入控制台。",
    });
    expect(buildLoginFeedback(null, enabledPolicy)).toEqual({
      tone: "info",
      message: "请输入管理员邮箱、密码和 Google Authenticator 验证码后进入控制台。",
    });
    expect(buildLoginFeedback("登录失败", disabledPolicy)).toEqual({
      tone: "error",
      message: "登录失败",
    });
  });

  it("maps login failures to localized operator-facing messages", () => {
    expect(buildLoginErrorMessage(null, "Invalid admin credentials")).toBe("邮箱或密码不正确，请检查后重试。");
    expect(buildLoginErrorMessage("INVALID_GOOGLE_AUTHENTICATOR_CODE", "Invalid Google Authenticator code")).toBe(
      "验证码错误或已过期，请使用最新 6 位码重试。",
    );
    expect(buildLoginErrorMessage(null, "otpCode is required when login TOTP is enabled")).toBe(
      "请输入 Google Authenticator 的 6 位验证码。",
    );
    expect(buildLoginErrorMessage(null, "Failed to fetch")).toBe("暂时无法连接管理后台，请稍后重试。");
    expect(buildLoginErrorMessage("UNKNOWN", "backend internal detail")).toBe("登录失败，请检查登录信息后重试。");
  });
});
