"use client";

import { Box, Button, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";

import { AuthProtocolShell } from "@/components/auth-protocol-shell";

export default function ResetSuccessPage() {
  return (
    <AuthProtocolShell
      eyebrow="Security Protocol Updated"
      title="Credential Reset Complete"
      versionLabel="RESET_SEQUENCE :: VERIFIED"
      statusLabel="ENCRYPTION_LEVEL :: QUANTUM-V"
      railTitle="密码重置已闭环，当前凭据已经同步到新的登录入口。"
      railDescription="成功态页面参考 `stitch/reset_successful`，保持单点确认、清晰回流和低噪音成功信号。"
      railFacts={[
        { label: "Reset State", value: "Verified" },
        { label: "Next Action", value: "Initiate Login Sequence" },
        { label: "Security Layer", value: "Credential Sync Active" },
      ]}
    >
      <Stack align="center" textAlign="center" gap="6" py={{ base: "4", md: "10" }}>
        <Box position="relative">
          <Box position="absolute" inset="0" bg="rgba(34, 211, 238, 0.16)" borderRadius="full" transform="scale(1.5)" filter="blur(20px)" />
          <Box position="relative" w="20" h="20" borderRadius="full" border="2px solid rgba(34, 211, 238, 0.35)" bg="rgba(15,23,42,0.78)" display="grid" placeItems="center" boxShadow="inset 0 0 15px rgba(34, 211, 238, 0.2)">
            <Text color="#22d3ee" fontSize="5xl" fontWeight="900">✓</Text>
          </Box>
        </Box>

        <Stack gap="2" maxW="md">
          <Text fontSize="11px" fontWeight="800" letterSpacing="0.3em" textTransform="uppercase" color="rgba(103, 232, 249, 0.62)">Synapse Network Node</Text>
          <Text fontSize={{ base: "2xl", md: "3xl" }} fontWeight="800" letterSpacing="-0.03em">Security Protocol Updated.</Text>
          <Text color="rgba(148, 163, 184, 0.92)">Biometric handshake complete. Your administrator credentials have been synchronized across the Sentinel access mesh.</Text>
        </Stack>

        <Link href="/login">
          <Button h="16" minW="260px" borderRadius="10px" bg="linear-gradient(90deg, #22d3ee 0%, #67e8f9 100%)" color="#082f49" fontWeight="900" fontFamily="heading" textTransform="uppercase" letterSpacing="0.16em" _hover={{ filter: "brightness(1.06)", boxShadow: "0 0 24px rgba(34, 211, 238, 0.34)" }}>
            Initiate Login Sequence
          </Button>
        </Link>

        <Text fontSize="10px" letterSpacing="0.2em" textTransform="uppercase" color="rgba(103, 232, 249, 0.46)">Encryption Level: Quantum-V</Text>
      </Stack>
    </AuthProtocolShell>
  );
}