"use client";

import { Stack } from "@chakra-ui/react";
import { useRouter } from "next/navigation";

import { AuthProtocolShell } from "@/components/auth-protocol-shell";
import {
  EnrollmentHero,
  EnrollmentVerificationForm,
  ManualEntryKeyCard,
} from "@/features/auth/mfa-enrollment-view";
import {
  formatCountdown,
  useMfaEnrollmentState,
} from "@/features/auth/mfa-enrollment-state";

export default function MfaEnrollPage() {
  const router = useRouter();
  const {
    enrollment,
    beginState,
    qrCodeDataUrl,
    otpCode,
    setOtpCode,
    requestError,
    qrError,
    isPending,
    msRemaining,
    copied,
    handleRestart,
    handleCopyManualKey,
    handleVerify,
  } = useMfaEnrollmentState(router);

  if (!enrollment) {
    return null;
  }

  return (
    <AuthProtocolShell
      eyebrow="MFA Enrollment"
      title="Bind Google Authenticator"
      versionLabel={`Challenge TTL ${formatCountdown(msRemaining)}`}
      statusLabel="AUTH_STREAM :: SECURE_SOCKET_LAYER_V3"
      railTitle="密码已验证成功，完成 Google Authenticator 首绑后才会签发管理员会话。"
      railDescription="该页面只用于密码验证通过后的 Google Authenticator 首绑；未完成首绑前，系统不会签发 admin session。"
      railFacts={[
        { label: "Pending Operator", value: enrollment.maskedEmail },
        { label: "Issuer", value: enrollment.totpIssuer },
        {
          label: "Status",
          value:
            msRemaining > 0 ? "Awaiting Verification" : "Challenge Expired",
        },
      ]}
      layout="centered"
      panelMaxW={{ base: "100%", xl: "960px" }}
      progressWidth={msRemaining > 0 ? "75%" : "22%"}
      headerVariant="accent-bar"
    >
      <Stack gap="8">
        <EnrollmentHero qrCodeDataUrl={qrCodeDataUrl} qrError={qrError} />
        <ManualEntryKeyCard
          beginState={beginState}
          copied={copied}
          onCopy={handleCopyManualKey}
        />
        <EnrollmentVerificationForm
          enrollmentEmail={enrollment.maskedEmail}
          beginState={beginState}
          otpCode={otpCode}
          setOtpCode={setOtpCode}
          isPending={isPending}
          msRemaining={msRemaining}
          requestError={requestError}
          qrError={qrError}
          onSubmit={handleVerify}
          onRestart={handleRestart}
        />
      </Stack>
    </AuthProtocolShell>
  );
}
