import { describe, expect, it } from "vitest";

import { AdminApiError } from "@/services/admin-api";

import {
  canSubmitWithdrawReviewDecision,
  getWithdrawReviewActionButtonLabel,
  getWithdrawReviewActionErrorMessage,
  getWithdrawReviewActionNotice,
  getWithdrawReviewActionSuccessMessage,
  getWithdrawReviewSubmittedNotice,
} from "./review-action-feedback";

describe("review-action-feedback", () => {
  it("builds pending notices for OTP and submit phases", () => {
    expect(getWithdrawReviewActionNotice("awaitingOtp", "APPROVE")).toContain(
      "等待 Google Authenticator 验证码"
    );
    expect(getWithdrawReviewActionNotice("submitting", "REJECT")).toContain(
      "正在提交驳回请求"
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
    ).toContain("当前申请已提交处理，请刷新页面");
    expect(
      getWithdrawReviewActionErrorMessage(
        new AdminApiError("当前提现申请已提交处理，请刷新页面查看最新状态。", {
          status: 400,
          code: "BAD_REQUEST",
        }),
        "APPROVE"
      )
    ).toContain("当前申请已提交处理，请刷新页面");
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
        status: "REQUESTED",
        message: "系统已记录本次处理备注。",
      })
    ).toBe("已提交放行处理，系统正在同步提现状态。");
    expect(
      getWithdrawReviewActionSuccessMessage({
        decision: "REJECT",
        status: "REQUESTED",
        message: null,
      })
    ).toBe("已提交驳回处理，系统正在同步提现状态。");
    expect(getWithdrawReviewSubmittedNotice("APPROVE")).toBe(
      "已提交放行处理，请等待提现状态同步。"
    );
  });

  it("only allows decisions while a review is still pending manual review", () => {
    expect(
      canSubmitWithdrawReviewDecision({
        canDecide: true,
        isPending: false,
        status: "PENDING_MANUAL_REVIEW",
      })
    ).toBe(true);
    expect(
      canSubmitWithdrawReviewDecision({
        canDecide: true,
        isPending: false,
        status: "REQUESTED",
      })
    ).toBe(false);
    expect(
      canSubmitWithdrawReviewDecision({
        canDecide: true,
        isPending: true,
        status: "PENDING_MANUAL_REVIEW",
      })
    ).toBe(false);
  });
});
