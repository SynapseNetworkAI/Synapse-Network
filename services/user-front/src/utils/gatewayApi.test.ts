import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getGatewayBaseUrl,
  getGatewayBaseUrlCandidates,
} from "@/utils/gatewayApi";

function setWindowLocation(location: {
  hostname: string;
  origin: string;
  port: string;
  protocol: string;
}) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location,
    },
  });
}

describe("getGatewayBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("uses NEXT_PUBLIC_GATEWAY_BASE_URL when configured", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_GATEWAY_BASE_URL",
      "https://gateway.synapse.local///"
    );

    expect(getGatewayBaseUrl()).toBe("https://gateway.synapse.local");
  });

  it("keeps loopback fallback candidates when local gateway env is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_GATEWAY_BASE_URL", "http://localhost:8000///");

    expect(getGatewayBaseUrl()).toBe("http://localhost:8000");
    expect(getGatewayBaseUrlCandidates()).toEqual([
      "http://localhost:8000",
      "http://127.0.0.1:8000",
    ]);
  });

  it("uses the same-origin proxy first in browser local gateway env", () => {
    vi.stubEnv("NEXT_PUBLIC_GATEWAY_BASE_URL", "http://localhost:8000///");
    setWindowLocation({
      hostname: "localhost",
      origin: "http://localhost:3000",
      port: "3000",
      protocol: "http:",
    });

    expect(getGatewayBaseUrl()).toBe("http://localhost:3000");
    expect(getGatewayBaseUrlCandidates()).toEqual([
      "http://localhost:3000",
      "http://localhost:8000",
      "http://127.0.0.1:8000",
    ]);
  });

  it("falls back to localhost port 8000 during local browser development", () => {
    setWindowLocation({
      hostname: "localhost",
      origin: "http://localhost:3000",
      port: "3000",
      protocol: "http:",
    });

    expect(getGatewayBaseUrl()).toBe("http://localhost:3000");
    expect(getGatewayBaseUrlCandidates()).toEqual([
      "http://localhost:3000",
      "http://localhost:8000",
      "http://127.0.0.1:8000",
    ]);
  });

  it("falls back to same-origin for non-local browser hosts", () => {
    setWindowLocation({
      hostname: "console.synapse.network",
      origin: "https://console.synapse.network",
      port: "",
      protocol: "https:",
    });

    expect(getGatewayBaseUrl()).toBe("https://console.synapse.network");
  });

  it("uses the same host with port 8000 during custom local dev hostnames", () => {
    setWindowLocation({
      hostname: "alex-inspiron.local",
      origin: "http://alex-inspiron.local:3000",
      port: "3000",
      protocol: "http:",
    });

    expect(getGatewayBaseUrl()).toBe("http://alex-inspiron.local:3000");
    expect(getGatewayBaseUrlCandidates()).toEqual([
      "http://alex-inspiron.local:3000",
      "http://alex-inspiron.local:8000",
      "http://127.0.0.1:8000",
      "http://localhost:8000",
    ]);
  });

  it("uses 127.0.0.1 fallback outside the browser", () => {
    expect(getGatewayBaseUrl()).toBe("http://127.0.0.1:8000");
  });
});
