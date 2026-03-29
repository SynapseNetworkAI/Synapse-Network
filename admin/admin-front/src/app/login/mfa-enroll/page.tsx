"use client";

import { Box, Button, Flex, Grid, Stack, Text } from "@chakra-ui/react";
import Image from "next/image";
import QRCode from "qrcode";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { AuthCodeSlots } from "@/components/auth-code-slots";
import { AuthProtocolShell } from "@/components/auth-protocol-shell";
import { clearPendingMfaEnrollment, readPendingMfaEnrollment } from "@/lib/admin-mfa-enrollment";
import {
  beginAdminMfaEnrollment,
  isAdminApiError,
  verifyAdminMfaEnrollment,
  type MfaEnrollBeginResponse,
} from "@/services/admin-api";

function formatCountdown(msRemaining: number): string {
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
  return "无法初始化 MFA 绑定";
}

export default function MfaEnrollPage() {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState(() => readPendingMfaEnrollment());
  const [beginState, setBeginState] = useState<MfaEnrollBeginResponse | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const enrollmentRequestTokenRef = useRef<string | null>(null);
  const enrollmentRequestPromiseRef = useRef<Promise<MfaEnrollBeginResponse> | null>(null);

  const expiresAt = useMemo(() => {
    if (!enrollment) {
      return 0;
    }
    return enrollment.createdAt + enrollment.expiresIn * 1000;
  }, [enrollment]);

  useEffect(() => {
    const enrollmentToken = enrollment?.enrollmentToken;
    if (!enrollmentToken) {
      enrollmentRequestTokenRef.current = null;
      enrollmentRequestPromiseRef.current = null;
      router.replace("/login");
      return;
    }
    const activeEnrollmentToken = enrollmentToken;

    let active = true;
    async function loadEnrollment(): Promise<void> {
      try {
        setQrCodeDataUrl(null);
        if (enrollmentRequestTokenRef.current !== activeEnrollmentToken || enrollmentRequestPromiseRef.current === null) {
          enrollmentRequestTokenRef.current = activeEnrollmentToken;
          enrollmentRequestPromiseRef.current = beginAdminMfaEnrollment(activeEnrollmentToken);
        }
        const result = await enrollmentRequestPromiseRef.current;
        if (!active) {
          return;
        }
        setBeginState(result);

        try {
          const dataUrl = await QRCode.toDataURL(result.otpauthUrl, {
            width: 280,
            margin: 2,
            color: {
              dark: "#0f172a",
              light: "#ffffff",
            },
          });
          if (active) {
            setQrCodeDataUrl(dataUrl);
          }
        } catch (qrCodeError) {
          if (active) {
            setQrError(qrCodeError instanceof Error ? qrCodeError.message : "二维码渲染失败，请改用手动密钥完成绑定");
          }
        }
      } catch (beginError) {
        if (!active) {
          return;
        }
        enrollmentRequestPromiseRef.current = null;
        setBeginState(null);
        setRequestError(formatEnrollmentLoadError(beginError));
      }
    }

    setRequestError(null);
    setQrError(null);
    loadEnrollment().catch(() => undefined);

    return () => {
      active = false;
    };
  }, [enrollment, router]);

  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, []);

  function handleRestart(): void {
    clearPendingMfaEnrollment();
    enrollmentRequestTokenRef.current = null;
    enrollmentRequestPromiseRef.current = null;
    router.replace("/login");
  }

  async function handleCopyManualKey(): Promise<void> {
    if (!beginState?.manualEntryKey || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(beginState.manualEntryKey);
    setCopied(true);
    globalThis.setTimeout(() => setCopied(false), 1600);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!enrollment || !beginState) {
      return;
    }

    setRequestError(null);
    startTransition(async () => {
      try {
        await verifyAdminMfaEnrollment({
          enrollmentToken: enrollment.enrollmentToken,
          factorId: beginState.factorId,
          otpCode,
        });
        clearPendingMfaEnrollment();
        router.replace("/dashboard");
      } catch (submitError) {
        if (isAdminApiError(submitError) && Date.now() >= expiresAt) {
          clearPendingMfaEnrollment();
          setEnrollment(null);
        }
        setRequestError(submitError instanceof Error ? submitError.message : "MFA 绑定失败");
      }
    });
  }

  if (!enrollment) {
    return null;
  }

  const msRemaining = Math.max(0, expiresAt - now);
  let qrCodePanel = (
    <Flex align="center" justify="center" w="160px" h="160px" bg="rgba(255,255,255,0.06)">
      <Text color="rgba(148, 163, 184, 0.92)" fontSize="sm">Generating secure payload...</Text>
    </Flex>
  );

  if (qrError) {
    qrCodePanel = (
      <Flex align="center" justify="center" w="160px" h="160px" bg="rgba(15,23,42,0.9)" border="1px solid rgba(30,41,59,0.95)">
        <Text color="#fecaca" fontSize="sm" textAlign="center">QR render unavailable. Use the manual key below.</Text>
      </Flex>
    );
  }

  if (qrCodeDataUrl) {
    qrCodePanel = <Image src={qrCodeDataUrl} alt="Google Authenticator enrollment QR code" width={160} height={160} unoptimized />;
  }

  return (
    <AuthProtocolShell
      eyebrow="MFA Initialization"
      title="Secure Sentinel Protocol"
      versionLabel={`Challenge TTL ${formatCountdown(msRemaining)}`}
      statusLabel="AUTH_STREAM :: SECURE_SOCKET_LAYER_V3"
      railTitle="本次登录不会直接签发 session，必须先完成首个 OTP 验证。"
      railDescription="MFA 绑定页参考 `stitch/mfa_setup_registration`，保持 QR、手动密钥、六位验证和安全初始化语气在同一条线上。"
      railFacts={[
        { label: "Pending Operator", value: enrollment.maskedEmail },
        { label: "Issuer", value: enrollment.totpIssuer },
        { label: "Status", value: msRemaining > 0 ? "Awaiting Verification" : "Challenge Expired" },
      ]}
      layout="centered"
      panelMaxW={{ base: "100%", xl: "960px" }}
      progressWidth={msRemaining > 0 ? "75%" : "22%"}
      headerVariant="accent-bar"
    >
      <Stack gap="8">
        <Grid templateColumns={{ base: "1fr", md: "220px 1fr" }} gap="8" alignItems="center">
          <Box bg="#ffffff" p="3" borderRadius="8px" boxShadow="0 0 30px rgba(76,214,251,0.2)" w="fit-content">
            {qrCodePanel}
          </Box>

          <Stack gap="4">
            <Text color="rgba(148, 163, 184, 0.92)" fontSize="sm" lineHeight="1.8">
              Scan this visual encryption key with your approved Authenticator application. The <Text as="span" color="#f8fafc" fontWeight="700">Sentinel Protocol</Text> requires a synchronized temporal token for workspace access.
            </Text>
            <Flex align="center" gap="2" color="rgba(34, 211, 238, 0.8)">
              <Box w="2" h="2" borderRadius="full" bg="#22d3ee" boxShadow="0 0 12px rgba(34, 211, 238, 0.5)" />
              <Text fontSize="10px" fontWeight="800" letterSpacing="0.22em" textTransform="uppercase">Encrypted Connection Established</Text>
            </Flex>
          </Stack>
        </Grid>

        <Stack gap="3">
          <Text fontSize="10px" fontWeight="800" letterSpacing="0.22em" textTransform="uppercase" color="rgba(148, 163, 184, 0.78)">Manual Setup Key</Text>
          <Flex align={{ base: "flex-start", md: "center" }} justify="space-between" gap="4" direction={{ base: "column", md: "row" }} bg="rgba(15,23,42,0.82)" border="1px solid rgba(30,41,59,0.95)" p="4" borderRadius="6px">
            <Text fontFamily="mono" fontSize={{ base: "md", md: "lg" }} color="#67e8f9" letterSpacing="0.18em">{beginState?.manualEntryKey ?? "Loading..."}</Text>
            <Button variant="ghost" h="10" minW="110px" borderRadius="6px" color={copied ? "#67e8f9" : "rgba(148, 163, 184, 0.92)"} border="1px solid rgba(30,41,59,0.95)" _hover={{ color: "#67e8f9", bg: "rgba(15,23,42,0.5)" }} onClick={() => void handleCopyManualKey()}>
              {copied ? "Copied" : "Copy Key"}
            </Button>
          </Flex>
        </Stack>

        <form onSubmit={handleSubmit}>
          <Stack gap="6">
            <Stack gap="2">
              <Text fontSize="10px" fontWeight="800" letterSpacing="0.22em" textTransform="uppercase" color="rgba(148, 163, 184, 0.78)">Initial Verification Code</Text>
              <Text color="rgba(148, 163, 184, 0.92)">Account: {beginState?.accountName ?? enrollment.maskedEmail}</Text>
            </Stack>

            <AuthCodeSlots value={otpCode} onChange={setOtpCode} isDisabled={isPending || msRemaining <= 0} />

            <Box borderRadius="6px" p="4" bg="rgba(15,23,42,0.45)" border="1px solid rgba(30,41,59,0.95)">
              <Text color="rgba(148, 163, 184, 0.92)">No admin session is issued until this code is verified successfully. Current TTL: {formatCountdown(msRemaining)}</Text>
            </Box>

            {requestError ? <Box borderRadius="14px" p="4" bg="rgba(127, 29, 29, 0.22)" border="1px solid rgba(248, 113, 113, 0.24)" color="#fecaca">{requestError}</Box> : null}
            {qrError ? <Box borderRadius="14px" p="4" bg="rgba(120, 53, 15, 0.2)" border="1px solid rgba(251, 191, 36, 0.24)" color="#fde68a">{qrError}</Box> : null}

            <Button type="submit" h="16" w="full" borderRadius="6px" bg="linear-gradient(90deg, #0891b2 0%, #22d3ee 100%)" color="#082f49" fontWeight="900" fontFamily="heading" textTransform="uppercase" letterSpacing="0.16em" _hover={{ filter: "brightness(1.06)", boxShadow: "0 0 24px rgba(34, 211, 238, 0.34)" }} disabled={isPending || !beginState || msRemaining <= 0}>
                {isPending ? "Verifying..." : "Execute Initialization"}
              </Button>

            <Box pt="1" textAlign="center">
              <Button variant="ghost" h="12" borderRadius="6px" color="rgba(148, 163, 184, 0.92)" _hover={{ color: "#f8fafc", bg: "rgba(15,23,42,0.5)" }} onClick={handleRestart}>Abandon Protocol</Button>
            </Box>
          </Stack>
        </form>
      </Stack>
    </AuthProtocolShell>
  );
}