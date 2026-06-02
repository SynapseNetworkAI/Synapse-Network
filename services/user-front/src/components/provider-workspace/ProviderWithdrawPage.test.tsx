// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ReactNode } from "react";

configure({ reactStrictMode: false });

import ProviderWithdrawPage from "@/components/provider-workspace/ProviderWithdrawPage";
import { ProviderWithdrawApiError } from "@/utils/providerWithdrawApi";
import {
  TRANSLATIONS,
  ZH_TRANSLATIONS,
} from "./ProviderWithdrawPage.test.fixtures";

/* ── hoisted mocks ─────────────────────────────────────────── */

const {
  toastError,
  toastInfo,
  toastLoading,
  toastSuccess,
  createProviderWithdrawIntentMock,
  getProviderWithdrawCapabilityMock,
  listProviderWithdrawalsMock,
  completeProviderWithdrawalMock,
  reloadDashboardMock,
  readContractMock,
  writeContractAsyncMock,
  languageState,
  providerStatsState,
} = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastLoading: vi.fn(() => "toast-provider-withdraw"),
  toastSuccess: vi.fn(),
  createProviderWithdrawIntentMock: vi.fn(),
  getProviderWithdrawCapabilityMock: vi.fn(),
  listProviderWithdrawalsMock: vi.fn(),
  completeProviderWithdrawalMock: vi.fn(),
  reloadDashboardMock: vi.fn(),
  readContractMock: vi.fn(),
  writeContractAsyncMock: vi.fn(),
  languageState: { value: "en" },
  providerStatsState: {
    value: {
      totalApiCalls: 0,
      totalEarned: 50.0,
      totalFees: 5.0,
      totalRoutingTax: 1.0,
      netEarned: 44.0,
      receivable: 12.5,
      matureReceivable: 12.5,
      paidCount24h: 0,
      duplicateRowsDropped: 0,
    },
  },
}));

vi.mock("react-hot-toast", () => ({
  default: Object.assign(toastInfo, {
    error: toastError,
    loading: toastLoading,
    success: toastSuccess,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: ReactNode;
    href: string;
  }) => {
    return createElement("a", { href, ...rest }, children);
  },
}));

