"use client";

import { Box, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

type AuthProtocolShellProps = {
  eyebrow: string;
  title: string;
  versionLabel: string;
  statusLabel: string;
  railTitle: string;
  railDescription: string;
  railFacts: Array<{ label: string; value: string }>;
  children: ReactNode;
  layout?: "split" | "centered";
  panelMaxW?: string | Record<string, string>;
  progressWidth?: string;
  headerVariant?: "plain" | "accent-bar";
};

export function AuthProtocolShell({
  eyebrow,
  title,
  versionLabel,
  statusLabel,
  railTitle,
  railDescription,
  railFacts,
  children,
  layout = "split",
  panelMaxW = "460px",
  progressWidth,
  headerVariant = "plain",
}: Readonly<AuthProtocolShellProps>) {
  return (
    <Box minH="100dvh" bg="#020617" color="#f8fafc" position="relative" overflow="hidden">
      <Box position="fixed" inset="0" pointerEvents="none" opacity={0.9} backgroundImage="linear-gradient(to right, rgba(34, 211, 238, 0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(34, 211, 238, 0.05) 1px, transparent 1px)" backgroundSize="40px 40px" />
      <Box position="fixed" inset="0" pointerEvents="none" opacity={0.4} backgroundImage="radial-gradient(circle at 1px 1px, #1e293b 1px, transparent 0)" backgroundSize="20px 20px" />
      <Box position="fixed" left="0" right="0" h="24" pointerEvents="none" opacity={0.72} background="linear-gradient(180deg, rgba(34, 211, 238, 0) 0%, rgba(34, 211, 238, 0.03) 46%, rgba(34, 211, 238, 0) 100%)" animation="scanline 8s linear infinite" />
      <Box position="fixed" top="0" left="0" right="0" h="16" zIndex={20} borderBottom="1px solid rgba(34, 211, 238, 0.12)" bg="rgba(2, 6, 23, 0.82)" backdropFilter="blur(16px)">
        <Flex h="full" maxW="7xl" mx="auto" px={{ base: "5", md: "6" }} align="center" justify="space-between" gap="4">
          <Flex align="center" gap="3">
            <Box w="8" h="8" display="grid" placeItems="center" bg="rgba(34, 211, 238, 0.10)" borderRadius="8px" border="1px solid rgba(34, 211, 238, 0.28)">
              <Text color="#22d3ee" fontSize="14px" fontWeight="800">S</Text>
            </Box>
            <Text fontSize="xl" fontWeight="800" letterSpacing="-0.03em">Synapse Network</Text>
            <Box px="2" py="1" borderRadius="6px" bg="rgba(34, 211, 238, 0.18)" border="1px solid rgba(34, 211, 238, 0.28)">
              <Text fontSize="10px" fontWeight="800" letterSpacing="0.18em" textTransform="uppercase" color="#67e8f9">Admin_Portal</Text>
            </Box>
          </Flex>
          <Text fontSize="11px" fontFamily="mono" letterSpacing="0.08em" color="rgba(148, 163, 184, 0.92)">{statusLabel}</Text>
        </Flex>
      </Box>

      <Box position="absolute" top="24" left="10" w="32" h="32" border="1px solid rgba(34, 211, 238, 0.10)" borderRadius="full" display={{ base: "none", xl: "flex" }} alignItems="center" justifyContent="center">
        <Box w="16" h="16" border="1px solid rgba(34, 211, 238, 0.18)" borderRadius="full" animation="spin 10s linear infinite" />
      </Box>
      <Box position="absolute" bottom="24" right="10" w="48" h="48" border="1px solid rgba(34, 211, 238, 0.10)" borderRadius="full" display={{ base: "none", xl: "flex" }} alignItems="center" justifyContent="center">
        <Box w="24" h="24" border="1px solid rgba(34, 211, 238, 0.18)" borderRadius="full" animation="spin 15s linear infinite reverse" />
      </Box>

      <Flex
        as="main"
        position="relative"
        zIndex={1}
        px={{ base: "4", md: "6" }}
        pt="24"
        pb="28"
        minH="calc(100dvh - 64px)"
        align={layout === "centered" ? "center" : "stretch"}
      >
        {layout === "centered" ? (
          <Box maxW={panelMaxW} w="full" mx="auto" my="auto" position="relative">
            <Box position="absolute" top="-1px" left="-1px" w="4" h="4" borderTop="2px solid #22d3ee" borderLeft="2px solid #22d3ee" />
            <Box position="absolute" bottom="-1px" right="-1px" w="4" h="4" borderBottom="2px solid #22d3ee" borderRight="2px solid #22d3ee" />
            <Box bg="rgba(15, 23, 42, 0.9)" border="1px solid rgba(34, 211, 238, 0.18)" boxShadow="0 24px 60px rgba(0, 0, 0, 0.5), inset 0 0 10px rgba(34, 211, 238, 0.05)" backdropFilter="blur(18px)" p={{ base: "6", md: "8", xl: "10" }} borderRadius="8px" position="relative" overflow="hidden">
              {progressWidth ? <Box position="absolute" top="0" left="0" h="1" w={progressWidth} bg="#22d3ee" /> : null}
              <Stack gap="8" position="relative">
                <Stack gap="2" borderLeft={headerVariant === "accent-bar" ? "4px solid #22d3ee" : undefined} pl={headerVariant === "accent-bar" ? { base: "4", md: "6" } : undefined}>
                  <Text fontSize="11px" fontWeight="800" letterSpacing="0.22em" textTransform="uppercase" color="rgba(103, 232, 249, 0.76)">{eyebrow}</Text>
                  <Heading fontSize={{ base: "2xl", md: "4xl" }} lineHeight="1.02" letterSpacing="-0.04em">{title}</Heading>
                  <Text color="rgba(148, 163, 184, 0.92)" fontFamily="mono" fontSize="12px">{versionLabel}</Text>
                </Stack>
                {children}
              </Stack>
            </Box>
          </Box>
        ) : (
          <Flex maxW="7xl" mx="auto" direction={{ base: "column", xl: "row" }} gap="6" align="stretch">
            <Box flex={{ base: "none", xl: "0 0 440px" }} borderRadius="28px" bg="rgba(15, 23, 42, 0.92)" border="1px solid rgba(34, 211, 238, 0.18)" boxShadow="0 0 24px rgba(34, 211, 238, 0.14), inset 0 0 12px rgba(34, 211, 238, 0.05)" p={{ base: "6", md: "8" }} position="relative" overflow="hidden">
              <Box position="absolute" inset="0" bg="radial-gradient(circle at top left, rgba(34, 211, 238, 0.12), transparent 30%), radial-gradient(circle at bottom right, rgba(255,255,255,0.05), transparent 26%)" />
              <Stack position="relative" gap="5">
                <Text fontSize="11px" fontWeight="800" letterSpacing="0.22em" textTransform="uppercase" color="rgba(103, 232, 249, 0.72)">{eyebrow}</Text>
                <Heading fontSize={{ base: "3xl", md: "4xl" }} lineHeight="1.02" letterSpacing="-0.03em">{railTitle}</Heading>
                <Text color="rgba(226, 232, 240, 0.72)">{railDescription}</Text>
                <Flex wrap="wrap" gap="3" pt="1">
                  {railFacts.map((fact) => (
                    <Box key={fact.label} minW={{ base: "100%", md: "calc(50% - 6px)" }} borderRadius="18px" p="4" bg="rgba(255,255,255,0.05)" border="1px solid rgba(255,255,255,0.08)">
                      <Text fontSize="11px" letterSpacing="0.16em" textTransform="uppercase" color="rgba(148, 163, 184, 0.78)">{fact.label}</Text>
                      <Text mt="2.5" fontWeight="700">{fact.value}</Text>
                    </Box>
                  ))}
                </Flex>
              </Stack>
            </Box>

            <Box flex="1" borderRadius="28px" bg="rgba(15, 23, 42, 0.86)" border="1px solid rgba(34, 211, 238, 0.16)" boxShadow="0 24px 60px rgba(0, 0, 0, 0.45)" p="1">
              <Box borderRadius="24px" bg="rgba(2, 6, 23, 0.92)" p={{ base: "6", md: "8", xl: "10" }} minH="full">
                <Stack gap="6">
                  <Stack gap="1.5">
                    <Text fontSize="11px" fontWeight="800" letterSpacing="0.22em" textTransform="uppercase" color="rgba(103, 232, 249, 0.76)">{eyebrow}</Text>
                    <Heading fontSize={{ base: "2xl", md: "3xl" }} letterSpacing="-0.03em">{title}</Heading>
                    <Text color="rgba(148, 163, 184, 0.92)" fontFamily="mono" fontSize="12px">{versionLabel}</Text>
                  </Stack>
                  {children}
                </Stack>
              </Box>
            </Box>
          </Flex>
        )}
      </Flex>

      <Box
        as="footer"
        position="fixed"
        left="0"
        right="0"
        bottom="0"
        zIndex={15}
        borderTop="1px solid rgba(34, 211, 238, 0.10)"
        bg="rgba(2, 6, 23, 0.84)"
        backdropFilter="blur(12px)"
      >
        <Flex justify="space-between" align={{ base: "flex-start", md: "center" }} direction={{ base: "column", md: "row" }} gap="4" px={{ base: "5", md: "8" }} py="4" maxW="7xl" mx="auto">
          <Text fontSize="10px" letterSpacing="0.22em" textTransform="uppercase" color="rgba(100, 116, 139, 0.9)">© 2026 Synapse Network. Secure Sentinel Interface.</Text>
          <Flex gap="6" wrap="wrap">
            {[
              "Security Logs",
              "Encryption Protocol",
              "Core Status",
            ].map((item) => (
              <Text key={item} fontSize="10px" letterSpacing="0.22em" textTransform="uppercase" color="rgba(100, 116, 139, 0.9)">{item}</Text>
            ))}
          </Flex>
        </Flex>
      </Box>

      <style>{`@keyframes scanline { 0% { transform: translateY(-160px); } 100% { transform: translateY(calc(100vh + 160px)); } }`}</style>
    </Box>
  );
}