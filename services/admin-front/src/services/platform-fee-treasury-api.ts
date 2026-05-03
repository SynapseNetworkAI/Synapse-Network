import { request } from "./admin-api";

export type SafeTransactionDraft = {
  to: string;
  value: string;
  data: string;
  operation: number;
};

export type PlatformFeeSafeDraft = {
  status: string;
  requestId: string;
  amountUsdc: string;
  amountAtomic: string;
  safeAddress: string;
  ledgerSignerAddress: string;
  synapseCoreAddress: string;
  selector: string;
  calldataHash: string;
  platformFeePoolAtomic: string;
  safeTx: SafeTransactionDraft;
};

export async function createPlatformFeeSafeDraft(input: {
  amountUsdc: string;
  reason: string;
  requestId?: string;
  otpCode?: string;
}): Promise<PlatformFeeSafeDraft> {
  return request<PlatformFeeSafeDraft>(
    "/api/admin/v1/platform-fee-withdrawals/safe-draft",
    {
      method: "POST",
      headers: input.otpCode
        ? { "X-Admin-OTP-Code": input.otpCode }
        : undefined,
      body: JSON.stringify({
        amountUsdc: input.amountUsdc,
        reason: input.reason,
        requestId: input.requestId,
      }),
    }
  );
}
