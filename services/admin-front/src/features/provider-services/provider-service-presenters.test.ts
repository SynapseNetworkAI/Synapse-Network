import { describe, expect, it } from "vitest";

import {
  buildProviderServiceActionNotice,
  buildProviderServiceLifecycleNote,
  buildProviderServiceListParams,
  canDeleteProviderService,
  formatProviderServiceEpochMs,
  getProviderServiceTargetError,
  PROVIDER_SERVICE_DEFAULT_FILTERS,
  resolveProviderServiceLifecycleAction,
} from "./provider-service-presenters";

describe("provider service presenters", () => {
  it("builds backend list params from submitted filters and pagination", () => {
    expect(
      buildProviderServiceListParams({
        filters: {
          ...PROVIDER_SERVICE_DEFAULT_FILTERS,
          query: "ignored draft",
          submittedQuery: "svc_quote",
          controlStatus: "active",
          runtimeStatus: "healthy",
        },
        page: 2,
        pageSize: 50,
      })
    ).toEqual({
      query: "svc_quote",
      status: "active",
      runtimeStatus: "healthy",
      page: 2,
      pageSize: 50,
    });

    expect(
      buildProviderServiceListParams({
        filters: PROVIDER_SERVICE_DEFAULT_FILTERS,
        page: 1,
        pageSize: 20,
      })
    ).toEqual({
      query: undefined,
      status: undefined,
      runtimeStatus: undefined,
      page: 1,
      pageSize: 20,
    });
  });

  it("formats provider epoch timestamps and empty runtime timestamps", () => {
    expect(formatProviderServiceEpochMs(null)).toBe("n/a");
    expect(formatProviderServiceEpochMs(undefined)).toBe("n/a");
    expect(
      formatProviderServiceEpochMs(Date.parse("2026-06-03T00:00:00Z"))
    ).toMatch(/^06\/03 \d{2}:00$/);
  });

  it("surfaces the first failing target error", () => {
    expect(
      getProviderServiceTargetError({
        targets: [
          { targetUrl: "https://a.test", status: "healthy", error: null },
          {
            targetUrl: "https://b.test",
            status: "unhealthy",
            error: "timeout",
          },
        ],
      })
    ).toBe("timeout");
    expect(getProviderServiceTargetError({ targets: [] })).toBe("无最近错误");
  });

  it("maps operator actions to lifecycle API actions and notes", () => {
    expect(resolveProviderServiceLifecycleAction("pause")).toBe("PAUSE");
    expect(resolveProviderServiceLifecycleAction("resume")).toBe("RESUME");
    expect(resolveProviderServiceLifecycleAction("suspend")).toBe("SUSPEND");
    expect(resolveProviderServiceLifecycleAction("probe")).toBeNull();
    expect(buildProviderServiceLifecycleNote("SUSPEND")).toBe(
      "SUSPEND from provider service control plane."
    );
  });

  it("formats action notices and keeps active services delete-protected", () => {
    const service = { serviceName: "Quote Service" };
    expect(buildProviderServiceActionNotice(service, "probe")).toBe(
      "已触发 Quote Service 的即时探活。"
    );
    expect(buildProviderServiceActionNotice(service, "delete")).toBe(
      "已逻辑删除 Quote Service。"
    );
    expect(buildProviderServiceActionNotice(service, "pause")).toBe(
      "已执行 PAUSE: Quote Service"
    );
    expect(canDeleteProviderService({ controlStatus: "active" })).toBe(false);
    expect(canDeleteProviderService({ controlStatus: "inactive" })).toBe(true);
  });
});
