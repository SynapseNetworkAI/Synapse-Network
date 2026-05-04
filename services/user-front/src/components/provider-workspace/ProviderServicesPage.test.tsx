// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ProviderServicesPage from "@/components/provider-workspace/ProviderServicesPage";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";
import type { ServiceRegistryRecord } from "@/utils/serviceApi";

const {
  toastError,
  toastSuccess,
  openConnectModalMock,
  authorizeMock,
  routerPushMock,
  listServiceRegistryMock,
  updateServiceRegistryMock,
  deleteServiceRegistryMock,
  invalidateServiceRegistryListCacheMock,
  upsertServiceRegistryListCacheMock,
} = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  openConnectModalMock: vi.fn(),
  authorizeMock: vi.fn(),
  routerPushMock: vi.fn(),
  listServiceRegistryMock: vi.fn(),
  updateServiceRegistryMock: vi.fn(),
  deleteServiceRegistryMock: vi.fn(),
  invalidateServiceRegistryListCacheMock: vi.fn(),
  upsertServiceRegistryListCacheMock: vi.fn(),
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
  useSearchParams: () => ({ get: vi.fn(() => null) }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/utils/serviceApi", async () => {
  const actual = await vi.importActual<typeof import("@/utils/serviceApi")>(
    "@/utils/serviceApi"
  );
  return {
    ...actual,
    listServiceRegistry: listServiceRegistryMock,
    updateServiceRegistry: updateServiceRegistryMock,
    deleteServiceRegistry: deleteServiceRegistryMock,
    invalidateServiceRegistryListCache: invalidateServiceRegistryListCacheMock,
    upsertServiceRegistryListCache: upsertServiceRegistryListCacheMock,
  };
});

function buildService(
  overrides: Partial<ServiceRegistryRecord>
): ServiceRegistryRecord {
  return {
    id: "svc-1",
    name: "Service One",
    role: "Provider",
    ownerAddress: "0xabc",
    address: "0xabc",
    serviceId: "svc-001",
    pricing: { currency: "USDC", amount: "0.02" },
    endpoint: "https://example.com/invoke",
    isActive: false,
    status: "inactive",
    runtimeAvailable: false,
    summary: "summary",
    tags: ["vision"],
    auth: { type: "service_key", headerName: "X-Credential" },
    healthCheck: {
      path: "/health",
      method: "GET",
      intervalSec: 30,
      timeoutMs: 3000,
      successCodes: [200],
      healthyThreshold: 2,
      unhealthyThreshold: 3,
    },
    constraints: {
      timeoutMs: 3000,
      maxRequestBytes: 4096,
      maxResponseBytes: 4096,
      maxQps: 50,
    },
    forwarding: {
      requestIdHeader: "X-Synapse-Request-Id",
      passThroughHeaders: [],
      injectHeaders: {},
      retryPolicy: {
        maxAttempts: 2,
        backoffMs: 200,
        retryOnStatus: [429, 500],
      },
    },
    metering: {
      billingUnit: "per_call",
      billOnError: false,
      billableStatusClasses: [2],
      requestIdRequired: true,
      responseSizeMetering: true,
    },
    invoke: {
      method: "POST",
      url: "https://example.com/invoke",
      targets: [{ url: "https://example.com/invoke", weight: 100 }],
      timeoutMs: 3000,
      request: {
        contentType: "application/json",
        schema: { type: "object", properties: {} },
      },
      response: { schema: { type: "object", properties: {} } },
    },
    createdAt: "2026-03-21T00:00:00.000Z",
    updatedAt: "2026-03-21T00:00:00.000Z",
    ...overrides,
  };
}

const changeLastField = (label: string | RegExp, value: string) => {
  const field = screen.getAllByLabelText(label).at(-1);
  expect(field).toBeTruthy();
  fireEvent.change(field!, { target: { value } });
};

