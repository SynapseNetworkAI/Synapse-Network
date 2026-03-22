import { describe, expect, it } from "vitest";

import { getFinanceMetricGlossary, getFinanceQueueGlossary } from "./finance-glossary";

describe("finance glossary", () => {
  it("returns the shared detailed hint for signed difference", () => {
    expect(getFinanceMetricGlossary("signedDifference")).toEqual({
      label: "Signed difference",
      meta: "按 chain vault - ledger obligation 计算。",
      hint: "带方向偏差，按 chain vault - ledger obligation 计算；负值代表 vault deficit，正值代表 vault surplus。",
    });
  });

  it("returns the unified queue wording for deposit exceptions", () => {
    expect(getFinanceQueueGlossary("depositExceptions")).toEqual({
      label: "Deposit exceptions",
      description: "充值异常积压通常是对账偏差的第一关联信号。",
    });
  });

  it("returns unified finance wording for platform income", () => {
    expect(getFinanceMetricGlossary("platformIncome").label).toBe("Platform income");
    expect(getFinanceMetricGlossary("platformIncome").meta).toBe("当前平台收入池余额。");
  });

  it("explains that absolute delta can be non-zero during normal consumption settlement", () => {
    expect(getFinanceMetricGlossary("absoluteDelta").hint).toBe(
      "绝对偏差值，不区分正负方向，只回答买家侧账本义务和链上当前差了多少。用户发生消费后，这个值可以非 0，需结合 Treasury absolute delta 一起判断是否异常。",
    );
    expect(getFinanceMetricGlossary("treasuryAbsoluteDelta").hint).toBe(
      "按 chain vault 和 owner liability + provider payable + platform income 的总账差值计算；为 0 通常表示平台总账已经对齐。",
    );
  });
});