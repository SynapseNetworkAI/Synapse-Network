"use client";

import { Box, Button, Flex, Input, Stack, Text } from "@chakra-ui/react";

import type { LoginControllerState } from "@/features/auth/use-login-controller";

type LoginFormProps = {
  controller: LoginControllerState;
};

type LoginEmailFieldProps = Pick<LoginControllerState, "email" | "setEmail">;

type LoginPasswordFieldProps = Pick<
  LoginControllerState,
  | "password"
  | "showPassword"
  | "setPassword"
  | "setShowPassword"
  | "clearPassword"
>;

type LoginTotpFieldProps = Pick<LoginControllerState, "otpCode" | "setOtpCode">;

type LoginSubmitButtonProps = Pick<
  LoginControllerState,
  "isPending" | "showLoginTotp"
>;

type LoginFeedbackBoxProps = Pick<
  LoginControllerState,
  "feedback" | "feedbackStyles"
>;

const inputFocusStyles = {
  borderColor: "rgba(34, 211, 238, 0.55)",
  boxShadow: "0 0 0 1px rgba(34, 211, 238, 0.28)",
};

function FieldLabel({ children }: { children: string }) {
  return (
    <Text
      fontSize="10px"
      fontWeight="800"
      letterSpacing="0.2em"
      textTransform="uppercase"
      color="rgba(103, 232, 249, 0.68)"
    >
      {children}
    </Text>
  );
}

function LoginEmailField({ email, setEmail }: LoginEmailFieldProps) {
  return (
    <Stack gap="2">
      <FieldLabel>Operator Identification</FieldLabel>
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
        _focusVisible={inputFocusStyles}
      />
    </Stack>
  );
}

function LoginPasswordField({
  password,
  showPassword,
  setPassword,
  setShowPassword,
  clearPassword,
}: LoginPasswordFieldProps) {
  return (
    <Stack gap="2">
      <Flex justify="space-between" align="center">
        <FieldLabel>Access Cipher</FieldLabel>
        <Button
          variant="ghost"
          size="sm"
          color="rgba(148, 163, 184, 0.85)"
          _hover={{ color: "#67e8f9", bg: "transparent" }}
          onClick={clearPassword}
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
          _focusVisible={inputFocusStyles}
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
  );
}

function LoginTotpField({ otpCode, setOtpCode }: LoginTotpFieldProps) {
  return (
    <Stack gap="2">
      <FieldLabel>Google Authenticator Token</FieldLabel>
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
            onChange={(event) => setOtpCode(event.target.value)}
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
            _focusVisible={inputFocusStyles}
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
          <Text color="rgba(103, 232, 249, 0.7)" fontSize="xs" fontWeight="800">
            OTP
          </Text>
        </Box>
      </Flex>
    </Stack>
  );
}

function LoginSubmitButton({
  isPending,
  showLoginTotp,
}: LoginSubmitButtonProps) {
  return (
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
      {isPending ? "Executing..." : "Execute Initialization"}
    </Button>
  );
}

function LoginFeedbackBox({ feedback, feedbackStyles }: LoginFeedbackBoxProps) {
  return (
    <Box
      borderRadius="6px"
      p="4"
      bg={feedbackStyles.bg}
      border={feedbackStyles.border}
      color={feedbackStyles.color}
    >
      <Text fontSize="sm">{feedback.message}</Text>
    </Box>
  );
}

export function LoginForm({ controller }: LoginFormProps) {
  return (
    <form onSubmit={controller.handleSubmit}>
      <Stack gap="6">
        <LoginEmailField
          email={controller.email}
          setEmail={controller.setEmail}
        />
        <LoginPasswordField
          password={controller.password}
          showPassword={controller.showPassword}
          setPassword={controller.setPassword}
          setShowPassword={controller.setShowPassword}
          clearPassword={controller.clearPassword}
        />
        {controller.showLoginTotp ? (
          <LoginTotpField
            otpCode={controller.otpCode}
            setOtpCode={controller.setOtpCode}
          />
        ) : null}
        <LoginSubmitButton
          isPending={controller.isPending}
          showLoginTotp={controller.showLoginTotp}
        />
        <LoginFeedbackBox
          feedback={controller.feedback}
          feedbackStyles={controller.feedbackStyles}
        />
      </Stack>
    </form>
  );
}
