import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NavTreeNode } from "./nav-tree-node";

vi.mock("next/link", () => ({
  default: ({ children, href, onClick, ...props }: { children: React.ReactNode; href: string; onClick?: () => void }) => React.createElement("a", { href, onClick, ...props }, children),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  motion: {
    create: () => ({ children, ...props }: { children?: React.ReactNode }) => React.createElement("div", props, children),
  },
}));

vi.mock("@chakra-ui/react", () => {
  const element = (tag: string, displayName: string) => {
    const MockComponent = ({ children, ...props }: { children?: React.ReactNode }) => React.createElement(tag, props, children);
    MockComponent.displayName = displayName;
    return MockComponent;
  };
  return {
    Box: element("div", "MockBox"),
    Button: element("button", "MockButton"),
    Flex: element("div", "MockFlex"),
    Stack: element("div", "MockStack"),
    Text: element("span", "MockText"),
  };
});

describe("NavTreeNode", () => {
  it("treats parent nodes as expandable controls even when a stale href exists", () => {
    const html = renderToStaticMarkup(
      React.createElement(NavTreeNode, {
        item: {
          id: "dashboard",
          title: "控制台",
          icon: "OV",
          path: "/dashboard",
          description: "展开查看概览与运行态子菜单。",
          children: [
            {
              id: "dashboard-overview",
              title: "概览",
              icon: "01",
              path: "/dashboard/overview",
            },
          ],
        },
        depth: 0,
        expandedIds: new Set(["dashboard"]),
        activePathIds: new Set(["dashboard", "dashboard-overview"]),
        onToggle: () => undefined,
        onNavigate: () => undefined,
      }),
    );

    expect(html).not.toContain('href="/dashboard"');
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('href="/dashboard/overview"');
    expect(html).toContain('data-nav-path="/dashboard/overview"');
  });

  it("keeps leaf page nodes navigable", () => {
    const html = renderToStaticMarkup(
      React.createElement(NavTreeNode, {
        item: {
          id: "dashboard-overview",
          title: "概览",
          icon: "01",
          path: "/dashboard/overview",
        },
        depth: 0,
        expandedIds: new Set(),
        activePathIds: new Set(["dashboard-overview"]),
        onToggle: () => undefined,
        onNavigate: () => undefined,
      }),
    );

    expect(html).toContain('href="/dashboard/overview"');
    expect(html).toContain('data-nav-id="dashboard-overview"');
    expect(html).not.toContain('role="button"');
  });

  it("keeps sibling page nodes as links instead of expandable controls", () => {
    const html = renderToStaticMarkup(
      React.createElement(NavTreeNode, {
        item: {
          id: "execution",
          title: "执行队列",
          icon: "EX",
          path: "/execution",
        },
        depth: 1,
        expandedIds: new Set(["control-overview", "dashboard"]),
        activePathIds: new Set(["control-overview", "dashboard", "dashboard-overview"]),
        onToggle: () => undefined,
        onNavigate: () => undefined,
      }),
    );

    expect(html).toContain('href="/execution"');
    expect(html).toContain('data-nav-id="execution"');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('aria-expanded');
  });
});
