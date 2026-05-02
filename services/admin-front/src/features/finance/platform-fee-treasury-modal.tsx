"use client";

import {
  Badge,
  Box,
  Button,
  Grid,
  Heading,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useMemo, useState } from "react";

import {
  FieldBlock,
  MessageBanner,
  nativeTextAreaStyle,
} from "@/components/console-ui";
import { useAdminStepUp } from "@/lib/use-admin-step-up";
import {
  AdminApiError,
  type AdminAuthSecurityPolicy,
} from "@/services/admin-api";
import {
  createPlatformFeeSafeDraft,
  type PlatformFeeSafeDraft,
} from "@/services/platform-fee-treasury-api";

export function canUsePlatformFeeTreasury(
  role: string | null | undefined
): boolean {
  return role === "super_admin";
}

export function buildPlatformFeeSafeDraftRequestId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `platform-fee-${globalThis.crypto.randomUUID()}`;
  }
  return `platform-fee-${Date.now().toString(36)}`;
}

export function platformFeeDraftErrorMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.status === 401) {
      return "Admin session or Google Authenticator verification failed. Sign in again or enter the latest 6-digit code.";
    }
    if (error.status === 403) {
      return "Only super admins can create platform fee Safe drafts.";
    }
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : "Failed to create platform fee Safe draft.";
}

function SafeFact({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <Box
      borderRadius="16px"
      bg="rgba(255,255,255,0.76)"
      border="1px solid rgba(99,92,82,0.12)"
      p="12px"
    >
      <Text
        fontSize="10px"
        letterSpacing="0.16em"
        textTransform="uppercase"
        color="ink.500"
      >
        {label}
      </Text>
      <Text
        mt="6px"
        fontFamily="monospace"
        fontSize="12px"
        color="ink.800"
        wordBreak="break-all"
      >
        {value}
      </Text>
    </Box>
  );
}

