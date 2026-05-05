// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ReactNode } from "react";

import DashboardCredentialsPage from "@/components/dashboard-workspace/DashboardCredentialsPage";
import { renderWithLanguage } from "@/test/renderWithLanguage";

const {
  listServiceRegistryMock,
  listAgentCredentialsMock,
  listAuditLogsMock,
  revokeAgentCredentialMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  listServiceRegistryMock: vi.fn(),
  listAgentCredentialsMock: vi.fn(),
  listAuditLogsMock: vi.fn(),
  revokeAgentCredentialMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x0000000000000000000000000000000000000001",
  }),
}));

vi.mock("@/components/WalletAuthGuard", () => ({
  useAuth: () => ({
    isSessionAuthenticated: true,
  }),
}));

vi.mock("@/components/AuthMask", () => ({
  default: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
}));

vi.mock("@/utils/serviceApi", () => ({
  listServiceRegistry: listServiceRegistryMock,
}));

vi.mock("@/utils/agentCredentialApi", async () => {
  const actual = await vi.importActual<
    typeof import("@/utils/agentCredentialApi")
  >("@/utils/agentCredentialApi");
  return {
    ...actual,
    issueAgentCredential: vi.fn(),
    listAgentCredentials: listAgentCredentialsMock,
    listAuditLogs: listAuditLogsMock,
    revokeAgentCredential: revokeAgentCredentialMock,
    updateAgentCredentialQuota: vi.fn(),
  };
});

vi.mock("@/utils/agentCredentialStore", () => ({
  setCredentialForService: vi.fn(),
}));

const activeCredential = {
  id: "cred-active-001",
  ownerAddress: "0x0000000000000000000000000000000000000001",
  tokenPrefix: "agt_demo",
  status: "active" as const,
  maxCalls: 1000,
  callsUsed: 7,
  rpm: 600,
  creditLimit: 10,
  expiresAt: 0,
};

describe("DashboardCredentialsPage i18n", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    listServiceRegistryMock.mockResolvedValue([]);
    listAgentCredentialsMock.mockResolvedValue([activeCredential]);
    listAuditLogsMock.mockResolvedValue([]);
    revokeAgentCredentialMock.mockResolvedValue(undefined);
  });

  it("renders the credentials table in English", async () => {
    renderWithLanguage(createElement(DashboardCredentialsPage), "en");

    expect(
      await screen.findByRole("heading", { name: "Agent Credentials" })
    ).toBeTruthy();
    expect(screen.getByText("Active Credentials")).toBeTruthy();
    expect(screen.getByPlaceholderText("Search credential ID...")).toBeTruthy();
    expect(screen.getByText("Credential Prefix")).toBeTruthy();
    expect(screen.getByText("Universal Key")).toBeTruthy();
    expect(screen.getByText("agt_demo")).toBeTruthy();
    expect(screen.queryByText("Agent 凭据")).toBeNull();
  });

  it("renders Chinese labels and revoke confirmation modal", async () => {
    const user = userEvent.setup();
    renderWithLanguage(createElement(DashboardCredentialsPage), "zh");

    expect(
      await screen.findByRole("heading", { name: "Agent 凭据" })
    ).toBeTruthy();
    expect(screen.getByText("活跃凭据")).toBeTruthy();
    expect(screen.getByPlaceholderText("搜索凭据 ID...")).toBeTruthy();
    expect(screen.getByText("凭据前缀")).toBeTruthy();
    expect(screen.getByText("通用 Key")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "撤销" }));

    expect(screen.getByRole("heading", { name: "撤销凭据" })).toBeTruthy();
    expect(screen.getByText(/都会立即停止认证/)).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "撤销" }).at(-1)!);

    await waitFor(() => {
      expect(revokeAgentCredentialMock).toHaveBeenCalledWith(
        "0x0000000000000000000000000000000000000001",
        "cred-active-001"
      );
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("凭据已撤销");
  });

  it("shows localized fallback when revoke returns raw backend errors", async () => {
    const user = userEvent.setup();
    revokeAgentCredentialMock.mockRejectedValue(
      new Error("503: {'code': 'HTTPException', 'message': 'Internal error'}")
    );
    renderWithLanguage(createElement(DashboardCredentialsPage), "zh");

    expect(
      await screen.findByRole("heading", { name: "Agent 凭据" })
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "撤销" }));
    await user.click(screen.getAllByRole("button", { name: "撤销" }).at(-1)!);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("撤销凭据失败");
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      expect.stringContaining("503:")
    );
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      expect.stringContaining("HTTPException")
    );
  });
});
