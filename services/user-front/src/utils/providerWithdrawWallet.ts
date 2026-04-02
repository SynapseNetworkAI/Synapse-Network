import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Abi, type Hex } from "viem";

const ERC20_ERROR_ABI = [
  {
    type: "error",
    name: "ERC20InsufficientBalance",
    inputs: [
      { name: "sender", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientAllowance",
    inputs: [
      { name: "spender", type: "address" },
      { name: "allowance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
] as const satisfies Abi;

export function toSafeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

export type WithdrawWalletErrorMessages = {
  fallback: string;
  walletRejected: string;
  insufficientNativeGas: string;
  ticketExpired: string;
  staleTicket: string;
  invalidSignature: string;
  vaultLiquidityInsufficient: string;
  vaultAllowanceUnavailable: string;
  contractRejectedWithName: (name: string) => string;
  contractRejectedWithReason: (reason: string) => string;
};

const DEFAULT_WITHDRAW_WALLET_ERROR_MESSAGES: WithdrawWalletErrorMessages = {
  fallback: "Failed to submit withdrawal transaction.",
  walletRejected: "Withdrawal was cancelled in wallet. No gas fee was spent and no funds were moved.",
  insufficientNativeGas: "Withdrawal could not be submitted because the wallet does not have enough native token to pay gas.",
  ticketExpired: "This withdrawal ticket has expired. Generate a new ticket before retrying.",
  staleTicket: "This withdrawal ticket is stale. Refresh it from the gateway before retrying.",
  invalidSignature: "This withdrawal ticket signature is no longer valid. Generate a new ticket before retrying.",
  vaultLiquidityInsufficient: "Vault liquidity is insufficient for this withdrawal right now. The platform treasury must refill on-chain USDC before you retry.",
  vaultAllowanceUnavailable: "Vault allowance is not ready for this withdrawal yet. Retry after the platform refreshes the vault configuration.",
  contractRejectedWithName: (name: string) => `Withdrawal was rejected by the vault contract (${name}).`,
  contractRejectedWithReason: (reason: string) => `Withdrawal was rejected by the vault contract: ${reason}.`,
};

function extractCustomErrorData(parts: string[]): Hex | undefined {
  for (const part of parts) {
    const selectorAndPayload = /custom error\s*(0x[a-f0-9]{8})\s*:\s*([a-f0-9]+)/i.exec(part);
    if (selectorAndPayload) {
      return `${selectorAndPayload[1]}${selectorAndPayload[2]}` as Hex;
    }

    const hexMatches = part.match(/0x[a-f0-9]{10,}/gi) ?? [];
    const longest = hexMatches.sort((left, right) => right.length - left.length)[0];
    if (longest) {
      return longest as Hex;
    }
  }

  return undefined;
}

function decodeKnownWithdrawCustomError(error: unknown): { errorName: string } | null {
  const baseError = error instanceof BaseError ? error : undefined;
  const rawMessage = toSafeErrorMessage(error, "");
  const messageParts = [baseError?.shortMessage, baseError?.details, rawMessage].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  const revertData = extractCustomErrorData(messageParts);
  if (!revertData) {
    return null;
  }

  try {
    const decoded = decodeErrorResult({ abi: ERC20_ERROR_ABI, data: revertData });
    return { errorName: decoded.errorName };
  } catch {
    if (revertData.toLowerCase().startsWith("0xe450d38c")) {
      return { errorName: "ERC20InsufficientBalance" };
    }
    return null;
  }
}

export function normalizeWithdrawWalletError(
  error: unknown,
  messages?: Partial<WithdrawWalletErrorMessages>,
): string {
  const resolved = {
    ...DEFAULT_WITHDRAW_WALLET_ERROR_MESSAGES,
    ...messages,
  } satisfies WithdrawWalletErrorMessages;
  const baseError = error instanceof BaseError ? error : undefined;
  const revertError = baseError?.walk(
    (walked) => walked instanceof ContractFunctionRevertedError,
  ) as ContractFunctionRevertedError | undefined;
  const rawMessage = toSafeErrorMessage(error, resolved.fallback);
  const messageParts = [
    revertError?.reason,
    revertError?.data?.errorName,
    baseError?.shortMessage,
    baseError?.details,
    rawMessage,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  const normalizedMessage = messageParts.join(" | ").toLowerCase();

  if (
    normalizedMessage.includes("user rejected")
    || normalizedMessage.includes("user denied")
    || normalizedMessage.includes("rejected the request")
    || normalizedMessage.includes("denied transaction signature")
    || normalizedMessage.includes("4001")
  ) {
    return resolved.walletRejected;
  }
  if (
    normalizedMessage.includes("insufficient funds")
    || normalizedMessage.includes("intrinsic gas too low")
    || normalizedMessage.includes("gas required exceeds allowance")
    || normalizedMessage.includes("exceeds the balance of the account")
    || normalizedMessage.includes("out of gas")
  ) {
    return resolved.insufficientNativeGas;
  }
  if (normalizedMessage.includes("ticket expired")) {
    return resolved.ticketExpired;
  }
  if (normalizedMessage.includes("invalid nonce")) {
    return resolved.staleTicket;
  }
  if (normalizedMessage.includes("invalid oracle signature")) {
    return resolved.invalidSignature;
  }

  const knownCustomError = decodeKnownWithdrawCustomError(error);
  if (knownCustomError?.errorName === "ERC20InsufficientBalance") {
    return resolved.vaultLiquidityInsufficient;
  }
  if (knownCustomError?.errorName === "ERC20InsufficientAllowance") {
    return resolved.vaultAllowanceUnavailable;
  }

  if (revertError?.data?.errorName) {
    return resolved.contractRejectedWithName(revertError.data.errorName);
  }
  if (revertError?.reason) {
    return resolved.contractRejectedWithReason(revertError.reason);
  }
  return rawMessage;
}