import { describe, expect, it } from "vitest";

import { getReconciliationMetricGlossary, getReconciliationQueueGlossary } from "./reconciliation-glossary";

describe("reconciliation glossary", () => {
  it("returns the shared metric hint for signed difference", () => {
    expect(getReconciliationMetricGlossary("signedDifference")).toEqual({
      label: "Signed difference",
      meta: "按 chain vault - ledger obligation 计算。",
      hint: "带方向偏差，按 chain vault - ledger obligation 计算；负值代表 vault deficit，正值代表 vault surplus。",
    });
  });

  it("returns the shared queue description for deposit exceptions", () => {
    expect(getReconciliationQueueGlossary("depositExceptions")).toEqual({
      label: "Deposit exceptions",
      description: "充值异常积压通常是对账偏差的第一关联信号。",
    });
  });
});