export function PlatformFeeTreasuryModal({
  open,
  security,
  onClose,
}: Readonly<{
  open: boolean;
  security: AdminAuthSecurityPolicy | null;
  onClose: () => void;
}>) {
  const [amountUsdc, setAmountUsdc] = useState("");
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState<PlatformFeeSafeDraft | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { requestStepUpCode, stepUpModal } = useAdminStepUp({
    enabled: security?.highRiskTotpRequired ?? true,
    issuer: security?.totpIssuer ?? "SynapseNetwork Admin",
  });

  const safeTxJson = useMemo(
    () => (draft ? JSON.stringify(draft.safeTx, null, 2) : ""),
    [draft]
  );
  const amountReady =
    /^\d+(\.\d{1,6})?$/.test(amountUsdc.trim()) &&
    Number(amountUsdc.trim()) > 0;
  const reasonReady = reason.trim().length >= 8;
  const canSubmit = amountReady && reasonReady && !submitting;

  async function handleSubmit() {
    if (!canSubmit) {
      setError(
        "Enter a positive USDC amount and a reason with at least 8 characters."
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    setDraft(null);
    try {
      const otpCode = await requestStepUpCode({
        title: "Confirm platform fee Safe draft",
        description:
          "This creates a hardware-wallet treasury draft. It does not broadcast an on-chain transaction.",
        confirmLabel: "Create Safe draft",
      });
      const result = await createPlatformFeeSafeDraft({
        amountUsdc: amountUsdc.trim(),
        reason: reason.trim(),
        requestId: buildPlatformFeeSafeDraftRequestId(),
        otpCode,
      });
      setDraft(result);
    } catch (nextError) {
      setError(platformFeeDraftErrorMessage(nextError));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyValue(label: string, value: string) {
    await globalThis.navigator?.clipboard?.writeText(value);
    setCopied(label);
  }

  if (!open) {
    return null;
  }

  return (
    <Box position="fixed" inset="0" zIndex={44}>
      <Box
        position="absolute"
        inset="0"
        bg="rgba(10,10,9,0.58)"
        backdropFilter="blur(10px)"
        onClick={onClose}
      />
      <Box
        position="relative"
        maxW="980px"
        mx="auto"
        mt={{ base: "4vh", lg: "7vh" }}
        px={{ base: "14px", md: "20px" }}
      >
        <Box
          borderRadius="34px"
          overflow="hidden"
          bg="linear-gradient(140deg, rgba(255,255,255,0.98), rgba(247,242,234,0.96))"
          border="1px solid rgba(99,92,82,0.16)"
          boxShadow="0 40px 110px rgba(20,19,17,0.28)"
        >
          <Grid templateColumns={{ base: "1fr", lg: "0.88fr 1.12fr" }}>
            <Box
              p={{ base: "22px", md: "28px" }}
              bg="linear-gradient(160deg, #15120f 0%, #2b2119 56%, #f36a1d 180%)"
              color="white"
            >
              <Stack gap="18px">
                <Badge
                  alignSelf="flex-start"
                  borderRadius="full"
                  px="12px"
                  py="6px"
                  bg="rgba(255,255,255,0.12)"
                  color="white"
                  border="1px solid rgba(255,255,255,0.16)"
                >
                  Ledger guarded · 1-of-1 Safe
                </Badge>
                <Stack gap="8px">
                  <Heading size="xl" letterSpacing="-0.04em">
                    Platform fee treasury draft
                  </Heading>
                  <Text color="rgba(255,255,255,0.72)">
                    Create the Safe transaction payload only. Final execution
                    happens in Safe UI with the Ledger signer.
                  </Text>
                </Stack>
                <Stack gap="10px" pt="6px">
                  {[
                    "Backend fixes SynapseCore, selector, calldata, and value.",
                    "Only super admins can create drafts.",
                    "No admin browser can broadcast treasury funds.",
                  ].map((item) => (
                    <Box
                      key={item}
                      display="flex"
                      gap="10px"
                      alignItems="flex-start"
                    >
                      <Box
                        mt="6px"
                        w="7px"
                        h="7px"
                        borderRadius="full"
                        bg="#7dffbd"
                        boxShadow="0 0 18px rgba(125,255,189,0.9)"
                      />
                      <Text color="rgba(255,255,255,0.78)">{item}</Text>
                    </Box>
                  ))}
                </Stack>
                <Box
                  borderRadius="22px"
                  p="16px"
                  bg="rgba(255,255,255,0.08)"
                  border="1px solid rgba(255,255,255,0.12)"
                >
                  <Text
                    fontSize="11px"
                    letterSpacing="0.18em"
                    textTransform="uppercase"
                    color="rgba(255,255,255,0.56)"
                  >
                    Manual execution
                  </Text>
                  <Text mt="8px" fontWeight="700">
                    Open Safe UI and confirm with Ledger.
                  </Text>
                </Box>
              </Stack>
            </Box>

            <Box p={{ base: "22px", md: "28px" }}>
              <Stack gap="18px">
                <Stack
                  direction="row"
                  justify="space-between"
                  align="flex-start"
                >
                  <Stack gap="4px">
                    <Text
                      fontSize="11px"
                      letterSpacing="0.18em"
                      textTransform="uppercase"
                      color="brand.700"
                    >
                      Super admin action
                    </Text>
                    <Heading size="lg" color="ink.900">
                      Create Safe draft
                    </Heading>
                    <Text color="ink.500">
                      Amount and reason are audited with the generated calldata
                      hash.
                    </Text>
                  </Stack>
                  <Button variant="ghost" onClick={onClose}>
                    Close
                  </Button>
                </Stack>

                {error ? <MessageBanner kind="error" message={error} /> : null}

                <Grid
                  templateColumns={{ base: "1fr", md: "0.72fr 1.28fr" }}
                  gap="12px"
                >
                  <FieldBlock
                    label="Amount USDC"
                    hint="Use up to 6 decimals. The backend checks this against platformFeePool()."
                  >
                    <Input
                      value={amountUsdc}
                      onChange={(event) => setAmountUsdc(event.target.value)}
                      placeholder="100.000000"
                      borderRadius="16px"
                      h="50px"
                      bg="rgba(255,255,255,0.9)"
                      borderColor="rgba(99,92,82,0.16)"
                    />
                  </FieldBlock>
                  <FieldBlock
                    label="Reason"
                    hint="Required for audit evidence and Safe operation review."
                  >
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Move accrued platform fees to the 1-of-1 Safe treasury."
                      style={{ ...nativeTextAreaStyle, minHeight: "96px" }}
                    />
                  </FieldBlock>
                </Grid>

                <Stack
                  direction={{ base: "column", md: "row" }}
                  justify="flex-end"
                  gap="10px"
                >
                  <Button variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    bg="brand.500"
                    color="white"
                    _hover={{ bg: "brand.600" }}
                    disabled={!canSubmit}
                    onClick={() => void handleSubmit()}
                  >
                    {submitting ? "Creating draft..." : "Create Safe draft"}
                  </Button>
                </Stack>

                {draft ? (
                  <Stack
                    gap="14px"
                    borderTop="1px solid rgba(99,92,82,0.12)"
                    pt="18px"
                  >
                    <Stack
                      direction={{ base: "column", md: "row" }}
                      justify="space-between"
                      align={{ base: "flex-start", md: "center" }}
                      gap="12px"
                    >
                      <Stack gap="2px">
                        <Text
                          fontSize="11px"
                          letterSpacing="0.18em"
                          textTransform="uppercase"
                          color="signal.700"
                        >
                          Ready for Safe
                        </Text>
                        <Heading size="md">
                          Copy this draft into Safe UI
                        </Heading>
                      </Stack>
                      <Button
                        size="sm"
                        borderRadius="full"
                        onClick={() =>
                          void copyValue("Safe tx JSON", safeTxJson)
                        }
                      >
                        {copied === "Safe tx JSON"
                          ? "Copied"
                          : "Copy Safe tx JSON"}
                      </Button>
                    </Stack>

                    <Grid
                      templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }}
                      gap="10px"
                    >
                      <SafeFact
                        label="Safe address"
                        value={draft.safeAddress}
                      />
                      <SafeFact
                        label="Ledger signer"
                        value={draft.ledgerSignerAddress}
                      />
                      <SafeFact
                        label="SynapseCore"
                        value={draft.synapseCoreAddress}
                      />
                      <SafeFact label="Selector" value={draft.selector} />
                      <SafeFact
                        label="Calldata hash"
                        value={draft.calldataHash}
                      />
                      <SafeFact
                        label="Amount atomic"
                        value={draft.amountAtomic}
                      />
                    </Grid>

                    <Box
                      borderRadius="18px"
                      bg="#101010"
                      color="#f8f3ec"
                      p="14px"
                      border="1px solid rgba(255,255,255,0.08)"
                    >
                      <Text
                        fontSize="10px"
                        letterSpacing="0.16em"
                        textTransform="uppercase"
                        color="rgba(255,255,255,0.48)"
                      >
                        Safe transaction payload
                      </Text>
                      <Box
                        as="pre"
                        mt="10px"
                        fontSize="12px"
                        whiteSpace="pre-wrap"
                        overflowX="auto"
                      >
                        {safeTxJson}
                      </Box>
                    </Box>
                  </Stack>
                ) : null}
              </Stack>
            </Box>
          </Grid>
        </Box>
      </Box>
      {stepUpModal}
    </Box>
  );
}
