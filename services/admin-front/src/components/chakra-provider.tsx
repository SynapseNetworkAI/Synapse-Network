"use client";

import { ChakraProvider } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { system } from "@/lib/theme";

export function AppChakraProvider({ children }: Readonly<{ children: ReactNode }>) {
  return <ChakraProvider value={system}>{children}</ChakraProvider>;
}