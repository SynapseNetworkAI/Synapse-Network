import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DataTable,
  EmptyBlock,
  MetricCard,
  ListFilterFieldPresets,
  ListFilterFields,
  ListFilterForm,
  ListPaginationBar,
  ListTableSurface,
  MessageBanner,
  OverlayPanel,
  SearchInput,
  SentinelStatusChip,
  SurfaceCard,
  StatusChip,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
} from "./console-ui";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));

vi.mock("@chakra-ui/react", () => {
  const element = (tag: string, displayName: string) => {
    const MockComponent = ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
    }) => React.createElement(tag, props, children);
    MockComponent.displayName = displayName;
    return MockComponent;
  };
  const MockInput = ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement("input", props, children);
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
        React.createElement("div", null, "filters")
      )
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
      })
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
      })
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
      })
    );

    expect(html).toContain("审核结果台账");
    expect(html).toContain("filter-area");
    expect(html).toContain("table-area");
    expect(html).toContain("pagination-area");
  });
});

describe("OverlayPanel", () => {
  it("renders operation details as a centered modal dialog, not a side edit surface", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        OverlayPanel,
        {
          open: true,
          title: "提现审核详情",
          description: "确认后再提交放行或驳回。",
          onClose: () => undefined,
        },
        React.createElement("div", null, "modal body")
      )
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Action Modal");
    expect(html).toContain("modal body");
    expect(html).not.toContain("Edit Surface");
    expect(html).not.toContain('role="complementary"');
  });
});

describe("shared console primitives", () => {
  it("renders surfaces and metric cards with shadcn-style semantic tokens", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          SurfaceCard,
          {
            eyebrow: "Control module",
            title: "配置中心",
            description: "只展示状态和入口。",
          },
          React.createElement("div", null, "overview body")
        ),
        React.createElement(MetricCard, {
          label: "Runtime Source",
          value: "published",
          meta: "Gateway reads the active snapshot.",
        })
      )
    );

    expect(html).toContain("shadcn.card");
    expect(html).toContain("shadcn.border");
    expect(html).toContain("shadcn.foreground");
    expect(html).toContain("var(--console-panel)");
    expect(html).toContain("配置中心");
  });

  it("renders status chips and message banners for modal review surfaces", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(StatusChip, { value: "COMPLETED" }),
        React.createElement(SentinelStatusChip, {
          label: "NODE ACTIVE",
          tone: "green",
        }),
        React.createElement(MessageBanner, {
          kind: "error",
          message: "Internal server error",
        }),
        React.createElement(MessageBanner, {
          kind: "success",
          message: "审核已提交",
        })
      )
    );

    expect(html).toContain("COMPLETED");
    expect(html).toContain("NODE ACTIVE");
    expect(html).toContain("Internal server error");
    expect(html).toContain("审核已提交");
  });

  it("renders search input and table primitives used by paginated admin pages", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(SearchInput, {
          value: "wd-123",
          placeholder: "Search withdrawals",
          onChange: () => undefined,
        }),
        React.createElement(
          DataTable,
          null,
          React.createElement(
            TableHeaderRow,
            null,
            React.createElement(Th, null, "Withdrawal")
          ),
          React.createElement(
            TableBody,
            null,
            React.createElement(
              "tr",
              null,
              React.createElement(Td, null, "wd-123")
            )
          )
        ),
        React.createElement(EmptyBlock, {
          title: "暂无数据",
          description: "没有符合条件的记录。",
        })
      )
    );

    expect(html).toContain("Search withdrawals");
    expect(html).toContain("Withdrawal");
    expect(html).toContain("wd-123");
    expect(html).toContain("暂无数据");
  });

  it("renders pagination controls with disabled state and count metadata", () => {
    const html = renderToStaticMarkup(
      React.createElement(ListPaginationBar, {
        pageSize: 10,
        pageSizeOptions: [10, 20],
        totalPages: 3,
        totalCount: 24,
        currentPage: 1,
        loading: true,
        canPrevious: false,
        canNext: true,
        onPageSizeChange: () => undefined,
        onPrevious: () => undefined,
        onNext: () => undefined,
      })
    );

    expect(html).toContain("每页 10 条");
    expect(html).toContain("每页 20 条");
    expect(html).toContain("第 ");
    expect(html).toContain("共 24 条");
    expect(html).toContain("disabled");
  });
});
