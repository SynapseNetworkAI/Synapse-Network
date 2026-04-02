"use client";

import { Box, Flex, Input, Kbd, Text } from "@chakra-ui/react";
import type { MutableRefObject } from "react";

type NavSearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  inputRef: MutableRefObject<HTMLInputElement | null>;
};

export function NavSearchBar({ value, onChange, inputRef }: Readonly<NavSearchBarProps>) {
  return (
    <Box borderRadius="20px" bg="rgba(255,255,255,0.04)" border="1px solid rgba(255,255,255,0.06)" p="12px">
      <Flex justify="space-between" align="center" gap="10px" mb="8px">
        <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="rgba(244,247,251,0.48)">Navigation Query</Text>
        <Kbd bg="rgba(255,255,255,0.08)" color="rgba(244,247,251,0.72)" borderColor="rgba(255,255,255,0.08)">/</Kbd>
      </Flex>
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search modules, states, reviewers"
        bg="rgba(15,17,21,0.52)"
        color="#f4f7fb"
        borderRadius="14px"
        borderColor="rgba(255,255,255,0.08)"
        _placeholder={{ color: "rgba(244,247,251,0.32)" }}
        _focusVisible={{ borderColor: "rgba(76, 214, 251, 0.56)", boxShadow: "0 0 0 3px rgba(76, 214, 251, 0.12)" }}
      />
    </Box>
  );
}