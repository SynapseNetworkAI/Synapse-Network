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

type PendingEnrollment = ReturnType<typeof readPendingMfaEnrollment>;

type EnrollmentBootstrapState = {
  enrollment: PendingEnrollment;
  setEnrollment: (value: PendingEnrollment) => void;
  beginState: MfaEnrollBeginResponse | null;
  qrCodeDataUrl: string | null;
  requestError: string | null;
  setRequestError: (value: string | null) => void;
  qrError: string | null;
  expiresAt: number;
  requestRef: MutableRefObject<EnrollmentRequestState>;
};

type QrCodePayload = {
  dataUrl: string | null;
  error: string | null;
};

type VerifyEnrollmentOptions = {
  enrollment: NonNullable<PendingEnrollment>;
  beginState: MfaEnrollBeginResponse;
  otpCode: string;
  expiresAt: number;
  onExpired: () => void;
  onSuccess: () => void;
  onError: (message: string) => void;
};

export type MfaEnrollmentState = {
  enrollment: PendingEnrollment;
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

function formatQrCodeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "二维码渲染失败，请改用手动密钥完成绑定";
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

async function buildQrCodePayload(otpauthUrl: string): Promise<QrCodePayload> {
  try {
    return {
      dataUrl: await buildQrCodeDataUrl(otpauthUrl),
      error: null,
    };
  } catch (error) {
    return {
      dataUrl: null,
      error: formatQrCodeError(error),
    };
  }
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

async function hydrateEnrollmentState(options: {
  enrollmentToken: string;
  requestRef: MutableRefObject<EnrollmentRequestState>;
  isActive: () => boolean;
  setBeginState: (value: MfaEnrollBeginResponse | null) => void;
  setQrCodeDataUrl: (value: string | null) => void;
  setQrError: (value: string | null) => void;
  setRequestError: (value: string | null) => void;
}): Promise<void> {
  try {
    const result = await ensureEnrollmentRequest(
      options.enrollmentToken,
      options.requestRef
    );
    if (!options.isActive()) {
      return;
    }
    options.setBeginState(result);

    const qrCodePayload = await buildQrCodePayload(result.otpauthUrl);
    if (!options.isActive()) {
      return;
    }
    options.setQrCodeDataUrl(qrCodePayload.dataUrl);
    options.setQrError(qrCodePayload.error);
  } catch (error) {
    if (!options.isActive()) {
      return;
    }
    options.requestRef.current.promise = null;
    options.setBeginState(null);
    options.setRequestError(formatEnrollmentLoadError(error));
  }
}

async function copyToClipboard(value: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }
  await navigator.clipboard.writeText(value);
  return true;
}

async function verifyEnrollmentAndRoute(
  options: VerifyEnrollmentOptions
): Promise<void> {
  try {
    await verifyAdminMfaEnrollment({
      enrollmentToken: options.enrollment.enrollmentToken,
      factorId: options.beginState.factorId,
      otpCode: options.otpCode,
    });
    options.onSuccess();
  } catch (error) {
    if (isAdminApiError(error) && Date.now() >= options.expiresAt) {
      options.onExpired();
    }
    options.onError(error instanceof Error ? error.message : "MFA 绑定失败");
  }
}

function useEnrollmentBootstrap(
  router: ReplaceRouter
): EnrollmentBootstrapState {
  const [enrollment, setEnrollment] = useState<PendingEnrollment>(() =>
    readPendingMfaEnrollment()
  );
  const [beginState, setBeginState] = useState<MfaEnrollBeginResponse | null>(
    null
  );
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
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

    void hydrateEnrollmentState({
      enrollmentToken,
      requestRef,
      isActive: () => active,
      setBeginState,
      setQrCodeDataUrl,
      setQrError,
      setRequestError,
    });

    return () => {
      active = false;
    };
  }, [enrollment, router]);

  return {
    enrollment,
    setEnrollment,
    beginState,
    qrCodeDataUrl,
    requestError,
    setRequestError,
    qrError,
    expiresAt,
    requestRef,
  };
}

export function useMfaEnrollmentState(
  router: ReplaceRouter
): MfaEnrollmentState {
  const {
    enrollment,
    setEnrollment,
    beginState,
    qrCodeDataUrl,
    requestError,
    setRequestError,
    qrError,
    expiresAt,
    requestRef,
  } = useEnrollmentBootstrap(router);
  const [otpCode, setOtpCode] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

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
    if (!beginState?.manualEntryKey) {
      return;
    }
    const copiedToClipboard = await copyToClipboard(beginState.manualEntryKey);
    if (!copiedToClipboard) {
      return;
    }
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
        await verifyEnrollmentAndRoute({
          enrollment,
          beginState,
          otpCode,
          expiresAt,
          onExpired: () => {
            clearPendingMfaEnrollment();
            setEnrollment(null);
          },
          onSuccess: () => {
            clearPendingMfaEnrollment();
            router.replace("/dashboard");
          },
          onError: setRequestError,
        });
        resolve();
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
