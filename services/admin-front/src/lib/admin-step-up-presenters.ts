export const STEP_UP_SUBMIT_GUARD_SECONDS = 5;

export function getStepUpCountdownTone(remainingSeconds: number): "safe" | "warning" | "expired" {
  if (remainingSeconds <= 0) {
    return "expired";
  }
  if (remainingSeconds <= STEP_UP_SUBMIT_GUARD_SECONDS) {
    return "warning";
  }
  return "safe";
}

export function shouldDisableStepUpConfirm(input: {
  remainingSeconds: number;
  code: string;
  expiredNotice: boolean;
}): boolean {
  if (input.expiredNotice) {
    return true;
  }
  if (input.remainingSeconds <= STEP_UP_SUBMIT_GUARD_SECONDS) {
    return true;
  }
  return input.code.trim().length !== 6;
}

export function getStepUpCountdownLabel(remainingSeconds: number): string {
  if (remainingSeconds <= 0) {
    return "code expired";
  }
  if (remainingSeconds <= STEP_UP_SUBMIT_GUARD_SECONDS) {
    return `refreshing now ${remainingSeconds}s`;
  }
  return `code refresh in ${remainingSeconds}s`;
}

export function getStepUpExpiryHint(remainingSeconds: number): string | null {
  if (remainingSeconds <= 0) {
    return "当前验证码周期已结束，请等待新 6 位码刷新后再确认。";
  }
  if (remainingSeconds <= STEP_UP_SUBMIT_GUARD_SECONDS) {
    return "验证码即将过期，系统已暂时锁定确认按钮，请等待下一轮 6 位码刷新。";
  }
  return null;
}