import { describe, expect, it } from "vitest";

import {
  STEP_UP_SUBMIT_GUARD_SECONDS,
  getStepUpCountdownLabel,
  getStepUpCountdownTone,
  getStepUpExpiryHint,
  shouldDisableStepUpConfirm,
} from "./admin-step-up-presenters";

describe("admin-step-up presenters", () => {
  it("classifies countdown tones", () => {
    expect(getStepUpCountdownTone(18)).toBe("safe");
    expect(getStepUpCountdownTone(STEP_UP_SUBMIT_GUARD_SECONDS)).toBe("warning");
    expect(getStepUpCountdownTone(0)).toBe("expired");
  });

  it("disables confirmation for near-expiry, expired, and incomplete codes", () => {
    expect(shouldDisableStepUpConfirm({ remainingSeconds: 12, code: "123456", expiredNotice: false })).toBe(false);
    expect(shouldDisableStepUpConfirm({ remainingSeconds: 5, code: "123456", expiredNotice: false })).toBe(true);
    expect(shouldDisableStepUpConfirm({ remainingSeconds: 18, code: "12345", expiredNotice: false })).toBe(true);
    expect(shouldDisableStepUpConfirm({ remainingSeconds: 18, code: "123456", expiredNotice: true })).toBe(true);
  });

  it("builds countdown copy and expiry hints", () => {
    expect(getStepUpCountdownLabel(22)).toBe("code refresh in 22s");
    expect(getStepUpCountdownLabel(3)).toBe("refreshing now 3s");
    expect(getStepUpCountdownLabel(0)).toBe("code expired");
    expect(getStepUpExpiryHint(4)).toContain("暂时锁定确认按钮");
    expect(getStepUpExpiryHint(0)).toContain("等待新 6 位码刷新");
    expect(getStepUpExpiryHint(18)).toBeNull();
  });
});