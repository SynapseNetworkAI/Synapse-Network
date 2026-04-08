// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

configure({ reactStrictMode: false });

import ProviderWithdrawPage from "@/components/provider-workspace/ProviderWithdrawPage";
import { ProviderWithdrawApiError } from "@/utils/providerWithdrawApi";

/* ── hoisted mocks ─────────────────────────────────────────── */

const {
  toastError,
  toastLoading,
  toastSuccess,
  createProviderWithdrawIntentMock,
  getProviderWithdrawCapabilityMock,
  listProviderWithdrawalsMock,
  completeProviderWithdrawalMock,
  reloadDashboardMock,
  readContractMock,
} = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastLoading: vi.fn(() => "toast-provider-withdraw"),
  toastSuccess: vi.fn(),
  createProviderWithdrawIntentMock: vi.fn(),
  getProviderWithdrawCapabilityMock: vi.fn(),
  listProviderWithdrawalsMock: vi.fn(),
  completeProviderWithdrawalMock: vi.fn(),
  reloadDashboardMock: vi.fn(),
  readContractMock: vi.fn(),
}));

const TRANSLATIONS: Record<string, string> = {
  "providerSettlements.withdrawPageTitle": "Provider Withdraw",
  "providerSettlements.withdrawPageDescription": "EIP-712 on-chain self-service withdrawal.",
  "providerSettlements.metricAvailable": "Available",
  "providerSettlements.generateAndClaim": "Generate & Claim",
  "providerSettlements.signerUnavailable": "Signer Unavailable",
  "providerSettlements.creatingTicket": "Creating Ticket...",
  "providerSettlements.resumePending": "Resume Pending",
  "providerSettlements.withdrawGasNote": "Withdrawal is an on-chain transaction. You will need to pay a small gas fee.",
  "providerSettlements.insufficientGasWarning": "Insufficient gas balance. Please top up native token.",
  "providerSettlements.historyTitle": "Withdrawal History",
  "providerSettlements.historyFilterAll": "All",
  "providerSettlements.historyStatusRequested": "Requested",
  "providerSettlements.historyStatusApprovedAuto": "Ticket Ready",
  "providerSettlements.historyStatusPendingManualReview": "Manual Review",
  "providerSettlements.historyStatusCompleted": "Completed",
  "providerSettlements.historyStatusRejected": "Rejected",
  "providerSettlements.historyStatusCancelled": "Cancelled / Released",
  "providerSettlements.historyTableWithdrawalId": "Withdrawal ID",
  "providerSettlements.historyTableAmount": "Amount",
  "providerSettlements.historyTableStatus": "Status",
  "providerSettlements.historyTableReason": "Reason",
  "providerSettlements.historyTableNonce": "Nonce",
  "providerSettlements.historyTableCreated": "Created",
  "providerSettlements.historyTableTxHash": "Tx Hash",
  "providerSettlements.historyEmpty": "No withdrawal records yet.",
  "providerSettlements.historyFilteredEmpty": "No records match the current filter.",
  "providerSettlements.searchButton": "Search",
  "providerSettlements.loadingHistory": "Loading...",
  "providerSettlements.viewInvocationRecords": "View Invocation Records",
  "providerSettlements.loadHistoryFailed": "Failed to load withdrawal history",
  "providerSettlements.vaultAddressMissing": "Vault address missing",
  "providerSettlements.ticketSigningUnavailable": "Signer unavailable",
  "providerSettlements.vaultLiquidityCheckUnavailable": "Vault liquidity check unavailable",
  "providerSettlements.chainRpcUnavailable": "Chain RPC unavailable",
  "providerSettlements.withdrawalCreateFailed": "Failed to create withdrawal",
  "providerSettlements.noPendingTicket": "No pending ticket",
  "providerSettlements.chainRequiredNetwork": "required network",
  "providerSettlements.vaultLiquidityInsufficient": "Vault liquidity insufficient",
  "providerSettlements.walletClientUnavailable": "Wallet client unavailable",
  "providerSettlements.connectWalletFirst": "Connect wallet first",
  "providerSettlements.withdrawalContractMissing": "Contract missing",
  "providerSettlements.walletRejected": "Wallet rejected",
  "providerSettlements.insufficientNativeGas": "Insufficient native gas",
  "providerSettlements.ticketExpired": "Ticket expired",
  "providerSettlements.staleTicket": "Stale ticket",
  "providerSettlements.invalidSignature": "Invalid signature",
  "providerSettlements.pendingReviewExists": "A withdrawal is already pending review.",
  "providerSettlements.generatingTicket": "Generating ticket...",
  "providerSettlements.settledCompleted": "Withdrawal settled",
  "providerSettlements.backendCompletionFailed": "Backend completion failed",
  "providerSettlements.pendingTicketExpiredBanner": "Pending ticket expired.",
  "providerSettlements.pendingTicketExpiredReleased": "Expired ticket released.",
  "providerSettlements.expiredTicketReleasedRow": "Expired ticket released.",
  "providerSettlements.nativeTokenFallback": "native token",
  "providerSettlements.txSubmitted": "Tx submitted",
  "providerSettlements.ticketGenerated": "Ticket generated",
  "providerSettlements.manualReviewQueued": "Queued for review",
  "providerSettlements.withdrawalIntentCreated": "Intent created",
  "providerSettlements.invalidAmountPrecision": "Invalid precision",
  "providerSettlements.invalidAmountValue": "Invalid amount",
};

