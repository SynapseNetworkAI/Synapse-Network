// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import ProviderServiceDeployPage from "@/components/provider-workspace/ProviderServiceDeployPage";
import { I18N_STORAGE_KEY } from "@/i18n/config";

const {
  routerPushMock,
  routerReplaceMock,
  toastError,
  toastSuccess,
  createServiceRegistryMock,
} = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
  routerReplaceMock: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  createServiceRegistryMock: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: {
    error: toastError,
    success: toastSuccess,
  },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc", isConnected: true }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: routerReplaceMock,
  }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/components/AuthMask", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/xui/XSelect", () => ({
  default: ({
    value,
    onChange,
    options,
    id,
  }: {
    value: string;
    onChange: (next: string) => void;
    options: Array<{ value: string; label: string }>;
    id?: string;
  }) => (
    <select id={id} aria-label={id || "select"} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock("@/utils/serviceApi", async () => {
  const actual = await vi.importActual<typeof import("@/utils/serviceApi")>("@/utils/serviceApi");
  return {
    ...actual,
    createServiceRegistry: createServiceRegistryMock,
  };
});

describe("ProviderServiceDeployPage", () => {
  const renderPage = () =>
    render(
      <LanguageProvider>
        <ProviderServiceDeployPage />
      </LanguageProvider>,
    );

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
    delete process.env.NEXT_PUBLIC_SUPPORT_PORTAL_URL;
    globalThis.localStorage.clear();
    createServiceRegistryMock.mockResolvedValue({
      id: "svc-1",
      serviceId: "sea_invoice_ocr",
    });
  });

  it("starts in minimum-input mode and derives Service ID from Service Name", async () => {
    const user = userEvent.setup();

    renderPage();

    expect(screen.getByText("Quick Publish")).toBeTruthy();
    expect(screen.queryByText("Required from you")).toBeNull();
    expect(screen.queryByText("Auto-applied defaults")).toBeNull();
    expect(screen.queryByText("Lowest-cost onboarding")).toBeNull();
    expect(screen.queryByText("Preview and auditability")).toBeNull();
    expect(screen.queryByText("Gateway submission payload")).toBeNull();
    expect(screen.queryByLabelText("Auth Mode")).toBeNull();

    await user.type(screen.getByLabelText("Service Name"), "SEA Invoice OCR");

    await waitFor(() => {
      expect((screen.getByLabelText("Service ID") as HTMLInputElement).value).toBe("sea_invoice_ocr");
    });

    await user.click(screen.getByRole("button", { name: "Show Advanced Overrides" }));
    expect(screen.getByLabelText("Auth Mode")).toBeTruthy();
  });

  it("submits a service with platform defaults when only the minimum fields are filled", async () => {
    const user = userEvent.setup();

    renderPage();

    await user.type(screen.getByLabelText("Service Name"), "SEA Invoice OCR");
    await user.type(screen.getByLabelText("Primary Endpoint URL"), "https://provider.example.com/invoke");
    await user.clear(screen.getByLabelText("Base Price USDC"));
    await user.type(screen.getByLabelText("Base Price USDC"), "0.008");
    await user.type(
      screen.getByLabelText("Description for Model"),
      "Extract structured invoice fields from Southeast Asia invoice images.",
    );

    const submitButton = screen.getByRole("button", { name: "CREATE API SERVICE" });
    await waitFor(() => {
      expect((submitButton as HTMLButtonElement).disabled).toBe(false);
    });

    await user.click(submitButton);

    await waitFor(() => {
      expect(createServiceRegistryMock).toHaveBeenCalledTimes(1);
    });

    expect(createServiceRegistryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: "sea_invoice_ocr",
        serviceName: "SEA Invoice OCR",
        status: "draft",
        pricing: {
          currency: "USDC",
          amount: "0.008",
        },
        healthCheck: expect.objectContaining({
          path: "/health",
          method: "GET",
          intervalSec: 10,
          timeoutMs: 3000,
        }),
        metering: expect.objectContaining({
          billingUnit: "per_call",
          billOnError: false,
          requestIdRequired: true,
        }),
        invoke: expect.objectContaining({
          timeoutMs: 15000,
          targets: [
            expect.objectContaining({
              url: "https://provider.example.com/invoke",
              weight: 100,
            }),
          ],
        }),
      }),
      "0xabc",
    );
    expect(routerReplaceMock).toHaveBeenCalledWith("/provider/services");
    expect(toastSuccess).toHaveBeenCalledWith("API service submitted.");
  });

  it("renders localized Chinese copy when language is switched to zh", async () => {
    globalThis.localStorage.setItem(I18N_STORAGE_KEY, "zh");

    renderPage();

    expect(screen.getByText("创建 API 服务")).toBeTruthy();
    expect(screen.getByText("快速发布")).toBeTruthy();
    expect(screen.getByRole("button", { name: "AI 定义助手" })).toBeTruthy();
    expect(screen.getByLabelText("服务名称")).toBeTruthy();
    expect(screen.getByRole("button", { name: "显示高级覆盖" })).toBeTruthy();
  });

  it("shows a support contact entry when support email is configured", async () => {
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL = "support@synapse.test";

    renderPage();

    expect(screen.getByText("Need help publishing this service?")).toBeTruthy();
    const supportLink = screen.getByRole("link", { name: "Contact Support" });
    expect(supportLink.getAttribute("href")).toContain("mailto:support@synapse.test");
  });
});
