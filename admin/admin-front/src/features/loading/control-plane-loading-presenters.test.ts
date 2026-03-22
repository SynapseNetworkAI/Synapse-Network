import { describe, expect, it } from "vitest";

import { buildControlPlaneSignals } from "./control-plane-loading-presenters";

describe("control plane loading presenters", () => {
  it("marks auth tunnel as linking when the message is about connecting", () => {
    expect(buildControlPlaneSignals("正在连接 gateway-admin 控制面...")[0]).toEqual({
      label: "Auth Tunnel",
      value: "linking",
      tone: "cyan",
    });
  });

  it("marks projection mesh as syncing for sync-heavy loading states", () => {
    expect(buildControlPlaneSignals("正在同步系统运行状态...")[1]).toEqual({
      label: "Projection Mesh",
      value: "syncing",
      tone: "green",
    });
  });

  it("marks operator context as hydrating when data is being read", () => {
    expect(buildControlPlaneSignals("正在读取审批队列...")[2]).toEqual({
      label: "Operator Context",
      value: "hydrating",
      tone: "amber",
    });
  });
});