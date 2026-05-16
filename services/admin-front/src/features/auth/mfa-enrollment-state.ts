"use client";

import QRCode from "qrcode";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type MutableRefObject,
} from "react";

import {
  clearPendingMfaEnrollment,
  readPendingMfaEnrollment,
} from "@/lib/admin-mfa-enrollment";
import {
  beginAdminMfaEnrollment,
  isAdminApiError,
  verifyAdminMfaEnrollment,
  type MfaEnrollBeginResponse,
} from "@/services/admin-api";

type ReplaceRouter = {
  replace: (href: string) => void;
};

type EnrollmentRequestState = {
  token: string | null;
  promise: Promise<MfaEnrollBeginResponse> | null;
};

export type MfaEnrollmentState = {
  enrollment: ReturnType<typeof readPendingMfaEnrollment>;
  beginState: MfaEnrollBeginResponse | null;
  qrCodeDataUrl: string | null;
  otpCode: string;
  setOtpCode: (value: string) => void;
  requestError: string | null;
  qrError: string | null;
  isPending: boolean;
  msRemaining: number;
  copied: boolean;
  handleRestart: () => void;
  handleCopyManualKey: () => Promise<void>;
  handleVerify: () => Promise<void>;
};

export function formatCountdown(msRemaining: number): string {
  const seconds = Math.max(0, Math.floor(msRemaining / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function formatEnrollmentLoadError(error: unknown): string {
  if (isAdminApiError(error)) {
    return error.message;
  }
  if (error instanceof Error && error.message === "Failed to fetch") {
    return "无法连接管理后台认证服务，请确认 admin-front 已通过同源代理或正确的 API 地址访问 gateway-admin。";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "无法开始 Google Authenticator 绑定";
}

async function buildQrCodeDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl, {
    width: 280,
    margin: 2,
    color: {
      dark: "#0f172a",
      light: "#ffffff",
    },
  });
}

function resetEnrollmentRequestState(
  requestRef: MutableRefObject<EnrollmentRequestState>
): void {
  requestRef.current = {
    token: null,
    promise: null,
  };
}

function ensureEnrollmentRequest(
  enrollmentToken: string,
  requestRef: MutableRefObject<EnrollmentRequestState>
): Promise<MfaEnrollBeginResponse> {
  const current = requestRef.current;
  if (current.token === enrollmentToken && current.promise) {
    return current.promise;
  }
  const promise = beginAdminMfaEnrollment(enrollmentToken);
  requestRef.current = {
    token: enrollmentToken,
    promise,
  };
  return promise;
}

export function useMfaEnrollmentState(router: ReplaceRouter): MfaEnrollmentState {
  const [enrollment, setEnrollment] = useState(() =>
    readPendingMfaEnrollment()
  );
  const [beginState, setBeginState] = useState<MfaEnrollBeginResponse | null>(
    null
  );
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const requestRef = useRef<EnrollmentRequestState>({
    token: null,
    promise: null,
  });

  const expiresAt = useMemo(() => {
    if (!enrollment) {
      return 0;
    }
    return enrollment.createdAt + enrollment.expiresIn * 1000;
  }, [enrollment]);

  useEffect(() => {
    const enrollmentToken = enrollment?.enrollmentToken;
    if (!enrollmentToken) {
      resetEnrollmentRequestState(requestRef);
      router.replace("/login");
      return;
    }

    let active = true;
    setRequestError(null);
    setQrError(null);
    setQrCodeDataUrl(null);

    const loadEnrollment = async (): Promise<void> => {
      try {
        const result = await ensureEnrollmentRequest(enrollmentToken, requestRef);
        if (!active) {
          return;
        }
        setBeginState(result);
        try {
          const dataUrl = await buildQrCodeDataUrl(result.otpauthUrl);
          if (active) {
            setQrCodeDataUrl(dataUrl);
          }
        } catch (error) {
          if (active) {
            setQrError(
              error instanceof Error
                ? error.message
                : "二维码渲染失败，请改用手动密钥完成绑定"
            );
          }
        }
      } catch (error) {
        if (!active) {
          return;
        }
        requestRef.current.promise = null;
        setBeginState(null);
        setRequestError(formatEnrollmentLoadError(error));
      }
    };

    void loadEnrollment();
    return () => {
      active = false;
    };
  }, [enrollment, router]);

  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, []);

  const handleRestart = (): void => {
    clearPendingMfaEnrollment();
    resetEnrollmentRequestState(requestRef);
    router.replace("/login");
  };

  const handleCopyManualKey = async (): Promise<void> => {
    if (
      !beginState?.manualEntryKey ||
      typeof navigator === "undefined" ||
      !navigator.clipboard
    ) {
      return;
    }
    await navigator.clipboard.writeText(beginState.manualEntryKey);
    setCopied(true);
    globalThis.setTimeout(() => setCopied(false), 1600);
  };

  const handleVerify = async (): Promise<void> => {
    if (!enrollment || !beginState) {
      return;
    }

    setRequestError(null);
    return new Promise((resolve) => {
      startTransition(async () => {
        try {
          await verifyAdminMfaEnrollment({
            enrollmentToken: enrollment.enrollmentToken,
            factorId: beginState.factorId,
            otpCode,
          });
          clearPendingMfaEnrollment();
          router.replace("/dashboard");
        } catch (error) {
          if (isAdminApiError(error) && Date.now() >= expiresAt) {
            clearPendingMfaEnrollment();
            setEnrollment(null);
          }
          setRequestError(
            error instanceof Error ? error.message : "MFA 绑定失败"
          );
        } finally {
          resolve();
        }
      });
    });
  };

  return {
    enrollment,
    beginState,
    qrCodeDataUrl,
    otpCode,
    setOtpCode,
    requestError,
    qrError,
    isPending,
    msRemaining: Math.max(0, expiresAt - now),
    copied,
    handleRestart,
    handleCopyManualKey,
    handleVerify,
  };
}
