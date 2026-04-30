// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createElement,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MarketplacePage from "@/app/marketplace/page";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";
import type { ServiceRegistryRecord } from "@/utils/serviceApi";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function buildService(
  overrides: Partial<ServiceRegistryRecord> = {}
): ServiceRegistryRecord {
  return {
    id: "svc-ocr",
    name: "Invoice OCR",
    serviceName: "Invoice OCR",
    role: "provider",
    ownerAddress: "0xabc",
    address: "0xabc",
    serviceId: "invoice-ocr-v1",
    pricing: { currency: "USDC", amount: "0.08" },
    endpoint: "https://provider.example/invoke",
    isActive: true,
    status: "active",
    runtimeAvailable: true,
    summary:
      "Extract line items and totals from invoices for autonomous finance workflows.",
    tags: ["finance", "ocr"],
    metering: {
      billingUnit: "per_call",
      billOnError: false,
      billableStatusClasses: [2],
    },
    createdAt: "2026-03-21T00:00:00.000Z",
    updatedAt: "2026-03-22T00:00:00.000Z",
    ...overrides,
  };
}

function mockRegistryResponse(services: ServiceRegistryRecord[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ services }),
    })
  );
}

describe("MarketplacePage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.localStorage.setItem(I18N_STORAGE_KEY, "en");
  });

  it("renders a user-facing product marketplace without debug feed copy", async () => {
    mockRegistryResponse([
      buildService(),
      buildService({
        id: "svc-unavailable",
        serviceId: "invoice-ocr-paused",
        serviceName: "Paused OCR",
        name: "Paused OCR",
        runtimeAvailable: false,
      }),
    ]);

    render(
      createElement(LanguageProvider, null, createElement(MarketplacePage))
    );

    expect(await screen.findByText("Invoice OCR")).toBeTruthy();
    expect(screen.getByText("Agent API Marketplace")).toBeTruthy();
    expect(screen.getByText("Ready to call")).toBeTruthy();
    expect(screen.getByText("0.08 USDC")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /Use this service/i })
        .getAttribute("href")
    ).toBe("/dashboard/discovery");
    expect(screen.queryByText("Paused OCR")).toBeNull();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/marketplace/registry.json?pageSize=100",
        expect.objectContaining({ cache: "no-store" })
      );
    });

    const visibleCopy = document.body.textContent || "";
    expect(visibleCopy).not.toMatch(
      /machine-readable|json feed|copy feed|copy endpoint|endpoint|serviceId|auth|method/i
    );
  });

  it("renders callable services as a paginated list and resets to page one after search", async () => {
    const rows = Array.from({ length: 12 }, (_, index) => {
      const itemNumber = index + 1;
      return buildService({
        id: `svc-${itemNumber}`,
        serviceId: `callable-${itemNumber}`,
        serviceName: `Callable OCR ${String(itemNumber).padStart(2, "0")}`,
        name: `Callable OCR ${String(itemNumber).padStart(2, "0")}`,
        summary: `Callable service ${itemNumber}`,
        tags: itemNumber === 12 ? ["settlement"] : ["finance"],
      });
    });
    mockRegistryResponse([
      ...rows,
      buildService({
        id: "svc-inactive",
        serviceId: "inactive-service",
        serviceName: "Inactive OCR",
        name: "Inactive OCR",
        isActive: false,
      }),
      buildService({
        id: "svc-unavailable",
        serviceId: "unavailable-service",
        serviceName: "Unavailable OCR",
        name: "Unavailable OCR",
        runtimeAvailable: false,
      }),
    ]);

    render(
      createElement(LanguageProvider, null, createElement(MarketplacePage))
    );

    expect(await screen.findByText("Callable OCR 01")).toBeTruthy();
    expect(screen.getByText("Callable OCR 10")).toBeTruthy();
    expect(screen.queryByText("Callable OCR 11")).toBeNull();
    expect(screen.queryByText("Inactive OCR")).toBeNull();
    expect(screen.queryByText("Unavailable OCR")).toBeNull();
    expect(screen.getByText("Showing 1-10 of 12")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Callable OCR 11")).toBeTruthy();
    expect(screen.getByText("Callable OCR 12")).toBeTruthy();
    expect(screen.queryByText("Callable OCR 01")).toBeNull();
    expect(screen.getByText("Showing 11-12 of 12")).toBeTruthy();

    await userEvent.type(
      screen.getByPlaceholderText("Search services, use cases, or tags..."),
      "12"
    );
    expect(await screen.findByText("Callable OCR 12")).toBeTruthy();
    expect(screen.getByText("Showing 1-1 of 1")).toBeTruthy();
  });
});
