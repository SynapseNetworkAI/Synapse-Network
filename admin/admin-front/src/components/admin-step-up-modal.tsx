"use client";

import { Box, Button, Heading, Input, Stack, Text } from "@chakra-ui/react";

type AdminStepUpModalProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  issuer: string;
  code: string;
  error: string | null;
  expiredNotice: boolean;
  remainingSeconds: number;
  onCodeChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function AdminStepUpModal({
  open,
  title,
  description,
  confirmLabel,
  issuer,
  code,
  error,
  expiredNotice,
  remainingSeconds,
  onCodeChange,
  onCancel,
  onConfirm,
}: Readonly<AdminStepUpModalProps>) {
  if (!open) {
    return null;
  }

  return (
    <Box position="fixed" inset="0" zIndex={50}>
      <Box position="absolute" inset="0" bg="rgba(20,19,17,0.56)" backdropFilter="blur(8px)" onClick={onCancel} />
      <Box position="relative" maxW="520px" mx="auto" mt={{ base: "16vh", md: "18vh" }} px="16px">
        <Box bg="#f8f3ec" borderRadius="28px" p={{ base: "20px", md: "24px" }} boxShadow="0 32px 80px rgba(20,19,17,0.24)">
          <Stack gap="16px">
            <Stack gap="4px">
              <Text fontSize="11px" letterSpacing="0.2em" textTransform="uppercase" color="brand.700">Step-up Verification</Text>
              <Heading size="lg">{title}</Heading>
              <Text color="ink.500">{description}</Text>
            </Stack>
            <Stack direction={{ base: "column", md: "row" }} gap="8px">
              <Box px="12px" py="8px" borderRadius="full" bg="rgba(184,49,49,0.10)" color="#8f1d1d">high-risk action</Box>
              <Box px="12px" py="8px" borderRadius="full" bg="rgba(99,92,82,0.08)" color="ink.600">issuer {issuer}</Box>
              <Box px="12px" py="8px" borderRadius="full" bg={remainingSeconds <= 5 ? "rgba(243,106,29,0.12)" : "rgba(31,146,87,0.10)"} color={remainingSeconds <= 5 ? "brand.700" : "signal.700"}>code refresh in {remainingSeconds}s</Box>
            </Stack>
            <form
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
              <Stack gap="12px">
                <Text fontWeight="700">Google Authenticator 验证码</Text>
                <Input
              type="text"
              inputMode="numeric"
              autoFocus
              placeholder="123456"
              value={code}
              onChange={(event) => onCodeChange(event.target.value)}
                  borderRadius="16px"
                  bg="rgba(255,255,255,0.9)"
                  borderColor="rgba(99,92,82,0.16)"
                  _focusVisible={{ borderColor: "brand.400", boxShadow: "0 0 0 3px rgba(243,106,29,0.16)" }}
                />
                <Text color="ink.500">此验证码只用于当前一步高风险动作，不会替代当前管理员 session。</Text>
                {expiredNotice ? <Box borderRadius="16px" p="12px" bg="rgba(184,49,49,0.10)" color="#8f1d1d">验证码已过期，请输入新的 6 位验证码。</Box> : null}
                {error ? <Box borderRadius="16px" p="12px" bg="rgba(184,49,49,0.10)" color="#8f1d1d">{error}</Box> : null}
                <Stack direction={{ base: "column", md: "row" }} gap="10px" justify="flex-end">
                  <Button variant="outline" onClick={onCancel}>取消</Button>
                  <Button bg="brand.500" color="white" _hover={{ bg: "brand.600" }} type="submit">{confirmLabel}</Button>
                </Stack>
              </Stack>
            </form>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}