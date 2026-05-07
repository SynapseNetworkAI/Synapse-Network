import { Button, Grid } from "@chakra-ui/react";

import { MessageBanner } from "@/components/console-ui";

import {
  getWithdrawReviewActionButtonLabel,
  type WithdrawReviewActionPhase,
  type WithdrawReviewDecision,
} from "./review-action-feedback";

type ReviewDecisionActionsProps = {
  canDecide: boolean;
  isLocked: boolean;
  lockMessage: string;
  isPending: boolean;
  hasActiveReview: boolean;
  pendingDecision: WithdrawReviewDecision | null;
  actionPhase: WithdrawReviewActionPhase;
  onDecision: (decision: WithdrawReviewDecision) => void;
};

export function ReviewDecisionActions({
  canDecide,
  isLocked,
  lockMessage,
  isPending,
  hasActiveReview,
  pendingDecision,
  actionPhase,
  onDecision,
}: ReviewDecisionActionsProps) {
  if (!canDecide) {
    return (
      <MessageBanner
        kind="error"
        message="当前账号只有查看权限，不能提交处理结果。"
      />
    );
  }

  if (isLocked) {
    return <MessageBanner kind="success" message={lockMessage} />;
  }

  return (
    <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="10px">
      <Button
        bg="signal.500"
        color="white"
        borderRadius="18px"
        h="52px"
        onClick={() => onDecision("APPROVE")}
        disabled={isPending || !hasActiveReview}
        loading={
          isPending &&
          pendingDecision === "APPROVE" &&
          actionPhase === "submitting"
        }
        loadingText="放行提交中"
      >
        {getWithdrawReviewActionButtonLabel(
          "APPROVE",
          actionPhase,
          pendingDecision
        )}
      </Button>
      <Button
        bg="#b83131"
        color="white"
        borderRadius="18px"
        h="52px"
        onClick={() => onDecision("REJECT")}
        disabled={isPending || !hasActiveReview}
        loading={
          isPending &&
          pendingDecision === "REJECT" &&
          actionPhase === "submitting"
        }
        loadingText="驳回提交中"
      >
        {getWithdrawReviewActionButtonLabel(
          "REJECT",
          actionPhase,
          pendingDecision
        )}
      </Button>
    </Grid>
  );
}
