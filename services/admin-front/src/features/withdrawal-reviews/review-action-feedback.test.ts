import { describe, expect, it } from "vitest";

import { AdminApiError } from "@/services/admin-api";

import {
  getWithdrawReviewActionButtonLabel,
  getWithdrawReviewActionErrorMessage,
  getWithdrawReviewActionNotice,
  getWithdrawReviewActionSuccessMessage,
} from "./review-action-feedback";

describe("review-action-feedback", () => {
  it("builds pending notices for OTP and submit phases", () => {
    expect(getWithdrawReviewActionNotice("awaitingOtp", "APPROVE")).toContain(
      "等待 Google Authenticator 验证码"
    );
    expect(getWithdrawReviewActionNotice("submitting", "REJECT")).toContain(
      "正在提交驳回请求"
    );
    expect(getWithdrawReviewActionNotice("submitted", "APPROVE")).toContain(
      "已提交放行处理"
    );
    expect(getWithdrawReviewActionNotice("idle", null)).toBeNull();
  });

  it("builds button labels for the active decision", () => {
    expect(getWithdrawReviewActionButtonLabel("APPROVE", "idle", null)).toBe(
      "确认放行"
    );
    expect(
      getWithdrawReviewActionButtonLabel("APPROVE", "awaitingOtp", "APPROVE")
    ).toBe("等待验证码...");
    expect(
      getWithdrawReviewActionButtonLabel("REJECT", "submitting", "REJECT")
    ).toBe("驳回提交中...");
    expect(
      getWithdrawReviewActionButtonLabel("APPROVE", "submitted", "APPROVE")
    ).toBe("已提交放行");
    expect(
      getWithdrawReviewActionButtonLabel("REJECT", "submitted", "REJECT")
    ).toBe("已提交驳回");
  });

  it("maps OTP, CSRF, and cancellation errors to operator-friendly messages", () => {
    expect(
      getWithdrawReviewActionErrorMessage(
        new AdminApiError("Invalid Google Authenticator code", {
          status: 401,
          code: "INVALID_GOOGLE_AUTHENTICATOR_CODE",
        }),
        "APPROVE"
      )
    ).toContain("验证码错误或已过期");
    expect(
      getWithdrawReviewActionErrorMessage(
        new AdminApiError("Admin Google Authenticator is not configured", {
          status: 401,
          code: "UNAUTHORIZED",
        }),
        "APPROVE"
      )
    ).toContain("还没有绑定可用的 Google Authenticator");
    expect(
      getWithdrawReviewActionErrorMessage(
        new AdminApiError(
          "Withdrawal status=CANCELLED is not awaiting manual review",
          { status: 400, code: "BAD_REQUEST" }
        ),
        "APPROVE"
      )
    ).toContain("当前申请已不处于可审核状态，请刷新页面");
    expect(
      getWithdrawReviewActionErrorMessage(
        new Error("Missing admin CSRF token"),
        "APPROVE"
      )
    ).toContain("安全校验令牌");
    expect(
      getWithdrawReviewActionErrorMessage(
        new Error("已取消 Google Authenticator 验证"),
        "REJECT"
      )
    ).toContain("后台还没有收到");
  });

  it("maps admin auth and permission failures to recovery-oriented messages", () => {
    expect(
      getWithdrawReviewActionErrorMessage(
        new AdminApiError("Missing admin session", {
          status: 401,
          code: "UNAUTHORIZED",
        }),
        "APPROVE"
      )
    ).toContain("重新登录后台控制台");
    expect(
      getWithdrawReviewActionErrorMessage(
        new AdminApiError("Invalid CSRF token", {
          status: 403,
          code: "FORBIDDEN",
        }),
        "APPROVE"
      )
    ).toContain("安全校验令牌无效");
    expect(
      getWithdrawReviewActionErrorMessage(
        new AdminApiError("Missing permission: approval:decide", {
          status: 403,
          code: "FORBIDDEN",
        }),
        "REJECT"
      )
    ).toContain("approval:decide");
  });

  it("builds a business-facing success message", () => {
    expect(
      getWithdrawReviewActionSuccessMessage({
        decision: "APPROVE",
        status: "APPROVED_AUTO",
        message: "系统已记录本次处理备注。",
      })
    ).toBe("已提交放行处理，当前状态：APPROVED_AUTO。系统已记录本次处理备注。");
  });
});
