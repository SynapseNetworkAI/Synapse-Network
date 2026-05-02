import type { WithdrawalStatus } from "@/domain/status";
import { isAdminApiError } from "@/services/admin-api";

export type WithdrawReviewDecision = "APPROVE" | "REJECT";
export type WithdrawReviewActionPhase = "idle" | "awaitingOtp" | "submitting";

function getDecisionLabel(decision: WithdrawReviewDecision): string {
  return decision === "APPROVE" ? "放行" : "驳回";
}

export function getWithdrawReviewActionNotice(
  phase: WithdrawReviewActionPhase,
  decision: WithdrawReviewDecision | null
): string | null {
  if (!decision || phase === "idle") {
    return null;
  }

  if (phase === "awaitingOtp") {
    return `正在等待 Google Authenticator 验证码，完成验证后才会提交${getDecisionLabel(
      decision
    )}请求。`;
  }

  return `正在提交${getDecisionLabel(
    decision
  )}请求，请稍候，不要重复点击按钮。`;
}

export function getWithdrawReviewActionButtonLabel(
  decision: WithdrawReviewDecision,
  phase: WithdrawReviewActionPhase,
  activeDecision: WithdrawReviewDecision | null
): string {
  if (phase === "idle" || activeDecision !== decision) {
    return decision === "APPROVE" ? "确认放行" : "驳回申请";
  }

  if (phase === "awaitingOtp") {
    return "等待验证码...";
  }

  return decision === "APPROVE" ? "放行提交中..." : "驳回提交中...";
}

export function getWithdrawReviewActionErrorMessage(
  error: unknown,
  decision: WithdrawReviewDecision
): string {
  if (isAdminApiError(error)) {
    if ((error.message || "").includes("is not awaiting manual review")) {
      return "当前申请已不处于可审核状态，请刷新页面。";
    }
    if (
      error.status === 401 &&
      (error.message === "Missing admin session" ||
        error.message === "Admin session expired" ||
        error.message === "Invalid admin token")
    ) {
      return "管理员登录已失效，或浏览器没有携带后台 session cookie。请重新登录后台控制台后再审核。";
    }
    if (error.code === "INVALID_GOOGLE_AUTHENTICATOR_CODE") {
      return "验证码错误或已过期，请使用最新 6 位码重试。";
    }
    if ((error.message || "").includes("Invalid Google Authenticator code")) {
      return "验证码错误或已过期，请使用最新 6 位码重试。";
    }
    if (
      (error.message || "").includes("Google Authenticator code is required")
    ) {
      return `完成验证码验证后，系统才会提交${getDecisionLabel(
        decision
      )}请求。`;
    }
    if (
      error.status === 403 &&
      (error.message || "").includes("Invalid CSRF token")
    ) {
      return "当前页面安全校验令牌无效，请刷新页面后重试；如果仍然失败，请重新登录控制台。";
    }
    if (
      error.status === 403 &&
      (error.message || "").includes("Missing permission")
    ) {
      return "当前管理员缺少 approval:decide 权限，无法处理高危提现审核。";
    }
    return error.message;
  }

  if (error instanceof Error) {
    if (error.message === "已取消 Google Authenticator 验证") {
      return `已取消本次${getDecisionLabel(
        decision
      )}操作，后台还没有收到新的处理请求。`;
    }
    if (error.message === "Missing admin CSRF token") {
      return "当前页面缺少安全校验令牌，请刷新页面后重试；如果仍然失败，请重新登录控制台。";
    }
    return error.message;
  }

  return `提交${getDecisionLabel(decision)}请求失败，请稍后重试。`;
}

export function getWithdrawReviewActionSuccessMessage(input: {
  decision: WithdrawReviewDecision;
  status: WithdrawalStatus;
  message?: string | null;
}): string {
  const prefix =
    input.decision === "APPROVE" ? "已提交放行处理" : "已提交驳回处理";
  const detail = input.message?.trim();
  return detail
    ? `${prefix}，当前状态：${input.status}。${detail}`
    : `${prefix}，当前状态：${input.status}。`;
}
