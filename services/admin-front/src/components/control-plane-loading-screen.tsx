"use client";

import { Box, Flex, Grid, Heading, Stack, Text } from "@chakra-ui/react";

import { buildControlPlaneSignals } from "@/features/loading/control-plane-loading-presenters";

const toneStyles = {
  cyan: {
    border: "1px solid rgba(34, 211, 238, 0.24)",
    bg: "rgba(34, 211, 238, 0.10)",
    color: "#67e8f9",
  },
  green: {
    border: "1px solid rgba(74, 222, 128, 0.22)",
    bg: "rgba(74, 222, 128, 0.10)",
    color: "#86efac",
  },
  amber: {
    border: "1px solid rgba(250, 204, 21, 0.22)",
    bg: "rgba(250, 204, 21, 0.10)",
    color: "#fde68a",
  },
} as const;

type ControlPlaneLoadingScreenProps = {
  title?: string;
  message: string;
};

export function ControlPlaneLoadingScreen({
  title = "Control Plane Link in Progress",
  message,
}: Readonly<ControlPlaneLoadingScreenProps>) {
  const signals = buildControlPlaneSignals(message);

  return (
    <Box as="main" minH="100vh" position="relative" overflow="hidden" bg="#05080A" color="#f8fafc">
      <Box position="absolute" inset="0" opacity={0.42} backgroundImage="linear-gradient(to right, rgba(34, 211, 238, 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(34, 211, 238, 0.05) 1px, transparent 1px)" backgroundSize="44px 44px" />
      <Box position="absolute" inset="0" background="radial-gradient(circle at top left, rgba(34, 211, 238, 0.18), transparent 28%), radial-gradient(circle at bottom right, rgba(59, 130, 246, 0.18), transparent 32%), linear-gradient(180deg, rgba(2, 6, 23, 0.88) 0%, rgba(2, 6, 23, 0.98) 100%)" />
      <Box position="absolute" top="-120px" right="-80px" w="340px" h="340px" borderRadius="full" bg="rgba(34, 211, 238, 0.12)" filter="blur(80px)" animation="controlPlaneOrb 8s ease-in-out infinite" />
      <Box position="absolute" bottom="-120px" left="-60px" w="300px" h="300px" borderRadius="full" bg="rgba(59, 130, 246, 0.10)" filter="blur(90px)" animation="controlPlaneOrb 10s ease-in-out infinite reverse" />

      <Flex position="relative" zIndex={1} minH="100vh" align="center" justify="center" px={{ base: "5", md: "8" }} py={{ base: "8", md: "12" }}>
        <Box w="full" maxW="880px" position="relative" border="1px solid rgba(34, 211, 238, 0.18)" borderRadius="24px" bg="rgba(2, 6, 23, 0.78)" boxShadow="0 28px 90px rgba(2, 6, 23, 0.58), inset 0 0 24px rgba(34, 211, 238, 0.06)" backdropFilter="blur(20px)" overflow="hidden">
          <Box position="absolute" top="0" left="0" right="0" h="1px" bg="linear-gradient(90deg, transparent 0%, rgba(34, 211, 238, 0.85) 45%, transparent 100%)" animation="controlPlaneSweep 1.8s linear infinite" />
          <Box position="absolute" top="18px" left="18px" w="18px" h="18px" borderTop="2px solid #22d3ee" borderLeft="2px solid #22d3ee" />
          <Box position="absolute" bottom="18px" right="18px" w="18px" h="18px" borderBottom="2px solid #22d3ee" borderRight="2px solid #22d3ee" />

          <Stack gap="8" px={{ base: "6", md: "10" }} py={{ base: "7", md: "9" }}>
            <Flex align={{ base: "flex-start", md: "center" }} justify="space-between" direction={{ base: "column", md: "row" }} gap="4">
              <Stack gap="2">
                <Text fontSize="11px" fontWeight="800" letterSpacing="0.22em" textTransform="uppercase" color="rgba(103, 232, 249, 0.78)">
                  Synapse Sentinel Loading Surface
                </Text>
                <Heading fontSize={{ base: "3xl", md: "5xl" }} lineHeight="0.96" letterSpacing="-0.05em">
                  {title}
                </Heading>
                <Text maxW="2xl" color="rgba(226, 232, 240, 0.74)">
                  {message}
                </Text>
              </Stack>

              <Box minW={{ base: "full", md: "220px" }} border="1px solid rgba(34, 211, 238, 0.16)" borderRadius="18px" bg="rgba(15, 23, 42, 0.58)" px="5" py="4">
                <Text fontSize="10px" letterSpacing="0.18em" textTransform="uppercase" color="rgba(148, 163, 184, 0.88)">Session Bootstrap</Text>
                <Text mt="3" fontFamily="mono" fontSize="sm" color="#67e8f9">gateway-admin / secure-link / v4</Text>
                <Flex mt="4" align="center" gap="3">
                  <Box w="10px" h="10px" borderRadius="full" bg="#22d3ee" boxShadow="0 0 18px rgba(34, 211, 238, 0.75)" animation="controlPlanePulse 1.4s ease-in-out infinite" />
                  <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="rgba(148, 163, 184, 0.9)">transport nominal</Text>
                </Flex>
              </Box>
            </Flex>

            <Box borderRadius="999px" border="1px solid rgba(34, 211, 238, 0.18)" bg="rgba(15, 23, 42, 0.78)" p="1.5">
              <Box h="10px" borderRadius="999px" bg="linear-gradient(90deg, rgba(34, 211, 238, 0.10) 0%, rgba(34, 211, 238, 0.88) 52%, rgba(59, 130, 246, 0.72) 100%)" backgroundSize="200% 100%" animation="controlPlaneFlow 1.6s linear infinite" />
            </Box>

            <Grid templateColumns={{ base: "1fr", md: "repeat(3, minmax(0, 1fr))" }} gap="4">
              {signals.map((signal) => (
                <Box key={signal.label} borderRadius="18px" px="5" py="4" bg="rgba(15, 23, 42, 0.6)" border="1px solid rgba(148, 163, 184, 0.10)">
                  <Text fontSize="10px" letterSpacing="0.18em" textTransform="uppercase" color="rgba(148, 163, 184, 0.82)">{signal.label}</Text>
                  <Flex mt="3" align="center" justify="space-between" gap="3">
                    <Text fontSize="lg" fontWeight="700" letterSpacing="-0.02em">{signal.value}</Text>
                    <Box px="3" py="1.5" borderRadius="999px" fontSize="10px" letterSpacing="0.18em" textTransform="uppercase" {...toneStyles[signal.tone]}>
                      active
                    </Box>
                  </Flex>
                </Box>
              ))}
            </Grid>
          </Stack>
        </Box>
      </Flex>

      <style>{`
        @keyframes controlPlaneSweep {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }

        @keyframes controlPlaneFlow {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        @keyframes controlPlanePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.58; transform: scale(0.82); }
        }

        @keyframes controlPlaneOrb {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(16px, -18px, 0) scale(1.06); }
        }
      `}</style>
    </Box>
  );
}