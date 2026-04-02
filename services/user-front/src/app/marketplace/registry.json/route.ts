import { discoverServices, type ServiceRegistryRecord } from "@/utils/serviceApi";

export const dynamic = "force-dynamic";

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

function filterServices(rows: ServiceRegistryRecord[], searchParams: URLSearchParams): ServiceRegistryRecord[] {
  const status = searchParams.get("status")?.trim().toLowerCase() || "active";
  const tag = searchParams.get("tag")?.trim();
  const query = searchParams.get("q")?.trim().toLowerCase() || "";

  return rows.filter((service) => {
    if (status !== "all" && service.isActive === false) {
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
    const rows = await discoverServices();
    const services = filterServices(rows, url.searchParams);

    return Response.json(
      {
        status: "success",
        exportedAt: new Date().toISOString(),
        query: {
          status: url.searchParams.get("status") || "active",
          tag: url.searchParams.get("tag"),
          q: url.searchParams.get("q") || "",
        },
        total: services.length,
        services,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registry export failed";
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
      },
    );
  }
}