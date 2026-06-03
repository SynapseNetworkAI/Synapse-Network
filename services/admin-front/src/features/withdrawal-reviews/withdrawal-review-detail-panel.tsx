import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";

import {
  MessageBanner,
  OverlayPanel,
  SentinelStatusChip,
  nativeTextAreaStyle,
} from "@/components/console-ui";
import { formatDateTime, formatUsdc, inputText } from "@/lib/admin-console";
import type { ProviderWithdrawReviewItem } from "@/services/admin-api";

import {
  getWithdrawReviewActionButtonLabel,
  type WithdrawReviewActionPhase,
  type WithdrawReviewDecision,
} from "./review-action-feedback";
import {
  getWithdrawReviewKindLabel,
  getWithdrawReviewKindTone,
  getWithdrawRiskLabel,
  getWithdrawRiskTone,
} from "./review-presenters";

export function WithdrawalReviewDetailPanel({
  actionPhase,
  canDecide,
  canSubmitActiveDecision,
  decisionNote,
  detailReview,
  error,
  isOpen,
  isPending,
  message,
  pendingDecision,
  onClose,
  onDecision,
  onDecisionNoteChange,
}: Readonly<{
  actionPhase: WithdrawReviewActionPhase;
  canDecide: boolean;
  canSubmitActiveDecision: boolean;
  decisionNote: string;
  detailReview: ProviderWithdrawReviewItem | null;
  error: string | null;
  isOpen: boolean;
  isPending: boolean;
  message: string | null;
  pendingDecision: WithdrawReviewDecision | null;
  onClose: () => void;
  onDecision: (decision: WithdrawReviewDecision) => void;
  onDecisionNoteChange: (value: string) => void;
}>) {
  return (
    <OverlayPanel
      open={isOpen && detailReview !== null}
      title={detailReview?.withdrawalId ?? "申请详情"}
      description="查看这笔提现的关键资料、处理依据和备注，确认后再提交放行或驳回。"
      onClose={onClose}
    >
      {detailReview ? (
        <WithdrawalReviewDetailContent
          actionPhase={actionPhase}
          canDecide={canDecide}
          canSubmitActiveDecision={canSubmitActiveDecision}
          decisionNote={decisionNote}
          detailReview={detailReview}
          error={error}
          isPending={isPending}
          message={message}
          pendingDecision={pendingDecision}
          onDecision={onDecision}
          onDecisionNoteChange={onDecisionNoteChange}
        />
      ) : null}
    </OverlayPanel>
  );
}

function WithdrawalReviewDetailContent({
  actionPhase,
  canDecide,
  canSubmitActiveDecision,
  decisionNote,
  detailReview,
  error,
  isPending,
  message,
  pendingDecision,
  onDecision,
  onDecisionNoteChange,
}: Readonly<{
  actionPhase: WithdrawReviewActionPhase;
  canDecide: boolean;
  canSubmitActiveDecision: boolean;
  decisionNote: string;
  detailReview: ProviderWithdrawReviewItem;
  error: string | null;
  isPending: boolean;
  message: string | null;
  pendingDecision: WithdrawReviewDecision | null;
  onDecision: (decision: WithdrawReviewDecision) => void;
  onDecisionNoteChange: (value: string) => void;
}>) {
  return (
    <Stack gap="14px">
      {error ? <MessageBanner kind="error" message={error} /> : null}
      {message ? <MessageBanner kind="success" message={message} /> : null}
      <WithdrawalReviewEvidenceSummary detailReview={detailReview} />
      <WithdrawalReviewFactGrid detailReview={detailReview} />
      <WithdrawalReviewDecisionNote
        decisionNote={decisionNote}
        onDecisionNoteChange={onDecisionNoteChange}
      />
      <WithdrawalReviewDecisionButtons
        actionPhase={actionPhase}
        canSubmitActiveDecision={canSubmitActiveDecision}
        isPending={isPending}
        pendingDecision={pendingDecision}
        onDecision={onDecision}
      />
      {canDecide ? null : (
        <MessageBanner
          kind="error"
          message="当前账号只有查看权限，不能提交处理结果。"
        />
      )}
    </Stack>
  );
}

