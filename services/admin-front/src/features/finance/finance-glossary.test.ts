import { describe, expect, it } from "vitest";

import { getFinanceMetricGlossary, getFinanceQueueGlossary } from "./finance-glossary";

describe("finance glossary", () => {
  it("returns the shared detailed hint for signed difference", () => {
    expect(getFinanceMetricGlossary("signedDifference")).toEqual({
      label: "差异方向",
      meta: "用于判断是偏多还是偏少。",
      hint: "负值表示资金偏少，正值表示资金偏多。",
    });
  });

  it("returns the unified queue wording for deposit exceptions", () => {
    expect(getFinanceQueueGlossary("depositExceptions")).toEqual({
      label: "Deposit exceptions",
      description: "充值异常积压通常是对账偏差的第一关联信号。",
    });
  });

  it("returns unified finance wording for platform income", () => {
    expect(getFinanceMetricGlossary("platformIncome").label).toBe("平台累计收入");
    expect(getFinanceMetricGlossary("platformIncome").meta).toBe("当前平台已经确认的收入。");
  });

  it("explains that absolute delta can be non-zero during normal consumption settlement", () => {
    expect(getFinanceMetricGlossary("absoluteDelta").hint).toBe(
      "只看差了多少，不区分多还是少，适合先判断问题大不大。",
    );
    expect(getFinanceMetricGlossary("treasuryAbsoluteDelta").hint).toBe(
      "适合先看平台整体差了多少，若不为 0，建议进入对账详情查看原因。",
    );
  });
});