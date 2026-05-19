"use client";

import { Box, Button, Flex, Input, Stack, Text } from "@chakra-ui/react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, useTransition } from "react";

import { AuthProtocolShell } from "@/components/auth-protocol-shell";
import {
  buildLoginErrorMessage,
  buildLoginFeedback,
  buildLoginRailDescription,
  buildLoginRailFacts,
  isLoginTotpEnabled,
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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("cliff@synapse-network.ai");
  const [otpCode, setOtpCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [security, setSecurity] = useState<AdminAuthSecurityPolicy | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const showLoginTotp = isLoginTotpEnabled(security);
  const feedback = buildLoginFeedback(error, security);
  const feedbackStyles =
    feedback.tone === "error"
      ? {
          bg: "rgba(127, 29, 29, 0.22)",
          border: "1px solid rgba(248, 113, 113, 0.24)",
          color: "#fecaca",
        }
      : {
          bg: "rgba(15, 23, 42, 0.42)",
          border: "1px solid rgba(34, 211, 238, 0.18)",
          color: "rgba(226, 232, 240, 0.86)",
        };

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
        if (
          isAdminApiError(submitError) &&
          submitError.code === "MFA_ENROLLMENT_REQUIRED"
        ) {
          const enrollment = submitError.data as
            | MfaEnrollmentRequiredData
            | undefined;
          if (enrollment?.enrollmentToken) {
            savePendingMfaEnrollment(enrollment);
            router.push("/login/mfa-enroll");
            return;
          }
        }
        if (isAdminApiError(submitError)) {
          setError(
            buildLoginErrorMessage(submitError.code, submitError.message)
          );
          return;
        }
        setError(
          buildLoginErrorMessage(
            null,
            submitError instanceof Error ? submitError.message : null
          )
        );
      }
    });
  }

  return (
    <AuthProtocolShell
      eyebrow="Admin Console Login"
      title="Admin Console Login"
      versionLabel="Gateway Control Plane v4.0.8"
      statusLabel="NODE_ACTIVE :: ENCRYPTED_LINK"
      railTitle="管理员密码验证入口。"
      railDescription={buildLoginRailDescription(security)}
      railFacts={buildLoginRailFacts(security)}
      layout="centered"
      panelMaxW="460px"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="6">
          <Stack gap="2">
            <Text
              fontSize="10px"
              fontWeight="800"
              letterSpacing="0.2em"
              textTransform="uppercase"
              color="rgba(103, 232, 249, 0.68)"
            >
              Operator Identification
            </Text>
            <Input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              placeholder="EMAIL_UID"
              fontFamily="mono"
              h="14"
              borderRadius="6px"
              bg="rgba(15,23,42,0.5)"
              borderColor="rgba(30,41,59,0.95)"
              color="#f8fafc"
              _placeholder={{ color: "rgba(100, 116, 139, 0.9)" }}
              _hover={{ borderColor: "rgba(34, 211, 238, 0.35)" }}
              _focusVisible={{
                borderColor: "rgba(34, 211, 238, 0.55)",
                boxShadow: "0 0 0 1px rgba(34, 211, 238, 0.28)",
              }}
            />
          </Stack>

          <Stack gap="2">
            <Flex justify="space-between" align="center">
              <Text
                fontSize="10px"
                fontWeight="800"
                letterSpacing="0.2em"
                textTransform="uppercase"
                color="rgba(103, 232, 249, 0.68)"
              >
                Access Cipher
              </Text>
              <Button
                variant="ghost"
                size="sm"
                color="rgba(148, 163, 184, 0.85)"
                _hover={{ color: "#67e8f9", bg: "transparent" }}
                onClick={() => setPassword("")}
              >
                Recover Key
              </Button>
            </Flex>
            <Flex gap="2">
              <Input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                placeholder="PASSWORD"
                fontFamily="mono"
                h="14"
                borderRadius="6px"
                bg="rgba(15,23,42,0.5)"
                borderColor="rgba(30,41,59,0.95)"
                color="#f8fafc"
                _placeholder={{ color: "rgba(100, 116, 139, 0.9)" }}
                _hover={{ borderColor: "rgba(34, 211, 238, 0.35)" }}
                _focusVisible={{
                  borderColor: "rgba(34, 211, 238, 0.55)",
                  boxShadow: "0 0 0 1px rgba(34, 211, 238, 0.28)",
                }}
              />
              <Button
                variant="outline"
                minW="92px"
                h="14"
                borderRadius="6px"
                borderColor="rgba(30,41,59,0.95)"
                color="rgba(226, 232, 240, 0.92)"
                _hover={{
                  borderColor: "rgba(34, 211, 238, 0.35)",
                  color: "#67e8f9",
                  bg: "rgba(15,23,42,0.58)",
                }}
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? "Hide" : "Reveal"}
              </Button>
            </Flex>
          </Stack>

          {showLoginTotp ? (
            <Stack gap="2">
              <Text
                fontSize="10px"
                fontWeight="800"
                letterSpacing="0.2em"
                textTransform="uppercase"
                color="rgba(103, 232, 249, 0.68)"
              >
                Google Authenticator Token
              </Text>
              <Flex gap="2">
                <Box flex="1" position="relative">
                  <Box
                    position="absolute"
                    left="4"
                    top="50%"
                    transform="translateY(-50%)"
                    pointerEvents="none"
                  >
                    <Text
                      color="rgba(103, 232, 249, 0.52)"
                      fontSize="lg"
                      fontWeight="800"
                    >
                      ⌁
                    </Text>
                  </Box>
                  <Input
                    value={otpCode}
                    onChange={(event) =>
                      setOtpCode(
                        event.target.value.replaceAll(/\D/g, "").slice(0, 6)
                      )
                    }
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    fontFamily="mono"
                    letterSpacing="0.5em"
                    pl="11"
                    h="14"
                    borderRadius="6px"
                    bg="rgba(15,23,42,0.5)"
                    borderColor="rgba(30,41,59,0.95)"
                    color="#f8fafc"
                    _placeholder={{ color: "rgba(100, 116, 139, 0.9)" }}
                    _hover={{ borderColor: "rgba(34, 211, 238, 0.35)" }}
                    _focusVisible={{
                      borderColor: "rgba(34, 211, 238, 0.55)",
                      boxShadow: "0 0 0 1px rgba(34, 211, 238, 0.28)",
                    }}
                  />
                </Box>
                <Box
                  minW="12"
                  h="14"
                  display="grid"
                  placeItems="center"
                  borderRadius="6px"
                  bg="rgba(15,23,42,0.3)"
                  border="1px solid rgba(30,41,59,0.95)"
                >
                  <Text
                    color="rgba(103, 232, 249, 0.7)"
                    fontSize="xs"
                    fontWeight="800"
                  >
                    OTP
                  </Text>
                </Box>
              </Flex>
            </Stack>
          ) : null}

          <Button
            type="submit"
            mt={showLoginTotp ? "0" : "3"}
            h="16"
            borderRadius="6px"
            bg="#22d3ee"
            color="#082f49"
            fontWeight="900"
            fontFamily="mono"
            fontSize="sm"
            letterSpacing="0.2em"
            textTransform="uppercase"
            _hover={{
              bg: "#f8fafc",
              boxShadow: "0 0 24px rgba(34, 211, 238, 0.34)",
            }}
            disabled={isPending}
          >
            {isPending ? "Authenticating..." : "Continue Secure Sign-In"}
          </Button>

          <Box
            borderRadius="6px"
            p="4"
            bg={feedbackStyles.bg}
            border={feedbackStyles.border}
            color={feedbackStyles.color}
          >
            <Text fontSize="sm">{feedback.message}</Text>
          </Box>
        </Stack>
      </form>
    </AuthProtocolShell>
  );
}
