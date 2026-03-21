"use client";

import { Box, Button, Flex, Input, Stack, Text } from "@chakra-ui/react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, useTransition } from "react";

import { AuthProtocolShell } from "@/components/auth-protocol-shell";
import { clearPendingMfaEnrollment, savePendingMfaEnrollment } from "@/lib/admin-mfa-enrollment";
import {
  getAdminAuthPolicy,
  getCurrentAdmin,
  isAdminApiError,
  loginAdmin,
  type AdminAuthSecurityPolicy,
  type MfaEnrollmentRequiredData,
} from "@/services/admin-api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("super@synapse.network");
  const [otpCode, setOtpCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [security, setSecurity] = useState<AdminAuthSecurityPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
  }, [router]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await loginAdmin({
          email,
          password,
          otpCode: security?.loginTotpRequired ? otpCode : undefined,
        });
        router.push("/dashboard");
      } catch (submitError) {
        if (isAdminApiError(submitError) && submitError.code === "MFA_ENROLLMENT_REQUIRED") {
          const enrollment = submitError.data as MfaEnrollmentRequiredData | undefined;
          if (enrollment?.enrollmentToken) {
            savePendingMfaEnrollment(enrollment);
            router.push("/login/mfa-enroll");
            return;
          }
        }
        setError(submitError instanceof Error ? submitError.message : "登录失败");
      }
    });
  }

  return (
    <AuthProtocolShell
      eyebrow="System Authorization"
      title="System Authorization"
      versionLabel="Gateway Control Plane v4.0.8"
      statusLabel="NODE_ACTIVE :: ENCRYPTED_LINK"
      railTitle="进入控制台之前，先完成身份校验、会话绑定和 OTP 握手。"
      railDescription="登录入口遵循 `stitch/admin_login` 的安全门厅原型，用冷色 Sentinel 结构承载身份输入、OTP 握手和 MFA enrollment 分支。"
      railFacts={[
        { label: "Primary Session", value: "cookie-session" },
        { label: "Issuer", value: security?.totpIssuer ?? "handshake" },
        { label: "Login TOTP", value: security?.loginTotpRequired ? "required" : "optional" },
        { label: "High-risk Step-up", value: security?.highRiskTotpRequired ? "active" : "off" },
      ]}
      layout="centered"
      panelMaxW="460px"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="6">
          <Stack gap="1" position="relative">
            <Box position="absolute" left={{ base: "-4", md: "-10" }} top="0" w="1" h="12" bg="rgba(34, 211, 238, 0.5)" display={{ base: "none", md: "block" }} />
            <Text fontSize="11px" fontWeight="800" letterSpacing="0.22em" textTransform="uppercase" color="rgba(103, 232, 249, 0.72)">Operator Access</Text>
            <Text color="rgba(148, 163, 184, 0.92)">使用管理员身份登录控制台。若账户尚未绑定 Google Authenticator，将自动进入 enrollment 流程。</Text>
          </Stack>

          <Stack gap="2">
            <Text fontSize="10px" fontWeight="800" letterSpacing="0.2em" textTransform="uppercase" color="rgba(103, 232, 249, 0.68)">Operator Identification</Text>
            <Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="EMAIL_UID" fontFamily="mono" h="14" borderRadius="6px" bg="rgba(15,23,42,0.5)" borderColor="rgba(30,41,59,0.95)" color="#f8fafc" _placeholder={{ color: "rgba(100, 116, 139, 0.9)" }} _hover={{ borderColor: "rgba(34, 211, 238, 0.35)" }} _focusVisible={{ borderColor: "rgba(34, 211, 238, 0.55)", boxShadow: "0 0 0 1px rgba(34, 211, 238, 0.28)" }} />
          </Stack>

          <Stack gap="2">
            <Flex justify="space-between" align="center">
              <Text fontSize="10px" fontWeight="800" letterSpacing="0.2em" textTransform="uppercase" color="rgba(103, 232, 249, 0.68)">Access Cipher</Text>
              <Button variant="ghost" size="sm" color="rgba(148, 163, 184, 0.85)" _hover={{ color: "#67e8f9", bg: "transparent" }} onClick={() => setPassword("")}>Recover Key</Button>
            </Flex>
            <Flex gap="2">
              <Input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} placeholder="PASSWORD" fontFamily="mono" h="14" borderRadius="6px" bg="rgba(15,23,42,0.5)" borderColor="rgba(30,41,59,0.95)" color="#f8fafc" _placeholder={{ color: "rgba(100, 116, 139, 0.9)" }} _hover={{ borderColor: "rgba(34, 211, 238, 0.35)" }} _focusVisible={{ borderColor: "rgba(34, 211, 238, 0.55)", boxShadow: "0 0 0 1px rgba(34, 211, 238, 0.28)" }} />
              <Button variant="outline" minW="92px" h="14" borderRadius="6px" borderColor="rgba(30,41,59,0.95)" color="rgba(226, 232, 240, 0.92)" _hover={{ borderColor: "rgba(34, 211, 238, 0.35)", color: "#67e8f9", bg: "rgba(15,23,42,0.58)" }} onClick={() => setShowPassword((current) => !current)}>{showPassword ? "Hide" : "Reveal"}</Button>
            </Flex>
          </Stack>

          <Stack gap="2">
            <Text fontSize="10px" fontWeight="800" letterSpacing="0.2em" textTransform="uppercase" color="rgba(103, 232, 249, 0.68)">Google Authenticator Token</Text>
            <Flex gap="2">
              <Box flex="1" position="relative">
                <Box position="absolute" left="4" top="50%" transform="translateY(-50%)" pointerEvents="none">
                  <Text color="rgba(103, 232, 249, 0.52)" fontSize="lg" fontWeight="800">⌁</Text>
                </Box>
                <Input value={otpCode} onChange={(event) => setOtpCode(event.target.value.replaceAll(/\D/g, "").slice(0, 6))} inputMode="numeric" maxLength={6} placeholder="000000" fontFamily="mono" letterSpacing="0.5em" pl="11" h="14" borderRadius="6px" bg="rgba(15,23,42,0.5)" borderColor="rgba(30,41,59,0.95)" color="#f8fafc" _placeholder={{ color: "rgba(100, 116, 139, 0.9)" }} _hover={{ borderColor: "rgba(34, 211, 238, 0.35)" }} _focusVisible={{ borderColor: "rgba(34, 211, 238, 0.55)", boxShadow: "0 0 0 1px rgba(34, 211, 238, 0.28)" }} />
              </Box>
              <Box minW="12" h="14" display="grid" placeItems="center" borderRadius="6px" bg="rgba(15,23,42,0.3)" border="1px solid rgba(30,41,59,0.95)">
                <Text color="rgba(103, 232, 249, 0.7)" fontSize="xs" fontWeight="800">OTP</Text>
              </Box>
            </Flex>
          </Stack>

          <Button type="submit" h="16" borderRadius="6px" bg="#22d3ee" color="#082f49" fontWeight="900" fontFamily="mono" fontSize="sm" letterSpacing="0.2em" textTransform="uppercase" _hover={{ bg: "#f8fafc", boxShadow: "0 0 24px rgba(34, 211, 238, 0.34)" }} disabled={isPending}>
            {isPending ? "Executing..." : "Execute Initialization"}
          </Button>

          <Box borderRadius="6px" p="4" bg="rgba(15,23,42,0.45)" border="1px solid rgba(30,41,59,0.72)">
            <Flex justify="space-between" align="center" fontSize="9px" fontFamily="mono" textTransform="uppercase" letterSpacing="0.16em" color="rgba(100, 116, 139, 0.92)">
              <Text>Terminal_Status</Text>
              <Text color="#67e8f9">Encrypted_Link</Text>
            </Flex>
            <Box mt="3" h="1" bg="rgba(30, 41, 59, 0.95)" overflow="hidden">
              <Box h="full" w={security?.loginTotpRequired ? "72%" : "58%"} bg="rgba(34, 211, 238, 0.6)" />
            </Box>
          </Box>

          <Box borderRadius="6px" p="4" bg="rgba(15,23,42,0.3)" border="1px solid rgba(30,41,59,0.72)">
            {security ? (
              <Text color="rgba(148, 163, 184, 0.92)" fontSize="sm">Issuer: {security.totpIssuer} · 登录 TOTP {security.loginTotpRequired ? "required" : "optional"} · 高风险二次验证 {security.highRiskTotpRequired ? "active" : "off"}</Text>
            ) : (
              <Text color="rgba(148, 163, 184, 0.92)" fontSize="sm">Security policy handshake in progress...</Text>
            )}
          </Box>

          {error ? <Box borderRadius="14px" p="4" bg="rgba(127, 29, 29, 0.22)" border="1px solid rgba(248, 113, 113, 0.24)" color="#fecaca">{error}</Box> : null}
        </Stack>
      </form>
    </AuthProtocolShell>
  );
}