describe("ProviderServicesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.localStorage.setItem(I18N_STORAGE_KEY, "zh");
    authorizeMock.mockResolvedValue(true);
  });

  it("shows zh error toast when trying to edit an active service", async () => {
    const user = userEvent.setup();

    listServiceRegistryMock.mockResolvedValue([
      buildService({
        id: "svc-active",
        serviceId: "svc-active",
        name: "Active Service",
        isActive: true,
        status: "active",
        runtimeAvailable: true,
      }),
    ]);

    render(
      createElement(LanguageProvider, null, createElement(ProviderServicesPage))
    );

    await screen.findByText("Active Service");
    await user.click(screen.getByRole("button", { name: "编辑" }));

    expect(toastError).toHaveBeenCalledWith(
      "活跃服务不可编辑。请先把服务切换为 Inactive。"
    );
  });

  it("activates an inactive service and shows zh success toast", async () => {
    const user = userEvent.setup();

    listServiceRegistryMock.mockResolvedValue([
      buildService({
        id: "svc-inactive",
        serviceId: "svc-inactive",
        name: "Inactive Service",
        isActive: false,
        status: "inactive",
      }),
    ]);
    updateServiceRegistryMock.mockResolvedValue(undefined);

    render(
      createElement(LanguageProvider, null, createElement(ProviderServicesPage))
    );

    await screen.findByText("Inactive Service");
    await user.click(screen.getByRole("button", { name: "激活" }));

    expect(
      screen.getByText(
        "确认激活服务 svc-inactive？只有当健康检查重新报告目标健康后，它才会再次进入 discovery。"
      )
    ).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "激活" }).at(-1)!);
    await waitFor(() => {
      expect(updateServiceRegistryMock).toHaveBeenCalled();
    });
    expect(toastSuccess).toHaveBeenCalledWith("服务已激活");
  });

  it("edits an inactive service through the custom edit modal", async () => {
    const user = userEvent.setup();

    listServiceRegistryMock.mockResolvedValue([
      buildService({
        id: "svc-editable",
        serviceId: "svc-editable",
        name: "Editable Service",
        isActive: false,
        status: "inactive",
      }),
    ]);
    updateServiceRegistryMock.mockResolvedValue(undefined);

    render(
      createElement(LanguageProvider, null, createElement(ProviderServicesPage))
    );

    await screen.findByText("Editable Service");
    await user.click(screen.getAllByRole("button", { name: "编辑" }).at(-1)!);

    changeLastField("服务名称", "Edited Service");
    changeLastField("单价（USDC）", "0.03");
    changeLastField("摘要", "edited summary");
    changeLastField("标签（逗号分隔）", "security,oss");
    fireEvent.click(screen.getAllByLabelText("服务激活").at(-1)!);
    changeLastField("健康检查路径", "/ready");
    changeLastField("健康检查间隔（秒）", "45");
    changeLastField("健康检查超时（毫秒）", "2500");
    changeLastField("健康检查成功状态码（逗号分隔）", "200,204");
    changeLastField("健康阈值", "2");
    changeLastField("不健康阈值", "4");
    changeLastField(/约束超时/, "3000");
    changeLastField(/最大请求字节数/, "8192");
    changeLastField(/最大响应字节数/, "8192");
    changeLastField(/最大 QPS/, "60");
    changeLastField("Invoke 方法", "POST");
    changeLastField("Invoke URL", "https://example.com/edited");
    changeLastField("Invoke 超时（毫秒）", "4000");
    changeLastField(
      "Invoke Targets（JSON 数组）",
      JSON.stringify([{ url: "https://example.com/edited", weight: 100 }])
    );
    changeLastField("请求 Schema（JSON）", JSON.stringify({ type: "object" }));
    changeLastField("响应 Schema（JSON）", JSON.stringify({ type: "object" }));

    await user.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(updateServiceRegistryMock).toHaveBeenCalled();
    });
    expect(toastSuccess).toHaveBeenCalledWith("服务已更新");
  });

  it("deletes an inactive service through the custom dialog", async () => {
    const user = userEvent.setup();

    listServiceRegistryMock.mockResolvedValue([
      buildService({
        id: "svc-delete",
        serviceId: "svc-delete",
        name: "Delete Me",
        isActive: false,
        status: "inactive",
      }),
    ]);
    deleteServiceRegistryMock.mockResolvedValue(undefined);

    render(
      createElement(LanguageProvider, null, createElement(ProviderServicesPage))
    );

    await screen.findByText("Delete Me");
    await user.click(screen.getAllByRole("button", { name: "删除" }).at(-1)!);

    expect(await screen.findByText(/确认删除服务 svc-delete/)).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "删除" }).at(-1)!);

    await waitFor(() => {
      expect(deleteServiceRegistryMock).toHaveBeenCalledWith(
        "svc-delete",
        "0xabc"
      );
    });
    expect(toastSuccess).toHaveBeenCalledWith("服务已删除");
    expect(screen.queryByText("Delete Me")).toBeNull();
  });

  it("localizes edit validation errors before saving", async () => {
    const user = userEvent.setup();

    listServiceRegistryMock.mockResolvedValue([
      buildService({
        id: "svc-invalid",
        serviceId: "svc-invalid",
        name: "Invalid Service",
        isActive: false,
        status: "inactive",
      }),
    ]);

    render(
      createElement(LanguageProvider, null, createElement(ProviderServicesPage))
    );

    await screen.findByText("Invalid Service");
    await user.click(screen.getAllByRole("button", { name: "编辑" }).at(-1)!);

    changeLastField("服务名称", "");
    changeLastField("单价（USDC）", "-1");
    changeLastField("健康检查路径", "health");
    changeLastField("Invoke URL", "");
    changeLastField("Invoke Targets（JSON 数组）", "not-json");
    changeLastField("请求 Schema（JSON）", "not-json");
    changeLastField("响应 Schema（JSON）", "not-json");

    expect(await screen.findByText("服务名称为必填项。")).toBeTruthy();
    expect(screen.getByText("单价（USDC）必须是非负数。")).toBeTruthy();
    expect(screen.getByText("健康检查路径必须以 / 开头。")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "保存修改" }).hasAttribute("disabled")
    ).toBe(true);
  });
});
