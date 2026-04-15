// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchRefundsMock, listConsumerWithdrawalsMock } = vi.hoisted(() => ({
  fetchRefundsMock: vi.fn(),
  listConsumerWithdrawalsMock: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0xabc",
  }),
}));

vi.mock("@/contract-config.json", () => ({
  default: {
    SynapseCore: "0x0000000000000000000000000000000000000001",
    MockUSDC: "0x0000000000000000000000000000000000000002",
  },
}));

vi.mock("@/SynapseCoreABI.json", () => ({
  default: [],
}));

vi.mock("@/MockUSDCABI.json", () => ({
  default: [],
}));

vi.mock("@/utils/refundApi", () => ({
  fetchRefunds: fetchRefundsMock,
}));

vi.mock("@/utils/balanceApi", () => ({
  listConsumerWithdrawals: listConsumerWithdrawalsMock,
}));

vi.mock("ethers", () => {
  class JsonRpcProvider {
    async getBlock() {
      return { timestamp: 1713139200 };
    }
  }

  class Contract {
    address: string;

    filters = {
      DepositInfo: () => ({ kind: "deposit" }),
      WithdrawInfo: () => ({ kind: "withdraw" }),
    };

    constructor(address: string) {
      this.address = address;
    }

    async balanceOf() {
      return 0n;
    }

    async queryFilter(filter: { kind: string }) {
      if (filter.kind === "withdraw") {
        return [
          {
            transactionHash: "0xonchainwithdraw",
            logIndex: 1,
            blockNumber: 99,
            args: [null, 5n * 10n ** 18n],
          },
        ];
      }
      return [];
    }
  }

  return {
    ethers: {
      JsonRpcProvider,
      Contract,
      toBigInt: (value: number) => BigInt(value),
      formatUnits: (value: bigint) => (Number(value) / 10 ** 18).toString(),
    },
  };
});

import { useFundsData } from "@/hooks/useFundsData";

describe("useFundsData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchRefundsMock.mockResolvedValue([]);
    listConsumerWithdrawalsMock.mockResolvedValue([
      {
        id: "wd-failed",
        amountUsdc: 20,
        status: "FAILED",
        txHash: "0xfailed",
        createdAt: "2026-04-14T10:00:00Z",
      },
      {
        id: "wd-cancelled",
        amountUsdc: 15,
        status: "CANCELLED",
        txHash: null,
        createdAt: "2026-04-14T11:00:00Z",
      },
    ]);
  });

  it("maps failed and cancelled consumer withdrawals to failed payment records", async () => {
    const { result } = renderHook(() => useFundsData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.records.length).toBeGreaterThan(0);
    });

    const failedRows = result.current.records.filter((row) =>
      row.id === "wd-failed" || row.id === "wd-cancelled"
    );
    expect(failedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "wd-failed",
          type: "Withdraw",
          status: "FAILED",
          txHash: "0xfailed",
        }),
        expect.objectContaining({
          id: "wd-cancelled",
          type: "Withdraw",
          status: "FAILED",
          txHash: null,
        }),
      ]),
    );
  });
});
