"use client";

import { Grid, Input } from "@chakra-ui/react";
import { KeyboardEvent, useRef } from "react";

import { applyOtpSlotEdit, getOtpSlots, normalizeOtpCode } from "@/components/auth-code-slots.helpers";

type AuthCodeSlotsProps = {
  value: string;
  onChange: (nextValue: string) => void;
  length?: number;
  isDisabled?: boolean;
};

export function AuthCodeSlots({
  value,
  onChange,
  length = 6,
  isDisabled = false,
}: Readonly<AuthCodeSlotsProps>) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const slots = getOtpSlots(value, length);

  function focusSlot(index: number) {
    inputRefs.current[index]?.focus();
    inputRefs.current[index]?.select();
  }

  return (
    <Grid templateColumns={`repeat(${length}, minmax(0, 1fr))`} gap="3">
      {slots.map((slotValue, index) => (
        <Input
          key={`otp-slot-${index + 1}`}
          ref={(node) => {
            inputRefs.current[index] = node;
          }}
          value={slotValue}
          onChange={(event) => {
            const nextValue = applyOtpSlotEdit(value, index, event.target.value, length);
            onChange(nextValue);

            const normalizedInput = normalizeOtpCode(event.target.value, length);
            if (!normalizedInput) {
              return;
            }

            const nextIndex = Math.min(index + normalizedInput.length, length - 1);
            if (nextIndex !== index) {
              focusSlot(nextIndex);
            }
          }}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Backspace" && !slots[index] && index > 0) {
              event.preventDefault();
              const nextValue = `${value.slice(0, index - 1)}${value.slice(index)}`;
              onChange(nextValue);
              focusSlot(index - 1);
            }

            if (event.key === "ArrowLeft" && index > 0) {
              event.preventDefault();
              focusSlot(index - 1);
            }

            if (event.key === "ArrowRight" && index < length - 1) {
              event.preventDefault();
              focusSlot(index + 1);
            }
          }}
          onPaste={(event) => {
            event.preventDefault();
            const pasted = event.clipboardData.getData("text");
            const nextValue = applyOtpSlotEdit(value, index, pasted, length);
            onChange(nextValue);

            const pastedDigits = normalizeOtpCode(pasted, length);
            const nextIndex = Math.min(index + Math.max(pastedDigits.length - 1, 0), length - 1);
            focusSlot(nextIndex);
          }}
          onFocus={(event) => event.target.select()}
          inputMode="numeric"
          maxLength={length}
          textAlign="center"
          fontSize={{ base: "xl", md: "2xl" }}
          fontWeight="800"
          fontFamily="mono"
          letterSpacing="0.02em"
          h={{ base: "14", md: "16" }}
          borderRadius="4px"
          bg="rgba(15,23,42,0.94)"
          borderColor={slotValue ? "rgba(34, 211, 238, 0.58)" : "rgba(30,41,59,0.95)"}
          color="#f8fafc"
          disabled={isDisabled}
          _hover={{ borderColor: "rgba(34, 211, 238, 0.35)" }}
          _focusVisible={{
            borderColor: "rgba(34, 211, 238, 0.9)",
            boxShadow: "0 0 0 1px rgba(34, 211, 238, 0.24), inset 0 0 18px rgba(34, 211, 238, 0.08)",
          }}
        />
      ))}
    </Grid>
  );
}