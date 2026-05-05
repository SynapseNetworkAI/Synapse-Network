// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  depositLogsMock,
  withdrawLogsMock,
  depositIntentsMock,
  refundsMock,
  withdrawalsMock,
  coreAddress,
  usdcAddress,
} = vi.hoisted(() => ({
  depositLogsMock: vi.fn(),
  withdrawLogsMock: vi.fn(),
  depositIntentsMock: vi.fn(),
  refundsMock: vi.fn(),
  withdrawalsMock: vi.fn(),
  coreAddress: "0x00000000000000000000000000000000000000aa",
  usdcAddress: "0x00000000000000000000000000000000000000bb",
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x123400000000000000000000000000000000abcd",
  }),
}));

vi.mock("@/contract-config.json", () => ({
  default: {
    SynapseCore: coreAddress,
    MockUSDC: usdcAddress,
  },
}));

vi.mock("@/SynapseCoreABI.json", () => ({ default: [] }));
vi.mock("@/MockUSDCABI.json", () => ({ default: [] }));

vi.mock("@/utils/refundApi", () => ({
  fetchRefunds: refundsMock,
}));

vi.mock("@/utils/balanceApi", () => ({
  listConsumerWithdrawals: withdrawalsMock,
  listDepositIntents: depositIntentsMock,
}));

vi.mock("ethers", () => {
  function formatUnits(value: bigint, decimals: number): string {
    const scale = 10n ** BigInt(decimals);
    const whole = value / scale;
    const fraction = String(value % scale).padStart(decimals, "0");
    return `${whole}.${fraction}`;
  }

  class MockProvider {
    async getBlock() {
      return { timestamp: 1_775_000_000 };
    }
  }

  class MockContract {
    readonly address: string;
    readonly filters = {
      DepositInfo: () => "deposit",
      WithdrawInfo: () => "withdraw",
    };

    constructor(address: string) {
      this.address = address;
    }

    async balanceOf() {
      return 0n;
    }

    async queryFilter(filter: string) {
      if (filter === "deposit") {
        return depositLogsMock();
      }
      return withdrawLogsMock();
    }
  }

  return {
    ethers: {
      JsonRpcProvider: MockProvider,
      Contract: MockContract,
      formatUnits,
      toBigInt: BigInt,
    },
  };
});

import { useFundsData } from "@/hooks/useFundsData";

const TX_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function depositLog(amountAtomic: bigint = 100n * 10n ** 18n) {
  return {
    blockNumber: 123,
    transactionHash: TX_HASH,
    logIndex: 0,
    args: ["0x123400000000000000000000000000000000abcd", amountAtomic],
  };
}

describe("useFundsData deposit status mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    depositLogsMock.mockReturnValue([depositLog()]);
    withdrawLogsMock.mockReturnValue([]);
    refundsMock.mockResolvedValue([]);
    withdrawalsMock.mockResolvedValue([]);
    depositIntentsMock.mockResolvedValue([]);
  });

  it("keeps an on-chain deposit pending when Gateway has no intent yet", async () => {
    const { result } = renderHook(() => useFundsData());

    await waitFor(() => {
      expect(result.current.records).toHaveLength(1);
    });

    expect(result.current.records[0]).toMatchObject({
      type: "Deposit",
      txHash: TX_HASH,
      status: "PENDING",
      amount: 100,
    });
  });

  it("renders gateway-only pending deposit amount from intent payload", async () => {
    depositLogsMock.mockReturnValue([]);
    depositIntentsMock.mockResolvedValue([
      {
        id: "deposit-gateway-only",
        txHash: TX_HASH,
        amount_usdc: "100.000000",
        status: "PENDING_CONFIRMATION",
        updatedAt: "2026-05-04T04:14:20Z",
      },
    ]);

    const { result } = renderHook(() => useFundsData());

    await waitFor(() => {
      expect(result.current.records[0]?.id).toBe("deposit-gateway-only");
    });

    expect(result.current.records[0]).toMatchObject({
      type: "Deposit",
      status: "PENDING",
      amount: 100,
    });
  });

  it("keeps an on-chain deposit pending while Gateway status is PENDING_CONFIRMATION", async () => {
    depositIntentsMock.mockResolvedValue([
      {
        id: "deposit-1",
        txHash: TX_HASH,
        amountUsdc: "100.000000",
        status: "PENDING_CONFIRMATION",
        updatedAt: "2026-05-04T04:14:20Z",
      },
    ]);

    const { result } = renderHook(() => useFundsData());

    await waitFor(() => {
      expect(result.current.records[0]?.id).toBe("deposit-1");
    });

    expect(result.current.records[0]).toMatchObject({
      type: "Deposit",
      status: "PENDING",
      amount: 100,
    });
  });

  it("marks an on-chain deposit completed only after Gateway confirms the intent", async () => {
    depositIntentsMock.mockResolvedValue([
      {
        id: "deposit-2",
        txHash: TX_HASH,
        amountUsdc: "100.000000",
        status: "CONFIRMED",
        updatedAt: "2026-05-04T04:20:00Z",
      },
    ]);

    const { result } = renderHook(() => useFundsData());

    await waitFor(() => {
      expect(result.current.records[0]?.id).toBe("deposit-2");
    });

    expect(result.current.records[0]).toMatchObject({
      type: "Deposit",
      status: "COMPLETED",
      amount: 100,
    });
  });
});
