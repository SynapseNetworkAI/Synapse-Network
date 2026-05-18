"use client";

import { Box, Button, Flex, Grid, Stack, Text } from "@chakra-ui/react";
import Image from "next/image";
import { FormEvent } from "react";

import { AuthCodeSlots } from "@/components/auth-code-slots";
import { formatCountdown } from "@/features/auth/mfa-enrollment-state";
import type { MfaEnrollBeginResponse } from "@/services/admin-api";

function QrCodePanel({
  qrCodeDataUrl,
  qrError,
}: {
  qrCodeDataUrl: string | null;
  qrError: string | null;
}) {
  if (qrCodeDataUrl) {
    return (
      <Image
        src={qrCodeDataUrl}
        alt="Google Authenticator enrollment QR code"
        width={160}
        height={160}
        unoptimized
      />
    );
  }

  if (qrError) {
    return (
      <Flex
        align="center"
        justify="center"
        w="160px"
        h="160px"
        bg="rgba(15,23,42,0.9)"
        border="1px solid rgba(30,41,59,0.95)"
      >
        <Text color="#fecaca" fontSize="sm" textAlign="center">
          QR render unavailable. Use the manual key below.
        </Text>
      </Flex>
    );
  }

  return (
    <Flex
      align="center"
      justify="center"
      w="160px"
      h="160px"
      bg="rgba(255,255,255,0.06)"
    >
      <Text color="rgba(148, 163, 184, 0.92)" fontSize="sm">
        Generating Google Authenticator QR...
      </Text>
    </Flex>
  );
}

export function EnrollmentHero({
  qrCodeDataUrl,
  qrError,
}: {
  qrCodeDataUrl: string | null;
  qrError: string | null;
}) {
  return (
    <Grid
      templateColumns={{ base: "1fr", md: "220px 1fr" }}
      gap="8"
      alignItems="center"
    >
      <Box
        bg="#ffffff"
        p="3"
        borderRadius="8px"
        boxShadow="0 0 30px rgba(76,214,251,0.2)"
        w="fit-content"
      >
        <QrCodePanel qrCodeDataUrl={qrCodeDataUrl} qrError={qrError} />
      </Box>

      <Stack gap="4">
        <Text color="rgba(148, 163, 184, 0.92)" fontSize="sm" lineHeight="1.8">
          Scan this Google Authenticator enrollment key after password
          verification. The{" "}
          <Text as="span" color="#f8fafc" fontWeight="700">
            Sentinel Protocol
          </Text>{" "}
          only activates the admin session after this first 6-digit code is
          verified successfully.
        </Text>
        <Flex align="center" gap="2" color="rgba(34, 211, 238, 0.8)">
          <Box
            w="2"
            h="2"
            borderRadius="full"
            bg="#22d3ee"
            boxShadow="0 0 12px rgba(34, 211, 238, 0.5)"
          />
          <Text
            fontSize="10px"
            fontWeight="800"
            letterSpacing="0.22em"
            textTransform="uppercase"
          >
            Password Gate Passed
          </Text>
        </Flex>
      </Stack>
    </Grid>
  );
}

export function ManualEntryKeyCard({
  beginState,
  copied,
  onCopy,
}: {
  beginState: MfaEnrollBeginResponse | null;
  copied: boolean;
  onCopy: () => Promise<void>;
}) {
  return (
    <Stack gap="3">
      <Text
        fontSize="10px"
        fontWeight="800"
        letterSpacing="0.22em"
        textTransform="uppercase"
        color="rgba(148, 163, 184, 0.78)"
      >
        Manual Entry Key
      </Text>
      <Flex
        align={{ base: "flex-start", md: "center" }}
        justify="space-between"
        gap="4"
        direction={{ base: "column", md: "row" }}
        bg="rgba(15,23,42,0.82)"
        border="1px solid rgba(30,41,59,0.95)"
        p="4"
        borderRadius="6px"
      >
        <Text
          fontFamily="mono"
          fontSize={{ base: "md", md: "lg" }}
          color="#67e8f9"
          letterSpacing="0.18em"
        >
          {beginState?.manualEntryKey ?? "Loading..."}
        </Text>
        <Button
          variant="ghost"
          h="10"
          minW="110px"
          borderRadius="6px"
          color={copied ? "#67e8f9" : "rgba(148, 163, 184, 0.92)"}
          border="1px solid rgba(30,41,59,0.95)"
          _hover={{ color: "#67e8f9", bg: "rgba(15,23,42,0.5)" }}
          onClick={() => void onCopy()}
        >
          {copied ? "Copied" : "Copy Key"}
        </Button>
      </Flex>
    </Stack>
  );
}

