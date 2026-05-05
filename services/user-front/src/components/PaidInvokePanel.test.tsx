// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

import PaidInvokePanel from "@/components/PaidInvokePanel";
import { renderWithLanguage } from "@/test/renderWithLanguage";

const { toastErrorMock, toastSuccessMock, invokePaidServiceMock } = vi.hoisted(
  () => ({
    toastErrorMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    invokePaidServiceMock: vi.fn(),
  })
);

vi.mock("react-hot-toast", () => ({
  default: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

vi.mock("@/utils/agentCredentialStore", () => ({
  getCredentialForService: () => "agt_test",
}));

vi.mock("@/utils/payForService", () => ({
  payForServiceWithApproval: vi.fn(),
}));

vi.mock("@/utils/invokePaidService", () => ({
  invokePaidService: invokePaidServiceMock,
}));

describe("PaidInvokePanel i18n", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders English labels and missing-config hint", () => {
    renderWithLanguage(
      createElement(PaidInvokePanel, {
        providerAddress: "0x0000000000000000000000000000000000000001",
      }),
      "en"
    );

    expect(screen.getByText("Live Test (Pay + Invoke)")).toBeTruthy();
    expect(screen.getByLabelText("Test Prompt")).toBeTruthy();
    expect(
      screen.getByText(
        "Endpoint / Service ID / pricing is missing, or the service is inactive."
      )
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Pay & Invoke Now",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(screen.queryByText("实时测试（支付 + 调用）")).toBeNull();
  });

  it("renders Chinese labels and inactive-service hint", () => {
    renderWithLanguage(
      createElement(PaidInvokePanel, {
        providerAddress: "0x0000000000000000000000000000000000000001",
        endpoint: "http://127.0.0.1:9000/invoke",
        serviceId: "svc-test",
        pricing: "0.01",
        isActive: false,
      }),
      "zh"
    );

    expect(screen.getByText("实时测试（支付 + 调用）")).toBeTruthy();
    expect(screen.getByLabelText("测试 Prompt")).toBeTruthy();
    expect(screen.getByText(/服务当前未激活/)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "支付并调用",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(screen.queryByText("Live Test (Pay + Invoke)")).toBeNull();
  });

  it("renders localized result labels after a successful invoke", async () => {
    const user = userEvent.setup();
    invokePaidServiceMock.mockResolvedValue({
      txHash: "0xabc",
      attempts: 2,
      response: { ok: true },
    });
    renderWithLanguage(
      createElement(PaidInvokePanel, {
        providerAddress: "0x0000000000000000000000000000000000000001",
        endpoint: "http://127.0.0.1:9000/invoke",
        serviceId: "svc-test",
        pricing: "0.01",
      }),
      "zh"
    );

    await user.click(screen.getByRole("button", { name: "支付并调用" }));

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("付费调用已完成。");
    });
    expect(screen.getByText("交易哈希")).toBeTruthy();
    expect(screen.getByText("重试次数")).toBeTruthy();
  });

  it("shows localized fallback when paid invoke returns raw provider errors", async () => {
    const user = userEvent.setup();
    invokePaidServiceMock.mockRejectedValue(
      new Error(
        "502: {'code': 'UPSTREAM_ERROR', 'message': 'Provider upstream failed'}"
      )
    );
    renderWithLanguage(
      createElement(PaidInvokePanel, {
        providerAddress: "0x0000000000000000000000000000000000000001",
        endpoint: "http://127.0.0.1:9000/invoke",
        serviceId: "svc-test",
        pricing: "0.01",
      }),
      "zh"
    );

    await user.click(screen.getByRole("button", { name: "支付并调用" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("调用失败");
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Provider upstream failed")
    );
  });
});
