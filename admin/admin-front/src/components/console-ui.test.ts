import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ListFilterFieldPresets, ListFilterFields, ListFilterForm, ListTableSurface } from "./console-ui";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement("a", { href }, children),
}));

vi.mock("@chakra-ui/react", () => {
  const element = (tag: string, displayName: string) => {
    const MockComponent = ({ children, ...props }: { children?: React.ReactNode }) => React.createElement(tag, props, children);
    MockComponent.displayName = displayName;
    return MockComponent;
  };
  const MockInput = ({ children, ...props }: { children?: React.ReactNode }) => React.createElement("input", props, children);
  MockInput.displayName = "MockInput";
  return {
    Badge: element("span", "MockBadge"),
    Box: element("div", "MockBox"),
    Button: element("button", "MockButton"),
    Flex: element("div", "MockFlex"),
    Grid: element("div", "MockGrid"),
    Heading: element("h2", "MockHeading"),
    Input: MockInput,
    Stack: element("div", "MockStack"),
    Text: element("span", "MockText"),
  };
});

describe("ListFilterForm", () => {
  it("renders shared search and reset actions with helper text", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ListFilterForm,
        {
          onSubmit: () => undefined,
          onReset: () => undefined,
          helperText: "支持回车直接搜索；重置筛选会恢复默认条件并回到第一页。",
        },
        React.createElement("div", null, "filters"),
      ),
    );

    expect(html).toContain("filters");
    expect(html).toContain("搜索");
    expect(html).toContain("重置筛选");
    expect(html).toContain("支持回车直接搜索");
  });
});

describe("ListFilterFields", () => {
  it("renders field configs without page-local filter grid markup", () => {
    const html = renderToStaticMarkup(
      React.createElement(ListFilterFields, {
        templateColumns: "repeat(3, minmax(0, 1fr))",
        fields: [
          ListFilterFieldPresets.keyword({
            value: "",
            onChange: () => undefined,
            placeholder: "搜索提现单 / 用户地址 / requestId / reviewer",
          }),
          {
            key: "reviewer",
            kind: "text",
            value: "",
            onChange: () => undefined,
            placeholder: "reviewer 邮箱或角色",
            listId: "reviewers",
            listOptions: ["finance-reviewer@example.com"],
          },
          ListFilterFieldPresets.status({
            key: "decision",
            value: "all",
            onChange: () => undefined,
            allLabel: "全部处理结论",
            options: [{ value: "APPROVE", label: "放行" }],
          }),
        ],
      }),
    );

    expect(html).toContain("搜索提现单 / 用户地址 / requestId / reviewer");
    expect(html).toContain("reviewer 邮箱或角色");
    expect(html).toContain("全部处理结论");
    expect(html).toContain("finance-reviewer@example.com");
  });

  it("builds standard date range fields from the shared preset", () => {
    const html = renderToStaticMarkup(
      React.createElement(ListFilterFields, {
        templateColumns: "repeat(2, minmax(0, 1fr))",
        fields: ListFilterFieldPresets.dateRange({
          startKey: "reviewedFrom",
          startValue: "2026-03-20",
          onStartChange: () => undefined,
          endKey: "reviewedTo",
          endValue: "2026-03-23",
          onEndChange: () => undefined,
        }),
      }),
    );

    expect(html).toContain("2026-03-20");
    expect(html).toContain("2026-03-23");
  });
});

describe("ListTableSurface", () => {
  it("renders the filter, table, and pagination regions inside one shared surface", () => {
    const html = renderToStaticMarkup(
      React.createElement(ListTableSurface, {
        eyebrow: "Review Ledger",
        title: "审核结果台账",
        description: "统一列表页骨架。",
        stamp: "共 20 条",
        filter: React.createElement("div", null, "filter-area"),
        table: React.createElement("div", null, "table-area"),
        pagination: React.createElement("div", null, "pagination-area"),
      }),
    );

    expect(html).toContain("审核结果台账");
    expect(html).toContain("filter-area");
    expect(html).toContain("table-area");
    expect(html).toContain("pagination-area");
  });
});