function EnrollmentAlert({
  message,
  tone,
}: {
  message: string;
  tone: "error" | "warning";
}) {
  const palette =
    tone === "error"
      ? {
          bg: "rgba(127, 29, 29, 0.22)",
          border: "1px solid rgba(248, 113, 113, 0.24)",
          color: "#fecaca",
        }
      : {
          bg: "rgba(120, 53, 15, 0.2)",
          border: "1px solid rgba(251, 191, 36, 0.24)",
          color: "#fde68a",
        };

  return (
    <Box
      borderRadius="14px"
      p="4"
      bg={palette.bg}
      border={palette.border}
      color={palette.color}
    >
      {message}
    </Box>
  );
}

export function EnrollmentVerificationForm({
  enrollmentEmail,
  beginState,
  otpCode,
  setOtpCode,
  isPending,
  msRemaining,
  requestError,
  qrError,
  onSubmit,
  onRestart,
}: {
  enrollmentEmail: string;
  beginState: MfaEnrollBeginResponse | null;
  otpCode: string;
  setOtpCode: (value: string) => void;
  isPending: boolean;
  msRemaining: number;
  requestError: string | null;
  qrError: string | null;
  onSubmit: () => Promise<void>;
  onRestart: () => void;
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void onSubmit();
  };

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="6">
        <Stack gap="2">
          <Text
            fontSize="10px"
            fontWeight="800"
            letterSpacing="0.22em"
            textTransform="uppercase"
            color="rgba(148, 163, 184, 0.78)"
          >
            Google Authenticator Code
          </Text>
          <Text color="rgba(148, 163, 184, 0.92)">
            Account: {beginState?.accountName ?? enrollmentEmail}
          </Text>
        </Stack>

        <AuthCodeSlots
          value={otpCode}
          onChange={setOtpCode}
          isDisabled={isPending || msRemaining <= 0}
        />

        <Box
          borderRadius="6px"
          p="4"
          bg="rgba(15,23,42,0.45)"
          border="1px solid rgba(30,41,59,0.95)"
        >
          <Text color="rgba(148, 163, 184, 0.92)">
            Password verification is complete. No admin session is issued until
            this Google Authenticator code is verified successfully. Current
            TTL: {formatCountdown(msRemaining)}
          </Text>
        </Box>

        {requestError ? (
          <EnrollmentAlert message={requestError} tone="error" />
        ) : null}
        {qrError ? <EnrollmentAlert message={qrError} tone="warning" /> : null}

        <Button
          type="submit"
          h="16"
          w="full"
          borderRadius="6px"
          bg="linear-gradient(90deg, #0891b2 0%, #22d3ee 100%)"
          color="#082f49"
          fontWeight="900"
          fontFamily="heading"
          textTransform="uppercase"
          letterSpacing="0.16em"
          _hover={{
            filter: "brightness(1.06)",
            boxShadow: "0 0 24px rgba(34, 211, 238, 0.34)",
          }}
          disabled={isPending || !beginState || msRemaining <= 0}
        >
          {isPending ? "Verifying..." : "Verify and Activate"}
        </Button>

        <Box pt="1" textAlign="center">
          <Button
            variant="ghost"
            h="12"
            borderRadius="6px"
            color="rgba(148, 163, 184, 0.92)"
            _hover={{ color: "#f8fafc", bg: "rgba(15,23,42,0.5)" }}
            onClick={onRestart}
          >
            Back to Login
          </Button>
        </Box>
      </Stack>
    </form>
  );
}
