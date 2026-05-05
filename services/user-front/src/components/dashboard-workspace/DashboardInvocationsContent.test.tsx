// @vitest-environment jsdom

import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DashboardInvocationsContent from "@/components/dashboard-workspace/DashboardInvocationsContent";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";

const {
  listPaginatedUsageLogsMock,
  openConnectModalMock,
  clipboardWriteTextMock,
} = vi.hoisted(() => ({
  listPaginatedUsageLogsMock: vi.fn(),
  openConnectModalMock: vi.fn(),
  clipboardWriteTextMock: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8",
    isConnected: true,
  }),
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({
    openConnectModal: openConnectModalMock,
  }),
}));

vi.mock("@/components/WalletAuthGuard", () => ({
  useAuth: () => ({
    isSessionAuthenticated: true,
  }),
}));

vi.mock("@/utils/usageApi", async () => {
  const actual = await vi.importActual<typeof import("@/utils/usageApi")>(
    "@/utils/usageApi"
  );
  return {
    ...actual,
    listPaginatedUsageLogs: listPaginatedUsageLogsMock,
  };
});

vi.mock("@/utils/balanceApi", async () => {
  const actual = await vi.importActual<typeof import("@/utils/balanceApi")>(
    "@/utils/balanceApi"
  );
  return {
    ...actual,
    requestV2Refund: vi.fn(),
  };
});

describe("DashboardInvocationsContent", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteTextMock },
    });
    clipboardWriteTextMock.mockResolvedValue(undefined);
    globalThis.localStorage.setItem(I18N_STORAGE_KEY, "zh");
    listPaginatedUsageLogsMock.mockResolvedValue({
      rows: [
        {
          id: "inv-1",
          request_id: "req-public-1",
          origin_request_id:
            "agent:agent:0x82f1c188327bfc265357a85e8a6b4a34d562d6f8",
          ownerAddress: "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8",
          providerAddress: "0xprovider000000000000000000000000000000000001",
          agent_id: "agt_public",
          service_id: "svc_oss_security_healthcheck",
          status: "succeeded",
          total_charge: 0.01,
          latency_ms: 45,
          created_at: Math.floor(Date.now() / 1000),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
      hasMore: false,
    });
  });

  it("does not expose origin principals or counterparty wallets in the consumer invocation table", async () => {
    render(
      createElement(
        LanguageProvider,
        null,
        createElement(DashboardInvocationsContent)
      )
    );

    await screen.findByText("inv-1");

    expect(screen.queryByText("来源")).toBeNull();
    expect(screen.queryByText("对手方")).toBeNull();
    expect(screen.queryByText("req-public-1")).toBeNull();
    expect(screen.queryByText(/agent:agent:/)).toBeNull();
    expect(
      screen.queryByText(/0xprovider000000000000000000000000000000000001/i)
    ).toBeNull();
    expect(screen.getByText("svc_os...heck")).toBeTruthy();
    expect(screen.getByText("agt_public")).toBeTruthy();
  });

  it("copies visible invocation identifiers without exposing internal principals", async () => {
    render(
      createElement(
        LanguageProvider,
        null,
        createElement(DashboardInvocationsContent)
      )
    );

    await screen.findByText("inv-1");
    fireEvent.click(screen.getAllByRole("button", { name: "复制 调用 ID" })[0]);

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith("inv-1");
    });
    expect(screen.queryByText(/agent:agent:/)).toBeNull();
  });

  it("hides agent runtime principals when the API returns one as agent_id", async () => {
    listPaginatedUsageLogsMock.mockResolvedValueOnce({
      rows: [
        {
          id: "inv-runtime-principal",
          request_id: "req-public-2",
          agent_id: "agent:agent:0x82f1c188327bfc265357a85e8a6b4a34d562d6f8",
          service_id: "svc_oss_security_healthcheck",
          status: "succeeded",
          total_charge: 0.01,
          latency_ms: 45,
          created_at: Math.floor(Date.now() / 1000),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
      hasMore: false,
    });

    render(
      createElement(
        LanguageProvider,
        null,
        createElement(DashboardInvocationsContent)
      )
    );

    await screen.findByText("inv-ru...ipal");

    expect(screen.queryByText(/agent:agent:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "复制 Agent" })).toBeNull();
  });
});
