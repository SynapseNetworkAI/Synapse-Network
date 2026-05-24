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
    expect(buildLoginRailDescription(enabledPolicy)).toBe(
      "输入管理员邮箱、密码和 Google Authenticator 验证码后进入控制台。"
    );
    expect(buildLoginRailDescription(disabledPolicy)).toBe(
      "输入管理员邮箱和密码开始登录；若账号尚未绑定 Google Authenticator，将在密码验证通过后进入首绑流程。"
    );
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
      message:
        "请输入管理员邮箱和密码。只有密码验证通过后，系统才会允许未绑定账号进入 Google Authenticator 首绑流程。",
    });
    expect(buildLoginFeedback(null, enabledPolicy)).toEqual({
      tone: "info",
      message:
        "请输入管理员邮箱、密码和 Google Authenticator 验证码后进入控制台。",
    });
    expect(buildLoginFeedback("登录失败", disabledPolicy)).toEqual({
      tone: "error",
      message: "登录失败",
    });
  });

  it("maps login failures to localized operator-facing messages", () => {
    expect(buildLoginErrorMessage(null, "Invalid admin credentials")).toBe(
      "邮箱或密码不正确，请检查后重试。"
    );
    expect(
      buildLoginErrorMessage(
        "INVALID_GOOGLE_AUTHENTICATOR_CODE",
        "Invalid Google Authenticator code"
      )
    ).toBe("验证码错误或已过期，请使用最新 6 位码重试。");
    expect(
      buildLoginErrorMessage(
        null,
        "otpCode is required when login TOTP is enabled"
      )
    ).toBe("请输入 Google Authenticator 的 6 位验证码。");
    expect(
      buildLoginErrorMessage(
        "ADMIN_ACCOUNT_LOCKED",
        "Admin account is temporarily locked. Try later or contact an owner."
      )
    ).toBe(
      "该账号已被登录失败保护锁定，默认锁定 24 小时；请稍后重试或联系 Owner 解锁。"
    );
    expect(buildLoginErrorMessage(null, "Failed to fetch")).toBe(
      "暂时无法连接管理后台，请稍后重试。"
    );
    expect(
      buildLoginErrorMessage(
        null,
        'Unexpected token "I", "Internal Server Error" is not valid JSON'
      )
    ).toBe(
      "认证服务返回了非预期响应，请检查 gateway-admin 是否已启动、日志是否有 Internal Server Error，并确认 admin-front 的 API 地址或代理配置正确。"
    );
    expect(buildLoginErrorMessage("UNKNOWN", "backend internal detail")).toBe(
      "登录失败，请检查登录信息后重试。"
    );
  });
});
