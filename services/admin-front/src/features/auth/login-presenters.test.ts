import { describe, expect, it } from "vitest";

import { buildLoginRailDescription, buildLoginRailFacts, isLoginTotpEnabled } from "./login-presenters";

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
});