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

describe("useFundsData deposit status mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    depositLogsMock.mockReturnValue([]);
    withdrawLogsMock.mockReturnValue([]);
    refundsMock.mockResolvedValue([]);
    withdrawalsMock.mockResolvedValue([]);
    depositIntentsMock.mockResolvedValue([]);
  });

  it("keeps a Gateway deposit intent pending without reading chain logs", async () => {
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
      expect(result.current.records).toHaveLength(1);
    });

    expect(result.current.records[0]).toMatchObject({
      id: "deposit-1",
      type: "Deposit",
      txHash: TX_HASH,
      status: "PENDING",
      amount: 100,
    });
    expect(depositLogsMock).not.toHaveBeenCalled();
    expect(withdrawLogsMock).not.toHaveBeenCalled();
    expect(depositIntentsMock).toHaveBeenCalledWith(
      "0x123400000000000000000000000000000000abcd",
      100
    );
    expect(withdrawalsMock).toHaveBeenCalledWith(
      "0x123400000000000000000000000000000000abcd",
      100
    );
    expect(refundsMock).toHaveBeenCalledWith(
      "0x123400000000000000000000000000000000abcd",
      100
    );
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

  it("keeps a Gateway deposit row pending while status is PENDING_CONFIRMATION", async () => {
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

  it("marks a deposit completed only after Gateway confirms the intent", async () => {
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

  it("keeps consumer withdrawal claimability from Gateway truth", async () => {
    withdrawalsMock.mockResolvedValue([
      {
        id: "withdraw-ready-1",
        amountUsdc: "185.990000",
        status: "REQUESTED",
        claimable: true,
        ticket: {
          ticketId:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          amount: "185990000000000000000",
          fee: "1000000000000000000",
          deadline: 1_800_000_000,
          signature: "0xsigned",
          chainId: 31337,
          contractAddress: "0x00000000000000000000000000000000000000aa",
        },
        updatedAt: "2026-05-06T09:14:20Z",
      },
    ]);

    const { result } = renderHook(() => useFundsData());

    await waitFor(() => {
      expect(result.current.records[0]?.id).toBe("withdraw-ready-1");
    });

    expect(result.current.records[0]).toMatchObject({
      type: "Withdraw",
      status: "PENDING",
      withdrawalStatus: "REQUESTED",
      claimable: true,
      amount: 185.99,
    });
  });

  it("shows the requested deposit amount when credited amount is missing or zero", async () => {
    depositIntentsMock.mockResolvedValue([
      {
        id: "deposit-zero-credited",
        txHash: TX_HASH,
        amountUsdc: "250.000000",
        creditedAmountUsdc: "0",
        status: "CONFIRMED",
        updatedAt: "2026-05-06T07:04:20Z",
      },
    ]);

    const { result } = renderHook(() => useFundsData());

    await waitFor(() => {
      expect(result.current.records[0]?.id).toBe("deposit-zero-credited");
    });

    expect(result.current.records[0]).toMatchObject({
      type: "Deposit",
      status: "COMPLETED",
      amount: 250,
    });
  });

  it("falls back to credited amount only when the requested deposit amount is absent", async () => {
    depositIntentsMock.mockResolvedValue([
      {
        id: "deposit-credited-only",
        txHash: TX_HASH,
        amountUsdc: "0",
        creditedAmountUsdc: "75.000000",
        status: "CONFIRMED",
        updatedAt: "2026-05-06T07:05:20Z",
      },
    ]);

    const { result } = renderHook(() => useFundsData());

    await waitFor(() => {
      expect(result.current.records[0]?.id).toBe("deposit-credited-only");
    });

    expect(result.current.records[0]).toMatchObject({
      type: "Deposit",
      status: "COMPLETED",
      amount: 75,
    });
  });

  it("combines Gateway deposits, withdrawals, and refunds by timestamp descending", async () => {
    depositIntentsMock.mockResolvedValue([
      {
        id: "deposit-old",
        txHash: TX_HASH,
        amountUsdc: "100.000000",
        status: "CONFIRMED",
        updatedAt: "2026-05-01T00:00:00Z",
      },
    ]);
    refundsMock.mockResolvedValue([
      {
        id: "refund-middle",
        amountUsdc: "5.000000",
        txHash: "0xrefund",
        timestamp: Math.floor(
          new Date("2026-05-02T00:00:00Z").getTime() / 1000
        ),
        type: "refund",
        status: "COMPLETED",
      },
    ]);
    withdrawalsMock.mockResolvedValue([
      {
        id: "withdraw-new",
        amountUsdc: "10.000000",
        status: "COMPLETED",
        txHash: "0xwithdraw",
        updatedAt: "2026-05-03T00:00:00Z",
      },
    ]);

    const { result } = renderHook(() => useFundsData());

    await waitFor(() => {
      expect(result.current.records).toHaveLength(3);
    });

    expect(result.current.records.map((row) => row.id)).toEqual([
      "withdraw-new",
      "refund-middle",
      "deposit-old",
    ]);
  });

  it("flags possible payment history truncation when a source reaches the fetch limit", async () => {
    depositIntentsMock.mockResolvedValue(
      Array.from({ length: 100 }, (_, index) => ({
        id: `deposit-${index}`,
        txHash: `0x${String(index).padStart(64, "0")}`,
        amountUsdc: "1.000000",
        status: "CONFIRMED",
        updatedAt: `2026-05-01T00:${String(index % 60).padStart(2, "0")}:00Z`,
      }))
    );

    const { result } = renderHook(() => useFundsData());

    await waitFor(() => {
      expect(result.current.records).toHaveLength(100);
    });

    expect(result.current.paymentHistoryMayBeTruncated).toBe(true);
  });
});
