// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ProviderSecretsPage from "@/components/provider-workspace/ProviderSecretsPage";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";

const {
  toastMock,
  toastError,
  toastSuccess,
  openConnectModalMock,
  authorizeMock,
  listApiSecretsMock,
  createApiSecretMock,
  deleteApiSecretMock,
  clipboardWriteTextMock,
} = vi.hoisted(() => {
  const toastFn = vi.fn();
  return {
    toastMock: Object.assign(toastFn, {
      error: vi.fn(),
      success: vi.fn(),
    }),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    openConnectModalMock: vi.fn(),
    authorizeMock: vi.fn(),
    listApiSecretsMock: vi.fn(),
    createApiSecretMock: vi.fn(),
    deleteApiSecretMock: vi.fn(),
    clipboardWriteTextMock: vi.fn(),
  };
});

vi.mock("react-hot-toast", () => ({
  default: Object.assign(toastMock, {
    error: toastError,
    success: toastSuccess,
  }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc", isConnected: true }),
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({
    openConnectModal: openConnectModalMock,
  }),
}));

vi.mock("@/components/WalletAuthGuard", () => ({
  useAuth: () => ({
    isSessionAuthenticated: true,
    authorize: authorizeMock,
  }),
}));

vi.mock("@/utils/serviceApi", async () => {
  const actual = await vi.importActual<typeof import("@/utils/serviceApi")>("@/utils/serviceApi");
  return {
    ...actual,
    listApiSecrets: listApiSecretsMock,
    createApiSecret: createApiSecretMock,
    deleteApiSecret: deleteApiSecretMock,
  };
});

describe("ProviderSecretsPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.localStorage.setItem(I18N_STORAGE_KEY, "zh");
    listApiSecretsMock.mockResolvedValue([
      {
        id: "secret-1",
        name: "Primary Secret",
        secretKey: "synapse-secret-value",
        maskedKey: "sk_live_****",
        createdAt: "2026-03-21T00:00:00.000Z",
      },
    ]);
    createApiSecretMock.mockResolvedValue({
      id: "secret-2",
      name: "新密钥",
      secretKey: "created-secret-value",
      maskedKey: "sk_live_****",
      createdAt: "2026-03-22T00:00:00.000Z",
    });
    authorizeMock.mockResolvedValue(true);

    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock,
      },
    });
  });

  it("copies a secret and shows zh success toast", async () => {
    const user = userEvent.setup();

    render(createElement(LanguageProvider, null, createElement(ProviderSecretsPage)));

    await screen.findByText("Primary Secret");

    const copyButton = screen.getAllByTitle("复制签名密钥")[0].closest("button");
    expect(copyButton).toBeTruthy();
    await user.click(copyButton as HTMLButtonElement);

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("签名密钥已复制");
    });
  });

  it("creates a secret from the modal and shows zh success toast", async () => {
    const user = userEvent.setup();

    render(createElement(LanguageProvider, null, createElement(ProviderSecretsPage)));

    await screen.findByText("Primary Secret");

    await user.click(screen.getAllByRole("button", { name: "签发签名密钥" })[0]);

    await screen.findByRole("heading", { name: "签发 Provider 凭据" });
    await user.type(screen.getByLabelText("名称"), "新密钥");
    await user.type(screen.getByLabelText("速率限制"), "75");
    await user.selectOptions(screen.getByLabelText("过期时间"), "30");

    await user.click(screen.getByRole("button", { name: "签发凭据" }));

    await waitFor(() => {
      expect(createApiSecretMock).toHaveBeenCalledWith(
        "新密钥",
        "0xabc",
        null,
        null,
        expect.any(Number),
        75,
      );
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("签名密钥已创建");
    });
    expect(await screen.findByText("新密钥")).toBeTruthy();
  });
});