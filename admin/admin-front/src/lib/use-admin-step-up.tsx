"use client";

import { useEffect, useRef, useState } from "react";

import { AdminStepUpModal } from "@/components/admin-step-up-modal";
import { shouldDisableStepUpConfirm } from "@/lib/admin-step-up-presenters";

const TOTP_STEP_SECONDS = 30;


function getRemainingTotpSeconds(): number {
  const epochSeconds = Math.floor(Date.now() / 1000);
  const remainder = epochSeconds % TOTP_STEP_SECONDS;
  return remainder === 0 ? TOTP_STEP_SECONDS : TOTP_STEP_SECONDS - remainder;
}

type StepUpRequest = {
  title: string;
  description: string;
  confirmLabel: string;
};

type UseAdminStepUpOptions = {
  enabled: boolean;
  issuer: string;
};

export function useAdminStepUp({ enabled, issuer }: Readonly<UseAdminStepUpOptions>) {
  const [request, setRequest] = useState<StepUpRequest | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expiredNotice, setExpiredNotice] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(getRemainingTotpSeconds());
  const [resolver, setResolver] = useState<{
    resolve: (value: string | undefined) => void;
    reject: (reason?: unknown) => void;
  } | null>(null);
  const previousRemainingRef = useRef(getRemainingTotpSeconds());

  useEffect(() => {
    if (!request) {
      return;
    }
    const initialRemaining = getRemainingTotpSeconds();
    previousRemainingRef.current = initialRemaining;
    setRemainingSeconds(initialRemaining);
    setExpiredNotice(false);

    const timer = globalThis.setInterval(() => {
      const nextRemaining = getRemainingTotpSeconds();
      if (nextRemaining > previousRemainingRef.current) {
        setExpiredNotice(true);
        setCode("");
        setError(null);
      }
      previousRemainingRef.current = nextRemaining;
      setRemainingSeconds(nextRemaining);
    }, 1000);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, [request]);

  function closeWithCancel() {
    resolver?.reject(new Error("已取消 Google Authenticator 验证"));
    setResolver(null);
    setRequest(null);
    setCode("");
    setError(null);
    setExpiredNotice(false);
  }

  function confirmCode() {
    const normalizedCode = code.trim();
    if (expiredNotice) {
      return;
    }
    if (remainingSeconds <= 5) {
      return;
    }
    if (normalizedCode.length !== 6 || !/^\d{6}$/.test(normalizedCode)) {
      setError("请输入 6 位数字验证码。");
      return;
    }
    resolver?.resolve(normalizedCode);
    setResolver(null);
    setRequest(null);
    setCode("");
    setError(null);
    setExpiredNotice(false);
  }

  function requestStepUpCode(nextRequest: StepUpRequest): Promise<string | undefined> {
    if (!enabled) {
      return Promise.resolve(undefined);
    }
    setRequest(nextRequest);
    setCode("");
    setError(null);
    setExpiredNotice(false);
    return new Promise<string | undefined>((resolve, reject) => {
      setResolver({ resolve, reject });
    });
  }

  const modal = (
    <AdminStepUpModal
      open={request !== null}
      title={request?.title ?? "二次验证"}
      description={request?.description ?? ""}
      confirmLabel={request?.confirmLabel ?? "确认"}
      issuer={issuer}
      code={code}
      error={error}
      expiredNotice={expiredNotice}
      remainingSeconds={remainingSeconds}
      confirmDisabled={shouldDisableStepUpConfirm({ remainingSeconds, code, expiredNotice })}
      onCodeChange={(value) => {
        setCode(value.replaceAll(/\D/g, "").slice(0, 6));
        if (error || expiredNotice) {
          setError(null);
          setExpiredNotice(false);
        }
      }}
      onCancel={closeWithCancel}
      onConfirm={confirmCode}
    />
  );

  return {
    requestStepUpCode,
    stepUpModal: modal,
  };
}