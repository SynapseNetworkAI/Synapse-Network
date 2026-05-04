"use client";

import { Box, Button, Heading, Stack, Text } from "@chakra-ui/react";

type ConfirmActionTone = "default" | "danger";

export type ConfirmActionModalProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  contextLabel?: string;
  tone?: ConfirmActionTone;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmActionModal({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "取消",
  contextLabel,
  tone = "default",
  loading = false,
  onCancel,
  onConfirm,
}: Readonly<ConfirmActionModalProps>) {
  if (!open) {
    return null;
  }

  const isDanger = tone === "danger";

  return (
    <Box position="fixed" inset="0" zIndex={60}>
      <Box
        position="absolute"
        inset="0"
        bg="rgba(20,19,17,0.56)"
        backdropFilter="blur(8px)"
        onClick={loading ? undefined : onCancel}
      />
      <Box
        position="relative"
        maxW="520px"
        mx="auto"
        mt={{ base: "16vh", md: "18vh" }}
        px="16px"
      >
        <Box
          bg="#f8f3ec"
          borderRadius="28px"
          p={{ base: "20px", md: "24px" }}
          boxShadow="0 32px 80px rgba(20,19,17,0.24)"
        >
          <Stack gap="16px">
            <Stack gap="4px">
              <Text
                fontSize="11px"
                letterSpacing="0.2em"
                textTransform="uppercase"
                color={isDanger ? "#8f1d1d" : "brand.700"}
              >
                {isDanger ? "Danger confirmation" : "Action confirmation"}
              </Text>
              <Heading size="lg">{title}</Heading>
              <Text color="ink.500">{description}</Text>
            </Stack>
            {contextLabel ? (
              <Box
                borderRadius="18px"
                p="12px"
                bg={isDanger ? "rgba(184,49,49,0.10)" : "rgba(99,92,82,0.08)"}
                color={isDanger ? "#8f1d1d" : "ink.700"}
                fontWeight="700"
              >
                {contextLabel}
              </Box>
            ) : null}
            <Stack
              direction={{ base: "column", md: "row" }}
              gap="10px"
              justify="flex-end"
            >
              <Button variant="outline" onClick={onCancel} disabled={loading}>
                {cancelLabel}
              </Button>
              <Button
                bg={isDanger ? "#ba1a1a" : "brand.500"}
                color="white"
                _hover={{ bg: isDanger ? "#8f1d1d" : "brand.600" }}
                loading={loading}
                onClick={() => void onConfirm()}
              >
                {confirmLabel}
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
