"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, useTransition } from "react";

import {
  buildLoginErrorMessage,
  buildLoginFeedback,
  buildLoginFeedbackStyles,
  isLoginTotpEnabled,
  sanitizeLoginOtpCode,
  type LoginFeedback,
  type LoginFeedbackStyles,
} from "@/features/auth/login-presenters";
import {
  clearPendingMfaEnrollment,
  savePendingMfaEnrollment,
} from "@/lib/admin-mfa-enrollment";
import {
  getAdminAuthPolicy,
  getCurrentAdmin,
  isAdminApiError,
  loginAdmin,
  type AdminAuthSecurityPolicy,
  type MfaEnrollmentRequiredData,
} from "@/services/admin-api";

type LoginRouter = ReturnType<typeof useRouter>;

type LoginSubmitOptions = {
  email: string;
  password: string;
  otpCode: string;
  showLoginTotp: boolean;
  router: LoginRouter;
  setError: (value: string) => void;
};

export type LoginControllerState = {
  email: string;
  password: string;
  otpCode: string;
  showPassword: boolean;
  security: AdminAuthSecurityPolicy | null;
  error: string | null;
  isPending: boolean;
  showLoginTotp: boolean;
  feedback: LoginFeedback;
  feedbackStyles: LoginFeedbackStyles;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setOtpCode: (value: string) => void;
  setShowPassword: (value: boolean | ((current: boolean) => boolean)) => void;
  clearPassword: () => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function useLoginBootstrap(
  router: LoginRouter,
  setSecurity: (policy: AdminAuthSecurityPolicy) => void
): void {
  useEffect(() => {
    let cancelled = false;

    clearPendingMfaEnrollment();

    void getAdminAuthPolicy()
      .then((policy) => {
        if (!cancelled) {
          setSecurity(policy);
        }
      })
      .catch(() => undefined);

    void getCurrentAdmin("cookie-session")
      .then(() => {
        if (!cancelled) {
          router.replace("/dashboard");
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [router, setSecurity]);
}

function routeMfaEnrollmentIfRequired(
  submitError: unknown,
  router: LoginRouter
): boolean {
  if (
    !isAdminApiError(submitError) ||
    submitError.code !== "MFA_ENROLLMENT_REQUIRED"
  ) {
    return false;
  }

  const enrollment = submitError.data as MfaEnrollmentRequiredData | undefined;
  if (!enrollment?.enrollmentToken) {
    return false;
  }

  savePendingMfaEnrollment(enrollment);
  router.push("/login/mfa-enroll");
  return true;
}

function formatSubmitError(submitError: unknown): string {
  if (isAdminApiError(submitError)) {
    return buildLoginErrorMessage(submitError.code, submitError.message);
  }

  return buildLoginErrorMessage(
    null,
    submitError instanceof Error ? submitError.message : null
  );
}

async function submitLoginAndRoute(options: LoginSubmitOptions): Promise<void> {
  try {
    await loginAdmin({
      email: options.email,
      password: options.password,
      otpCode: options.showLoginTotp ? options.otpCode : undefined,
    });
    options.router.push("/dashboard");
  } catch (submitError) {
    if (routeMfaEnrollmentIfRequired(submitError, options.router)) {
      return;
    }
    options.setError(formatSubmitError(submitError));
  }
}

export function useLoginController(): LoginControllerState {
  const router = useRouter();
  const [email, setEmail] = useState("cliff@synapse-network.ai");
  const [password, setPassword] = useState("");
  const [otpCode, setRawOtpCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [security, setSecurity] = useState<AdminAuthSecurityPolicy | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const showLoginTotp = isLoginTotpEnabled(security);
  const feedback = buildLoginFeedback(error, security);

  useLoginBootstrap(router, setSecurity);

  const setOtpCode = (value: string): void => {
    setRawOtpCode(sanitizeLoginOtpCode(value));
  };

  const clearPassword = (): void => {
    setPassword("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError(null);

    startTransition(() => {
      void submitLoginAndRoute({
        email,
        password,
        otpCode,
        showLoginTotp,
        router,
        setError,
      });
    });
  };

  return {
    email,
    password,
    otpCode,
    showPassword,
    security,
    error,
    isPending,
    showLoginTotp,
    feedback,
    feedbackStyles: buildLoginFeedbackStyles(feedback),
    setEmail,
    setPassword,
    setOtpCode,
    setShowPassword,
    clearPassword,
    handleSubmit,
  };
}
