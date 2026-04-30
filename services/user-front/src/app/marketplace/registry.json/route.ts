import {
  discoverServices,
  type ServiceRegistryRecord,
} from "@/utils/serviceApi";
import { fetchPublicNetworkStats } from "@/utils/networkStatsApi";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function parsePageSize(value: string | null): number {
  return Math.min(
    parsePositiveInteger(value, DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE
  );
}

function isCallableService(service: ServiceRegistryRecord): boolean {
  return service.isActive !== false && service.runtimeAvailable !== false;
}

function matchesQuery(service: ServiceRegistryRecord, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystack = [
    service.serviceId,
    service.serviceName,
    service.name,
    service.summary,
    service.endpoint,
    service.role,
    ...(service.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function filterServices(
  rows: ServiceRegistryRecord[],
  searchParams: URLSearchParams
): ServiceRegistryRecord[] {
  const tag = searchParams.get("tag")?.trim();
  const query = searchParams.get("q")?.trim().toLowerCase() || "";

  return rows.filter((service) => {
    if (!isCallableService(service)) {
      return false;
    }
    if (tag && !(service.tags || []).includes(tag)) {
      return false;
    }
    return matchesQuery(service, query);
  });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() || "";
    const tag = url.searchParams.get("tag")?.trim() || "";
    const [rows, stats] = await Promise.all([
      discoverServices(query || tag || undefined),
      fetchPublicNetworkStats(),
    ]);
    const services = filterServices(rows, url.searchParams);
    const page = parsePositiveInteger(
      url.searchParams.get("page"),
      DEFAULT_PAGE
    );
    const pageSize = parsePageSize(url.searchParams.get("pageSize"));
    const totalPages = Math.max(1, Math.ceil(services.length / pageSize));
    const currentPage = Math.min(page, totalPages);
    const startIndex = (currentPage - 1) * pageSize;
    const pageServices = services.slice(startIndex, startIndex + pageSize);

    return Response.json(
      {
        status: "success",
        exportedAt: new Date().toISOString(),
        query: {
          tag: url.searchParams.get("tag"),
          q: url.searchParams.get("q") || "",
          page: currentPage,
          pageSize,
        },
        pagination: {
          page: currentPage,
          pageSize,
          total: services.length,
          totalPages,
          hasNextPage: currentPage < totalPages,
          hasPreviousPage: currentPage > 1,
        },
        total: services.length,
        diagnostics: {
          registeredTotal: stats.registeredServices,
          discoverableTotal: stats.discoverableServices,
          staleTotal: stats.staleServices,
          unavailableTotal:
            stats.unavailableServices ??
            Math.max(
              0,
              stats.registeredServices -
                stats.discoverableServices -
                stats.staleServices
            ),
        },
        services: pageServices,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Registry export failed";
    return Response.json(
      {
        status: "error",
        error: message,
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  }
}