vi.mock("@/components/i18n/LanguageProvider", () => {
  const tFn = (key: string, vars?: Record<string, string | number>) => {
    const table = languageState.value === "zh" ? ZH_TRANSLATIONS : TRANSLATIONS;
    let text = table[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{{${k}}}`, String(v));
      }
    }
    return text;
  };
  return {
    useLanguage: () => ({
      lang: languageState.value,
      t: tFn,
    }),
  };
});

vi.mock("@/hooks/useDashboardData", () => ({
  useDashboardData: () => ({
    providerStats: providerStatsState.value,
    paidEvents: [],
    handleRefresh: reloadDashboardMock,
  }),
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({ openConnectModal: vi.fn() }),
}));

let walletBalance = 10n ** 18n;

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc", isConnected: true }),
  useBalance: () => ({
    data: { value: walletBalance, symbol: "ETH", decimals: 18 },
  }),
  useChainId: () => 31337,
  usePublicClient: () => ({
    readContract: readContractMock,
    getBalance: vi.fn().mockResolvedValue(10n ** 18n),
    estimateContractGas: vi.fn().mockResolvedValue(21000n),
    estimateFeesPerGas: vi
      .fn()
      .mockResolvedValue({ maxFeePerGas: 1000000000n, gasPrice: 1000000000n }),
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
  useWriteContract: () => ({
    data: undefined,
    writeContractAsync: writeContractAsyncMock,
    isPending: false,
  }),
}));

vi.mock("@/contract-config.json", () => ({
  default: {
    SynapseCore: "0x00000000000000000000000000000000000000aa",
    MockUSDC: "0x00000000000000000000000000000000000000bb",
  },
}));

vi.mock("@/SynapseCoreABI.json", () => ({
  default: [],
}));

vi.mock("@/utils/providerWithdrawApi", async () => {
  const actual = await vi.importActual<
    typeof import("@/utils/providerWithdrawApi")
  >("@/utils/providerWithdrawApi");
  return {
    ...actual,
    createProviderWithdrawIntent: createProviderWithdrawIntentMock,
    getProviderWithdrawCapability: getProviderWithdrawCapabilityMock,
    listProviderWithdrawals: listProviderWithdrawalsMock,
    completeProviderWithdrawal: completeProviderWithdrawalMock,
  };
});

/* ── test helpers ──────────────────────────────────────────── */

function buildWithdrawal(overrides: Record<string, unknown> = {}) {
  return {
    id: "wd-001",
    amountUsdc: 5.0,
    status: "COMPLETED",
    nonce: 1,
    deadline: Math.floor(Date.now() / 1000) + 600,
    createdAt: String(Math.floor(Date.now() / 1000) - 3600),
    ...overrides,
  };
}

function renderPage() {
  return render(<ProviderWithdrawPage />);
}

async function submitProviderWithdrawIntent(user = userEvent.setup()) {
  renderPage();
  await waitFor(() =>
    expect(getProviderWithdrawCapabilityMock).toHaveBeenCalled()
  );
  const btn = screen.getByRole("button", {
    name: languageState.value === "zh" ? /生成并提现/i : /Generate & Claim/i,
  }) as HTMLButtonElement;
  await waitFor(() => expect(btn.disabled).toBe(false));
  await user.click(btn);
  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: languageState.value === "zh" ? "确认提现" : /Confirm/i,
      })
    ).toBeTruthy()
  );
  await user.click(screen.getByRole("button", { name: /MAX/i }));
  await user.click(
    screen.getByRole("button", {
      name: languageState.value === "zh" ? "确认提现" : /Confirm/i,
    })
  );
}

/* ── tests ─────────────────────────────────────────────────── */

describe("ProviderWithdrawPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    languageState.value = "en";
    providerStatsState.value = {
      totalApiCalls: 0,
      totalEarned: 50.0,
      totalFees: 5.0,
      totalRoutingTax: 1.0,
      netEarned: 44.0,
      receivable: 12.5,
      matureReceivable: 12.5,
      paidCount24h: 0,
      duplicateRowsDropped: 0,
    };
    walletBalance = 10n ** 18n;
    readContractMock.mockResolvedValue(20n * 10n ** 18n);
    writeContractAsyncMock.mockResolvedValue("0xtx");
    getProviderWithdrawCapabilityMock.mockResolvedValue({
      ticketSigningEnabled: true,
      code: null,
      message: "ready",
      contractAddress: "0x00000000000000000000000000000000000000aa",
    });
    listProviderWithdrawalsMock.mockResolvedValue([]);
  });

  /* ── Balance card ────────────────────────────────────────── */

  it("displays withdrawable and total receivable in deposit-style card", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Withdrawable receivable")).toBeTruthy();
    });
    expect(screen.getByText("12.50 USDC")).toBeTruthy();
    expect(screen.getByText("Receivable balance: 12.50 USDC")).toBeTruthy();
    expect(screen.getByText("Minimum withdrawal: 10.00 USDC")).toBeTruthy();
    expect(screen.queryByText(/Blank = full withdrawal/i)).toBeNull();
    expect(screen.queryByText(/Max 2 decimals/i)).toBeNull();
  });

  it("renders Generate & Claim button", async () => {
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Generate & Claim/i })
      ).toBeTruthy();
    });
  });

  it("disables Generate & Claim when matured receivable is below minimum", async () => {
    providerStatsState.value = {
      ...providerStatsState.value,
      receivable: 50,
      matureReceivable: 5,
    };
    renderPage();
    const btn = (await screen.findByRole("button", {
      name: /Generate & Claim/i,
    })) as HTMLButtonElement;

    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe(
      "Matured withdrawable amount is below the 10.00 USDC minimum"
    );
    expect(screen.getByText("5.00 USDC")).toBeTruthy();
    expect(screen.getByText("Receivable balance: 50.00 USDC")).toBeTruthy();
    expect(
      screen.getByText(
        "Newly earned receivables appear in balance first, then enter withdrawable receivable after T+7."
      )
    ).toBeTruthy();
  });

  /* ── Gas fee note ────────────────────────────────────────── */

  it("shows gas fee note after opening amount input panel", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Generate & Claim/i })
      ).toBeTruthy();
    });
    const btn = screen.getByRole("button", {
      name: /Generate & Claim/i,
    }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    await user.click(btn);
    await waitFor(() => {
      expect(screen.getByText(/gas fee/i)).toBeTruthy();
    });
  });

  /* ── Gas insufficiency check ─────────────────────────────── */

  it("shows insufficient gas warning when balance is 0", async () => {
    walletBalance = 0n;
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Insufficient gas/i)).toBeTruthy();
    });
  });

  it("disables withdraw button when gas balance is 0", async () => {
    walletBalance = 0n;
    renderPage();
    await waitFor(() => {
      const btn = screen.getByRole("button", {
        name: /Generate & Claim/i,
      }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  /* ── Amount input ────────────────────────────────────────── */

  it("renders amount input with placeholder after opening panel", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Generate & Claim/i })
      ).toBeTruthy();
    });
    const btn = screen.getByRole("button", {
      name: /Generate & Claim/i,
    }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    await user.click(btn);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Amount/i)).toBeTruthy();
    });
    expect(
      (screen.getByRole("button", { name: /Confirm/i }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("renders MAX button that fills available balance", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Generate & Claim/i })
      ).toBeTruthy();
    });
    const btn = screen.getByRole("button", {
      name: /Generate & Claim/i,
    }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    await user.click(btn);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /MAX/i })).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: /MAX/i }));
    const input = screen.getByPlaceholderText(/Amount/i) as HTMLInputElement;
    expect(input.value).toBe("12.50");
    expect(
      (screen.getByRole("button", { name: /Confirm/i }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it("rejects custom withdrawal amounts below the platform minimum", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Generate & Claim/i })
      ).toBeTruthy();
    });
    const btn = screen.getByRole("button", {
      name: /Generate & Claim/i,
    }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    await user.click(btn);

    const input = screen.getByPlaceholderText(/Amount/i);
    await user.type(input, "9.99");

    expect(
      screen.getByText("Minimum withdrawal amount is 10.00 USDC.")
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Confirm/i }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  /* ── Resume Pending ──────────────────────────────────────── */

  it("shows Resume Pending only when there is an approved-auto ticket", async () => {
    listProviderWithdrawalsMock.mockResolvedValue([
      buildWithdrawal({
        id: "wd-pending",
        status: "APPROVED_AUTO",
        ticket: {
          amount: "5000000000000000000",
          fee: "500000000000000000",
          nonce: 1,
          deadline: Math.floor(Date.now() / 1000) + 600,
          signature: "0xdeadbeef",
          chainId: 31337,
          contractAddress: "0x00000000000000000000000000000000000000aa",
        },
      }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Resume Pending/i })
      ).toBeTruthy();
    });
  });

  it("hides Resume Pending when no pending ticket", async () => {
    listProviderWithdrawalsMock.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(getProviderWithdrawCapabilityMock).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("button", { name: /Resume Pending/i })
    ).toBeNull();
  });

  /* ── Withdrawal History section ──────────────────────────── */

  it("renders Withdrawal History title and status filter", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Withdrawal History")).toBeTruthy();
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.value).toBe("ALL");
    });
  });

  it("renders date range inputs and search button", async () => {
    renderPage();
    await waitFor(() => {
      const dateInputs = document.querySelectorAll('input[type="date"]');
      expect(dateInputs.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByRole("button", { name: /Search/i })).toBeTruthy();
    });
  });

  it("shows withdrawal history with data from API mock", async () => {
    const now = Math.floor(Date.now() / 1000);
    listProviderWithdrawalsMock.mockResolvedValue([
      buildWithdrawal({
        id: "wd-001",
        amountUsdc: 10.123456,
        status: "COMPLETED",
        createdAt: String(now - 100),
      }),
      buildWithdrawal({
        id: "wd-002",
        amountUsdc: 5.5,
        status: "REQUESTED",
        createdAt: String(now - 200),
      }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("wd-001")).toBeTruthy();
    });
    expect(screen.getByText("wd-002")).toBeTruthy();
    expect(screen.getByText("10.123456 USDC")).toBeTruthy();
    expect(screen.getByText("5.500000 USDC")).toBeTruthy();
  });

  it("shows empty state when no withdrawal history", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/No withdrawal records yet/i)).toBeTruthy();
    });
  });

  it("filters withdrawals by status dropdown", async () => {
    const user = userEvent.setup();
    listProviderWithdrawalsMock.mockResolvedValue([
      buildWithdrawal({ id: "wd-c", status: "COMPLETED" }),
      buildWithdrawal({ id: "wd-r", status: "REQUESTED" }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText("wd-c")).toBeTruthy());

    await user.selectOptions(screen.getByRole("combobox"), "COMPLETED");

    expect(screen.getByText("wd-c")).toBeTruthy();
    expect(screen.queryByText("wd-r")).toBeNull();
  });

  it("filters withdrawals by date range", async () => {
    const user = userEvent.setup();
    const now = Math.floor(Date.now() / 1000);
    listProviderWithdrawalsMock.mockResolvedValue([
      buildWithdrawal({ id: "wd-old", createdAt: String(now - 86400 * 60) }),
      buildWithdrawal({ id: "wd-recent", createdAt: String(now - 86400 * 2) }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText("wd-old")).toBeTruthy());

    const fromInput = document.querySelectorAll(
      'input[type="date"]'
    )[0] as HTMLInputElement;
    const sevenDaysAgo = new Date(Date.now() - 86400 * 7 * 1000)
      .toISOString()
      .slice(0, 10);
    await user.clear(fromInput);
    await user.type(fromInput, sevenDaysAgo);

    await waitFor(() => {
      expect(screen.getByText("wd-recent")).toBeTruthy();
      expect(screen.queryByText("wd-old")).toBeNull();
    });
  });

  /* ── Link + columns ──────────────────────────────────────── */

  it("renders link to invocation records page", async () => {
    renderPage();
    await waitFor(() => {
      const link = screen.getByText(/View Invocation Records/i);
      expect(link.closest("a")?.getAttribute("href")).toBe(
        "/provider/withdraw/history"
      );
    });
  });

  it("renders all history table columns", async () => {
    listProviderWithdrawalsMock.mockResolvedValue([buildWithdrawal()]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Withdrawal ID")).toBeTruthy());
    expect(screen.getByText("Amount")).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Reason")).toBeTruthy();
  });

  /* ── Vault liquidity error ───────────────────────────────── */

  const providerWithdrawErrorCases = [
    {
      code: "CHAIN_RPC_UNAVAILABLE",
      message:
        "The withdrawal network is temporarily unavailable. Please retry in a moment.",
    },
    {
      code: "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE",
      message: "Vault liquidity check unavailable",
    },
    {
      code: "PROVIDER_RECEIVABLE_NOT_MATURED",
      message:
        "Provider earnings are still in the T+7 maturity window. Only matured receivables can be withdrawn; newly earned receivables still appear in balance.",
    },
    {
      code: "MIN_WITHDRAWAL_AMOUNT_NOT_MET",
      message: "Minimum provider withdrawal amount is 10.00 USDC.",
    },
    {
      code: "INSUFFICIENT_PROVIDER_RECEIVABLE",
      message: "Withdrawable provider receivable is insufficient.",
    },
    {
      code: "PENDING_WITHDRAWAL_EXISTS",
      message: "A provider withdrawal is already pending.",
    },
  ];

  it.each(providerWithdrawErrorCases)(
    "localizes provider withdrawal $code errors by code",
    async ({ code, message }) => {
      createProviderWithdrawIntentMock.mockRejectedValue(
        new ProviderWithdrawApiError(
          "503: {'code': 'CHAIN_RPC_UNAVAILABLE', 'message': 'HTTPException'}",
          code,
          503
        )
      );

      await submitProviderWithdrawIntent();

      await waitFor(() => {
        expect(toastError).toHaveBeenCalledWith(message, {
          id: "toast-provider-withdraw",
        });
      });
      expect(toastError).not.toHaveBeenCalledWith(
        expect.stringContaining("503:"),
        expect.anything()
      );
      expect(toastError).not.toHaveBeenCalledWith(
        expect.stringContaining("HTTPException"),
        expect.anything()
      );
    }
  );

  it("localizes provider receivable maturity errors by code", async () => {
    const user = userEvent.setup();
    createProviderWithdrawIntentMock.mockRejectedValue(
      new ProviderWithdrawApiError(
        "Requested 12.600000 USDC exceeds mature provider receivable of 0.000000 USDC. Provider earnings must mature for 7 days before withdrawal.",
        "PROVIDER_RECEIVABLE_NOT_MATURED",
        400
      )
    );
    await submitProviderWithdrawIntent(user);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "Provider earnings are still in the T+7 maturity window. Only matured receivables can be withdrawn; newly earned receivables still appear in balance.",
        { id: "toast-provider-withdraw" }
      );
    });
  });

  it("renders Chinese page copy and localizes provider withdrawal errors by code", async () => {
    languageState.value = "zh";
    const user = userEvent.setup();
    createProviderWithdrawIntentMock.mockRejectedValue(
      new ProviderWithdrawApiError(
        "Requested 12.600000 USDC exceeds mature provider receivable of 0.000000 USDC. Provider earnings must mature for 7 days before withdrawal.",
        "PROVIDER_RECEIVABLE_NOT_MATURED",
        400
      )
    );

    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Provider 提现" })
      ).toBeTruthy();
    });
    expect(screen.getByText("可提现额度")).toBeTruthy();
    expect(screen.getByText("提现历史")).toBeTruthy();
    const btn = screen.getByRole("button", {
      name: /生成并提现/i,
    }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    await user.click(btn);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "确认提现" })).toBeTruthy()
    );
    await user.click(screen.getByRole("button", { name: /MAX/i }));
    await user.click(screen.getByRole("button", { name: "确认提现" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "当前收益尚未达到 T+7 成熟期。只有已成熟应收可以提现；新产生的应收仍会显示在余额中。",
        { id: "toast-provider-withdraw" }
      );
    });
  });

  it("blocks on-chain claim when a new ticket is inside the critical expiry window", async () => {
    const user = userEvent.setup();
    createProviderWithdrawIntentMock.mockResolvedValue({
      withdrawalId: "wd-soon",
      status: "APPROVED_AUTO",
      amountUsdc: "5.000000",
      ticket: {
        ticketId: "0xabc",
        ticketHash: "0xdef",
        amount: "5000000000000000000",
        fee: "0",
        deadline: Math.floor(Date.now() / 1000) + 60,
        signature: "0xdeadbeef",
        chainId: 31337,
        contractAddress: "0x00000000000000000000000000000000000000aa",
      },
    });
    renderPage();
    await waitFor(() =>
      expect(getProviderWithdrawCapabilityMock).toHaveBeenCalled()
    );
    const btn = screen.getByRole("button", {
      name: /Generate & Claim/i,
    }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    await user.click(btn);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Confirm/i })).toBeTruthy()
    );
    await user.click(screen.getByRole("button", { name: /MAX/i }));
    await user.click(screen.getByRole("button", { name: /Confirm/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "This withdrawal approval expires soon. Wait a moment, then create a new withdrawal request to avoid a failed transaction.",
        { id: "toast-provider-withdraw" }
      );
    });
  });

  it("treats wallet rejection as localized cancellation copy", async () => {
    const user = userEvent.setup();
    writeContractAsyncMock.mockRejectedValue(
      Object.assign(new Error("User denied message signature"), {
        code: 4001,
      })
    );
    createProviderWithdrawIntentMock.mockResolvedValue({
      withdrawalId: "wd-wallet-rejected",
      status: "APPROVED_AUTO",
      amountUsdc: "12.500000",
      ticket: {
        ticketId: "0xabc",
        ticketHash: "0xdef",
        amount: "12500000000000000000",
        fee: "0",
        deadline: Math.floor(Date.now() / 1000) + 600,
        signature: "0xdeadbeef",
        chainId: 31337,
        contractAddress: "0x00000000000000000000000000000000000000aa",
      },
    });

    await submitProviderWithdrawIntent(user);

    await waitFor(() => {
      expect(toastInfo).toHaveBeenCalledWith("Wallet rejected", {
        id: "toast-provider-withdraw",
        icon: "ℹ️",
      });
    });
    expect(toastError).not.toHaveBeenCalledWith(
      expect.stringContaining("User denied message signature"),
      expect.anything()
    );
  });
});
