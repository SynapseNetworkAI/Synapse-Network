import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceRegistryRecord } from "@/utils/serviceApi";

const { discoverServicesMock, fetchPublicNetworkStatsMock } = vi.hoisted(
  () => ({
    discoverServicesMock: vi.fn(),
    fetchPublicNetworkStatsMock: vi.fn(),
  })
);

vi.mock("@/utils/serviceApi", () => ({
  discoverServices: discoverServicesMock,
}));

vi.mock("@/utils/networkStatsApi", () => ({
  fetchPublicNetworkStats: fetchPublicNetworkStatsMock,
}));

import { GET } from "./route";

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
    createdAt: "2026-03-21T00:00:00.000Z",
    updatedAt: "2026-03-22T00:00:00.000Z",
    ...overrides,
  };
}

async function readRegistry(path: string) {
  const response = await GET(new Request(`http://localhost:3000${path}`));
  expect(response.status).toBe(200);
  return response.json();
}

describe("marketplace registry.json route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPublicNetworkStatsMock.mockResolvedValue({
      totalCalls: 0,
      registeredServices: 12,
      discoverableServices: 10,
      staleServices: 1,
      unavailableServices: 1,
      connectedAgents: 0,
      runtimeReadyServices: 10,
    });
  });

  it("returns only callable services with default pagination", async () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      buildService({
        id: `svc-${index + 1}`,
        serviceId: `callable-${index + 1}`,
        serviceName: `Callable ${index + 1}`,
      })
    );
    discoverServicesMock.mockResolvedValue([
      ...rows,
      buildService({
        id: "inactive",
        serviceId: "inactive",
        serviceName: "Inactive",
        isActive: false,
      }),
      buildService({
        id: "unavailable",
        serviceId: "unavailable",
        serviceName: "Unavailable",
        runtimeAvailable: false,
      }),
    ]);

    const payload = await readRegistry("/marketplace/registry.json");

    expect(payload.services).toHaveLength(10);
    expect(payload.total).toBe(12);
    expect(payload.pagination).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 12,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(payload.diagnostics).toMatchObject({
      registeredTotal: 12,
      discoverableTotal: 10,
      staleTotal: 1,
      unavailableTotal: 1,
    });
    expect(
      payload.services.map(
        (service: ServiceRegistryRecord) => service.serviceId
      )
    ).not.toContain("inactive");
    expect(
      payload.services.map(
        (service: ServiceRegistryRecord) => service.serviceId
      )
    ).not.toContain("unavailable");
  });

  it("applies search and tag filters before paginating", async () => {
    discoverServicesMock.mockResolvedValue([
      buildService({
        id: "finance-1",
        serviceId: "finance-1",
        serviceName: "Invoice OCR",
        tags: ["finance", "ocr"],
      }),
      buildService({
        id: "finance-2",
        serviceId: "finance-2",
        serviceName: "Invoice Audit",
        tags: ["finance"],
      }),
      buildService({
        id: "media-1",
        serviceId: "media-1",
        serviceName: "Image Caption",
        tags: ["media"],
      }),
    ]);

    const payload = await readRegistry(
      "/marketplace/registry.json?q=invoice&tag=finance&page=2&pageSize=1"
    );

    expect(payload.services).toHaveLength(1);
    expect(payload.services[0].serviceId).toBe("finance-2");
    expect(payload.query).toMatchObject({
      q: "invoice",
      tag: "finance",
      page: 2,
      pageSize: 1,
    });
    expect(payload.pagination).toMatchObject({
      page: 2,
      pageSize: 1,
      total: 2,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    });
  });

  it("falls back to safe pagination defaults for invalid query values", async () => {
    discoverServicesMock.mockResolvedValue([
      buildService({ id: "svc-1", serviceId: "svc-1" }),
      buildService({ id: "svc-2", serviceId: "svc-2" }),
    ]);

    const payload = await readRegistry(
      "/marketplace/registry.json?page=zero&pageSize=-1"
    );

    expect(payload.query).toMatchObject({ page: 1, pageSize: 10 });
    expect(payload.services).toHaveLength(2);
    expect(payload.pagination.totalPages).toBe(1);
  });
});