function WithdrawalReviewEvidenceSummary({
  detailReview,
}: Readonly<{ detailReview: ProviderWithdrawReviewItem }>) {
  return (
    <Box
      borderRadius="20px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Stack direction="row" justify="space-between" align="center">
        <Text
          fontSize="11px"
          letterSpacing="0.16em"
          textTransform="uppercase"
          color="ink.500"
        >
          处理摘要
        </Text>
        <Stack direction="row" gap="8px">
          <SentinelStatusChip
            label={getWithdrawReviewKindLabel(detailReview)}
            tone={getWithdrawReviewKindTone(detailReview)}
          />
          <SentinelStatusChip
            label={getWithdrawRiskLabel(detailReview.riskLevel)}
            tone={getWithdrawRiskTone(detailReview.riskLevel)}
          />
        </Stack>
      </Stack>
      <Heading mt="10px" size="sm">
        {inputText(detailReview.evidenceSummary ?? detailReview.message)}
      </Heading>
      <Text mt="8px" color="ink.500">
        原因标签 {inputText(detailReview.riskReasonCode)} · 流水号{" "}
        {inputText(detailReview.txHash)}
      </Text>
    </Box>
  );
}

function WithdrawalReviewFactGrid({
  detailReview,
}: Readonly<{ detailReview: ProviderWithdrawReviewItem }>) {
  return (
    <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="10px">
      {reviewFactRows(detailReview).map(([label, value]) => (
        <Box
          key={label}
          borderRadius="20px"
          p="16px"
          bg="rgba(255,255,255,0.74)"
          border="1px solid rgba(99,92,82,0.10)"
        >
          <Text
            fontSize="11px"
            letterSpacing="0.16em"
            textTransform="uppercase"
            color="ink.500"
          >
            {label}
          </Text>
          <Heading mt="10px" size="sm">
            {value}
          </Heading>
        </Box>
      ))}
    </Grid>
  );
}

function WithdrawalReviewDecisionNote({
  decisionNote,
  onDecisionNoteChange,
}: Readonly<{
  decisionNote: string;
  onDecisionNoteChange: (value: string) => void;
}>) {
  return (
    <Box
      borderRadius="20px"
      p="16px"
      bg="rgba(255,255,255,0.74)"
      border="1px solid rgba(99,92,82,0.10)"
    >
      <Text
        fontSize="11px"
        letterSpacing="0.16em"
        textTransform="uppercase"
        color="ink.500"
      >
        处理备注
      </Text>
      <Box mt="10px">
        <textarea
          value={decisionNote}
          onChange={(event) => onDecisionNoteChange(event.target.value)}
          placeholder="填写核实结果、处理原因，或需要其他同事继续跟进的说明。"
          style={nativeTextAreaStyle}
        />
      </Box>
    </Box>
  );
}

function WithdrawalReviewDecisionButtons({
  actionPhase,
  canSubmitActiveDecision,
  isPending,
  pendingDecision,
  onDecision,
}: Readonly<{
  actionPhase: WithdrawReviewActionPhase;
  canSubmitActiveDecision: boolean;
  isPending: boolean;
  pendingDecision: WithdrawReviewDecision | null;
  onDecision: (decision: WithdrawReviewDecision) => void;
}>) {
  return (
    <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="10px">
      <Button
        bg="signal.500"
        color="white"
        borderRadius="18px"
        h="52px"
        onClick={() => onDecision("APPROVE")}
        disabled={!canSubmitActiveDecision}
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
        disabled={!canSubmitActiveDecision}
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

function reviewFactRows(
  detailReview: ProviderWithdrawReviewItem
): [string, string][] {
  return [
    ["用户地址", detailReview.ownerAddress],
    ["提现金额", `${formatUsdc(detailReview.amountUsdc)} USDC`],
    ["申请时间", formatDateTime(detailReview.createdAt)],
    ["审批过期时间", formatDateTime(detailReview.reviewExpiresAt)],
    ["申请编号", inputText(detailReview.requestId)],
  ];
}
