// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createElement,
  type AnchorHTMLAttributes,
  type ChangeEvent,
} from "react";
import { render, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import ProviderHealthPage from "@/components/provider-workspace/ProviderHealthPage";
import { I18N_STORAGE_KEY } from "@/i18n/config";

const { toastErrorMock, listServiceRegistryMock, getServiceHealthHistoryMock } =
  vi.hoisted(() => ({
    toastErrorMock: vi.fn(),
    listServiceRegistryMock: vi.fn(),
    getServiceHealthHistoryMock: vi.fn(),
  }));

vi.mock("react-hot-toast", () => ({
  default: {
    error: toastErrorMock,
  },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc", isConnected: true }),
}));

vi.mock("@/components/WalletAuthGuard", () => ({
  useAuth: () => ({
    isSessionAuthenticated: true,
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: vi.fn(() => null) }),
}));

vi.mock("next/dynamic", () => ({
  default: () => () => createElement("div", { "data-testid": "health-chart" }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("@/components/xui/XSelect", () => ({
  default: ({
    value,
    onChange,
    options,
    id,
    disabled,
  }: {
    value: string;
    onChange: (next: string) => void;
    options: Array<{ value: string; label: string }>;
    id?: string;
    disabled?: boolean;
  }) =>
    createElement(
      "select",
      {
        id,
        "aria-label": id || "select",
        value,
        disabled,
        onChange: (event: ChangeEvent<HTMLSelectElement>) =>
          onChange(event.target.value),
      },
      options.map((option) =>
        createElement("option", { key: option.value, value: option.value }, [
          option.label,
        ])
      )
    ),
}));

vi.mock("@/utils/serviceApi", async () => {
  const actual = await vi.importActual<typeof import("@/utils/serviceApi")>(
    "@/utils/serviceApi"
  );
  return {
    ...actual,
    listServiceRegistry: listServiceRegistryMock,
    getServiceHealthHistory: getServiceHealthHistoryMock,
  };
});

function renderPage(language: "en" | "zh") {
  globalThis.localStorage.setItem(I18N_STORAGE_KEY, language);
  return render(
    createElement(LanguageProvider, null, createElement(ProviderHealthPage))
  );
}

describe("ProviderHealthPage error copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.localStorage.clear();
    listServiceRegistryMock.mockResolvedValue([
      {
        serviceId: "svc_health_fixture",
        name: "Health Fixture",
        serviceName: "Health Fixture",
      },
    ]);
    getServiceHealthHistoryMock.mockRejectedValue(
      new Error("503: {'code': 'UPSTREAM_ERROR', 'message': 'HTTPException'}")
    );
  });

  it("shows localized Chinese health history failure instead of raw backend errors", async () => {
    renderPage("zh");

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "加载服务健康历史失败。请等待 Gateway 恢复后重试。"
      );
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      expect.stringContaining("503:")
    );
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      expect.stringContaining("HTTPException")
    );
  });

  it("shows localized English health history failure instead of raw backend errors", async () => {
    renderPage("en");

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Failed to load service health history. Please retry after the gateway reconnects."
      );
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      expect.stringContaining("503:")
    );
  });
});
