"use client";

import { Box, Heading, Text } from "@chakra-ui/react";

export function SystemDiagnosticsExtra({
  reconciliationLastError,
}: Readonly<{ reconciliationLastError: string | null }>) {
  if (!reconciliationLastError) {
    return null;
  }

  return (
    <Box
      borderRadius="20px"
      p="16px"
      bg="rgba(184, 49, 49, 0.10)"
      border="1px solid rgba(184, 49, 49, 0.16)"
    >
      <Heading size="sm" color="#8f1d1d">
        最近一次对账错误
      </Heading>
      <Text mt="8px" color="#8f1d1d">
        {reconciliationLastError}
      </Text>
    </Box>
  );
}
