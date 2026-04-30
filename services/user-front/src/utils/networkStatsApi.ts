import { getGatewayBaseUrl } from "@/utils/gatewayApi";
import { discoverServices } from "@/utils/serviceApi";

export type PublicNetworkStats = {
  totalCalls: number;
  registeredServices: number;
  discoverableServices: number;
  staleServices: number;
  unavailableServices?: number;
  connectedAgents: number;
  runtimeReadyServices: number;
};

const EMPTY_STATS: PublicNetworkStats = {
  totalCalls: 0,
  registeredServices: 0,
  discoverableServices: 0,
  staleServices: 0,
  unavailableServices: 0,
  connectedAgents: 0,
  runtimeReadyServices: 0,
};

function numberOrZero(value: unknown): number {
  return Number(value || 0);
}

function unavailableServiceCount(payload: Partial<PublicNetworkStats>): number {
  return Math.max(
    0,
    numberOrZero(payload.registeredServices) -
      numberOrZero(
        payload.discoverableServices || payload.runtimeReadyServices
      ) -
      numberOrZero(payload.staleServices)
  );
}

export async function fetchPublicNetworkStats(): Promise<PublicNetworkStats> {
  try {
    const response = await fetch(
      `${getGatewayBaseUrl()}/api/v1/services/network-stats`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(4000),
      }
    );

    if (!response.ok) {
      throw new Error("Network stats endpoint unavailable");
    }

    const payload = (await response.json()) as Partial<PublicNetworkStats>;
    return {
      totalCalls: Number(payload.totalCalls || 0),
      registeredServices: Number(payload.registeredServices || 0),
      discoverableServices: Number(
        payload.discoverableServices || payload.runtimeReadyServices || 0
      ),
      staleServices: Number(payload.staleServices || 0),
      unavailableServices: unavailableServiceCount(payload),
      connectedAgents: Number(payload.connectedAgents || 0),
      runtimeReadyServices: Number(payload.runtimeReadyServices || 0),
    };
  } catch {
    try {
      const services = await discoverServices();
      const discoverableServices = services.filter(
        (service) => service.runtimeAvailable !== false
      ).length;
      return {
        ...EMPTY_STATS,
        registeredServices: services.length,
        discoverableServices,
        runtimeReadyServices: discoverableServices,
      };
    } catch {
      return EMPTY_STATS;
    }
  }
}
