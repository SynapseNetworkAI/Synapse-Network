import { getGatewayBaseUrl } from "@/utils/gatewayApi";
import { discoverServices } from "@/utils/serviceApi";

export type PublicNetworkStats = {
  totalCalls: number;
  registeredServices: number;
  connectedAgents: number;
  runtimeReadyServices: number;
};

const EMPTY_STATS: PublicNetworkStats = {
  totalCalls: 0,
  registeredServices: 0,
  connectedAgents: 0,
  runtimeReadyServices: 0,
};

export async function fetchPublicNetworkStats(): Promise<PublicNetworkStats> {
  try {
    const response = await fetch(`${getGatewayBaseUrl()}/api/v1/services/network-stats`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) {
      throw new Error("Network stats endpoint unavailable");
    }

    const payload = (await response.json()) as Partial<PublicNetworkStats>;
    return {
      totalCalls: Number(payload.totalCalls || 0),
      registeredServices: Number(payload.registeredServices || 0),
      connectedAgents: Number(payload.connectedAgents || 0),
      runtimeReadyServices: Number(payload.runtimeReadyServices || 0),
    };
  } catch {
    try {
      const services = await discoverServices();
      return {
        ...EMPTY_STATS,
        registeredServices: services.length,
        runtimeReadyServices: services.filter((service) => service.runtimeAvailable !== false).length,
      };
    } catch {
      return EMPTY_STATS;
    }
  }
}