vi.mock("react-hot-toast", () => ({
  default: {
    error: toastError,
    loading: toastLoading,
    success: toastSuccess,
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => {
    const { createElement } = require("react");
    return createElement("a", { href, ...rest }, children);
  },
}));

vi.mock("@/components/i18n/LanguageProvider", () => {
  const tFn = (key: string, vars?: Record<string, string | number>) => {
    let text = TRANSLATIONS[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{{${k}}}`, String(v));
      }
    }
    return text;
  };
  return {
    useLanguage: () => ({
      lang: "en",
      t: tFn,
    }),
  };
});

vi.mock("@/hooks/useDashboardData", () => ({
  useDashboardData: () => ({
    providerStats: {
      totalApiCalls: 0,
      totalEarned: 50.0,
      totalFees: 5.0,
      totalRoutingTax: 1.0,
      netEarned: 44.0,
      receivable: 12.5,
      paidCount24h: 0,
      duplicateRowsDropped: 0,
    },
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
    estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 1000000000n, gasPrice: 1000000000n }),
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
  useWriteContract: () => ({
    data: undefined,
    writeContractAsync: vi.fn(),
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
  const actual = await vi.importActual<typeof import("@/utils/providerWithdrawApi")>(
    "@/utils/providerWithdrawApi",
  );
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

/* ── tests ─────────────────────────────────────────────────── */

describe("ProviderWithdrawPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    walletBalance = 10n ** 18n;
    readContractMock.mockResolvedValue(20n * 10n ** 18n);
    getProviderWithdrawCapabilityMock.mockResolvedValue({
      ticketSigningEnabled: true,
      code: null,
      message: "ready",
      contractAddress: "0x00000000000000000000000000000000000000aa",
    });
    listProviderWithdrawalsMock.mockResolvedValue([]);
  });

  /* ── Balance card ────────────────────────────────────────── */

  it("displays available balance in deposit-style card", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Available")).toBeTruthy();
    });
    expect(screen.getByText(/12\.500000/)).toBeTruthy();
  });

  it("renders Generate & Claim button", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Generate & Claim/i })).toBeTruthy();
    });
  });

  /* ── Gas fee note ────────────────────────────────────────── */

  it("shows gas fee note explaining on-chain cost", async () => {
    renderPage();
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
      const btn = screen.getByRole("button", { name: /Generate & Claim/i }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  /* ── Amount input ────────────────────────────────────────── */

  it("renders amount input with placeholder showing available balance", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByPlaceholderText("12.500000 USDC")).toBeTruthy();
    });
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
      expect(screen.getByRole("button", { name: /Resume Pending/i })).toBeTruthy();
    });
  });

  it("hides Resume Pending when no pending ticket", async () => {
    listProviderWithdrawalsMock.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(getProviderWithdrawCapabilityMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: /Resume Pending/i })).toBeNull();
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
      buildWithdrawal({ id: "wd-001", amountUsdc: 10.123456, status: "COMPLETED", createdAt: String(now - 100) }),
      buildWithdrawal({ id: "wd-002", amountUsdc: 5.5, status: "REQUESTED", createdAt: String(now - 200) }),
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

    const fromInput = document.querySelectorAll('input[type="date"]')[0] as HTMLInputElement;
    const sevenDaysAgo = new Date(Date.now() - 86400 * 7 * 1000).toISOString().slice(0, 10);
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
      expect(link.closest("a")?.getAttribute("href")).toBe("/provider/withdraw/history");
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

  it("shows error toast when withdraw intent fails", async () => {
    const user = userEvent.setup();
    createProviderWithdrawIntentMock.mockRejectedValue(
      new ProviderWithdrawApiError("vault liquidity", "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE", 503),
    );
    renderPage();
    await waitFor(() => expect(getProviderWithdrawCapabilityMock).toHaveBeenCalled());
    const btn = screen.getByRole("button", { name: /Generate & Claim/i }) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    await user.click(btn);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
