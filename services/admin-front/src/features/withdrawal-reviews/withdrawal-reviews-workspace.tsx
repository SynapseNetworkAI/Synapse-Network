"use client";

import { Box, Button, Text } from "@chakra-ui/react";
import Link from "next/link";
import { useMemo } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { useAdminStepUp } from "@/lib/use-admin-step-up";
import { useAdminSession } from "@/lib/use-admin-session";

import {
  canSubmitWithdrawReviewDecision,
  getWithdrawReviewActionNotice,
} from "./review-action-feedback";
import {
  buildWithdrawReasonClusters,
  buildWithdrawReviewMetrics,
} from "./review-presenters";
import { useProviderWithdrawReviews } from "./use-provider-withdraw-reviews";
import { useWithdrawalReviewDetail } from "./use-withdrawal-review-detail";
import { useWithdrawalReviewFilters } from "./use-withdrawal-review-filters";
import { WithdrawalReviewDetailPanel } from "./withdrawal-review-detail-panel";
import { WithdrawalReviewQueue } from "./withdrawal-review-queue";
import {
  WithdrawalReviewInsights,
  WithdrawalReviewMetricGrid,
} from "./withdrawal-review-summary";

export function WithdrawalReviewsWorkspace() {
  const controller = useWithdrawalReviewsController();

  if (controller.loading || !controller.admin) {
    return (
      <ControlPlaneLoadingScreen
        title="提现处理同步中"
        message="正在加载待处理的提现申请..."
      />
    );
  }

  return (
    <WithdrawalReviewsShell
      admin={controller.admin}
      canDecide={controller.canDecide}
      detail={controller.detail}
      filters={controller.filters}
      metrics={controller.metrics}
      reasonClusters={controller.reasonClusters}
      reviewState={controller.reviewState}
      stepUpModal={controller.stepUpModal}
    />
  );
}

function WithdrawalReviewsShell({
  admin,
  canDecide,
  detail,
  filters,
  metrics,
  reasonClusters,
  reviewState,
  stepUpModal,
}: Readonly<
  Omit<
    ReturnType<typeof useWithdrawalReviewsController>,
    "admin" | "loading"
  > & {
    admin: NonNullable<
      ReturnType<typeof useWithdrawalReviewsController>["admin"]
    >;
  }
>) {
  return (
    <AdminShell
      admin={admin}
      eyebrow="提现处理"
      title="提现审核工作台"
      description="集中查看需要人工确认的提现申请，帮助业务、财务和风控同学更快判断该放行、驳回，还是继续跟进。"
      actions={
        <Link href="/review-history">
          <Button size="sm" borderRadius="full">
            审核历史
          </Button>
        </Link>
      }
    >
      <WithdrawalReviewNotices
        actionNotice={reviewActionNotice(reviewState)}
        error={reviewState.error}
        message={reviewState.message}
      />
      <WithdrawalReviewMetricGrid metrics={metrics} />
      <WithdrawalReviewQueue
        canDecide={canDecide}
        filters={filters}
        items={reviewState.items}
        onOpenDetail={detail.openReviewDetail}
      />
      <WithdrawalReviewInsights reasonClusters={reasonClusters} />
      <WithdrawalReviewDetailPanel
        actionPhase={reviewState.actionPhase}
        canDecide={canDecide}
        canSubmitActiveDecision={canSubmitWithdrawReviewDecision({
          canDecide,
          isPending: reviewState.isPending,
          status: detail.detailReview?.status,
        })}
        decisionNote={reviewState.decisionNote}
        detailReview={detail.detailReview}
        error={reviewState.error}
        isOpen={detail.isDetailOpen}
        isPending={reviewState.isPending}
        message={reviewState.message}
        pendingDecision={reviewState.pendingDecision}
        onClose={detail.closeReviewDetail}
        onDecision={reviewState.handleDecision}
        onDecisionNoteChange={reviewState.setDecisionNote}
      />
      {stepUpModal}
    </AdminShell>
  );
}

function useWithdrawalReviewsController() {
  const { admin, security, token, loading } = useAdminSession();
  const { requestStepUpCode, stepUpModal } = useAdminStepUp(
    buildStepUpOptions(security)
  );
  const reviewState = useProviderWithdrawReviews(token, requestStepUpCode);
  const filters = useWithdrawalReviewFilters(reviewState.items);
  const detail = useWithdrawalReviewDetail({
    activeReviewId: reviewState.activeReviewId,
    filteredItems: filters.filteredItems,
    resetActionState: reviewState.resetActionState,
    setActiveReviewId: reviewState.setActiveReviewId,
    setDecisionNote: reviewState.setDecisionNote,
    setMessage: reviewState.setMessage,
  });
  const metrics = useMemo(
    () => buildWithdrawReviewMetrics(reviewState.items),
    [reviewState.items]
  );
  const reasonClusters = useMemo(
    () => buildWithdrawReasonClusters(reviewState.items).slice(0, 4),
    [reviewState.items]
  );

  return {
    admin,
    canDecide: adminCanDecide(admin),
    detail,
    filters,
    loading,
    metrics,
    reasonClusters,
    reviewState,
    stepUpModal,
  };
}

function WithdrawalReviewNotices({
  actionNotice,
  error,
  message,
}: Readonly<{
  actionNotice: string | null;
  error: string | null;
  message: string | null;
}>) {
  return (
    <>
      {error ? <MessageBanner kind="error" message={error} /> : null}
      {message ? <MessageBanner kind="success" message={message} /> : null}
      {actionNotice ? (
        <Box
          borderRadius="18px"
          border="1px solid rgba(15,17,21,0.08)"
          bg="rgba(15,17,21,0.03)"
          p="14px 16px"
        >
          <Text fontWeight="600" color="ink.700">
            {actionNotice}
          </Text>
        </Box>
      ) : null}
    </>
  );
}

function reviewActionNotice({
  actionPhase,
  pendingDecision,
}: ReturnType<typeof useProviderWithdrawReviews>) {
  return getWithdrawReviewActionNotice(actionPhase, pendingDecision);
}

function buildStepUpOptions(
  security: ReturnType<typeof useAdminSession>["security"]
) {
  return {
    enabled: security?.highRiskTotpRequired ?? false,
    issuer: security?.totpIssuer ?? "Synapse Gateway Admin",
  };
}

function adminCanDecide(admin: ReturnType<typeof useAdminSession>["admin"]) {
  return admin?.permissions.includes("approval:decide") ?? false;
}
