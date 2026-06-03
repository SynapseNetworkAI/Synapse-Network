import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NavTreeNode } from "./nav-tree-node";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  motion: {
    create:
      () =>
      ({ children, ...props }: { children?: React.ReactNode }) =>
        React.createElement("div", props, children),
  },
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
  return {
    Box: element("div", "MockBox"),
    Button: element("button", "MockButton"),
    Flex: element("div", "MockFlex"),
    Stack: element("div", "MockStack"),
    Text: element("span", "MockText"),
  };
});

type TestNode = {
  type: string;
  props: Record<string, unknown>;
  children: TestNode[];
};

function resolveElement(element: React.ReactNode): TestNode[] {
  if (
    element === null ||
    element === undefined ||
    typeof element === "boolean"
  ) {
    return [];
  }

  if (typeof element === "string" || typeof element === "number") {
    return [
      {
        type: "#text",
        props: { value: element },
        children: [],
      },
    ];
  }

  if (Array.isArray(element)) {
    return element.flatMap((child) => resolveElement(child));
  }

  if (!React.isValidElement(element)) {
    return [];
  }

  if (element.type === React.Fragment) {
    return resolveElement(element.props.children);
  }

  if (typeof element.type === "function") {
    return resolveElement(element.type(element.props));
  }

  return [
    {
      type: String(element.type),
      props: element.props as Record<string, unknown>,
      children: resolveElement(element.props.children),
    },
  ];
}

function flattenNodes(nodes: TestNode[]): TestNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

function renderNodeTree(props: React.ComponentProps<typeof NavTreeNode>) {
  return flattenNodes(resolveElement(React.createElement(NavTreeNode, props)));
}

describe("NavTreeNode", () => {
  it("treats category parent nodes as expandable controls even when a stale href exists", () => {
    const html = renderToStaticMarkup(
      React.createElement(NavTreeNode, {
        item: {
          id: "dashboard",
          title: "控制台",
          icon: "OV",
          nodeType: "category",
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
      })
    );

    expect(html).not.toContain('href="/dashboard"');
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('href="/dashboard/overview"');
    expect(html).toContain('data-nav-path="/dashboard/overview"');
  });

  it("keeps page parent nodes navigable while exposing a separate expand control", () => {
    const html = renderToStaticMarkup(
      React.createElement(NavTreeNode, {
        item: {
          id: "role-permissions",
          title: "角色权限",
          icon: "RB",
          nodeType: "page",
          path: "/role-permissions",
          description: "权限矩阵、模块边界与 reviewer 分工。",
          children: [
            {
              id: "permissions-matrix",
              title: "权限矩阵",
              icon: "PM",
              nodeType: "panel",
              path: "/role-permissions#permissions-matrix",
            },
          ],
        },
        depth: 1,
        expandedIds: new Set(["role-permissions"]),
        activePathIds: new Set(["identity-access", "role-permissions"]),
        onToggle: () => undefined,
        onNavigate: () => undefined,
      })
    );

    expect(html).toContain('href="/role-permissions"');
    expect(html).toContain('data-nav-id="role-permissions"');
    expect(html).toContain('data-nav-path="/role-permissions"');
    expect(html).toContain('aria-label="Collapse section"');
    expect(html).toContain('href="/role-permissions#permissions-matrix"');
    expect(html).toContain(
      'data-nav-path="/role-permissions#permissions-matrix"'
    );
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
      })
    );

    expect(html).toContain('href="/dashboard/overview"');
    expect(html).toContain('data-nav-id="dashboard-overview"');
    expect(html).not.toContain('role="button"');
  });

  it("renders active navigation with sidebar theme tokens", () => {
    const html = renderToStaticMarkup(
      React.createElement(NavTreeNode, {
        item: {
          id: "config-center",
          title: "配置中心",
          icon: "CF",
          nodeType: "page",
          path: "/config",
        },
        depth: 0,
        expandedIds: new Set(),
        activePathIds: new Set(["config-center"]),
        onToggle: () => undefined,
        onNavigate: () => undefined,
      })
    );

    expect(html).toContain("var(--sidebar-ring)");
    expect(html).toContain("var(--sidebar-primary)");
    expect(html).toContain("var(--sidebar-foreground)");
    expect(html).toContain('data-nav-path="/config"');
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
        activePathIds: new Set([
          "control-overview",
          "dashboard",
          "dashboard-overview",
        ]),
        onToggle: () => undefined,
        onNavigate: () => undefined,
      })
    );

    expect(html).toContain('href="/execution"');
    expect(html).toContain('data-nav-id="execution"');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("aria-expanded");
  });

  it("keeps panel hash nodes navigable", () => {
    const html = renderToStaticMarkup(
      React.createElement(NavTreeNode, {
        item: {
          id: "module-boundaries",
          title: "模块边界",
          icon: "MB",
          nodeType: "panel",
          path: "/role-permissions#module-boundaries",
        },
        depth: 2,
        expandedIds: new Set(["identity-access", "role-permissions"]),
        activePathIds: new Set(["identity-access", "role-permissions"]),
        onToggle: () => undefined,
        onNavigate: () => undefined,
      })
    );

    expect(html).toContain('href="/role-permissions#module-boundaries"');
    expect(html).toContain('data-nav-id="module-boundaries"');
    expect(html).toContain(
      'data-nav-path="/role-permissions#module-boundaries"'
    );
    expect(html).not.toContain('role="button"');
  });

  it("calls onNavigate for normal link clicks and leaves modifier clicks to the browser", () => {
    const onNavigate = vi.fn();
    const nodes = renderNodeTree({
      item: {
        id: "role-permissions",
        title: "角色权限",
        icon: "RB",
        nodeType: "page",
        path: "/role-permissions",
      },
      depth: 0,
      expandedIds: new Set(),
      activePathIds: new Set(),
      onToggle: () => undefined,
      onNavigate,
    });
    const link = nodes.find(
      (node) => node.props["data-nav-path"] === "/role-permissions"
    );
    expect(link).toBeTruthy();
    const normalEvent = {
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      button: 0,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    (link?.props.onClick as (event: typeof normalEvent) => void)(normalEvent);

    expect(normalEvent.preventDefault).toHaveBeenCalledOnce();
    expect(normalEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledWith("/role-permissions");

    const modifierEvent = {
      ...normalEvent,
      metaKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    (link?.props.onClick as (event: typeof modifierEvent) => void)(
      modifierEvent
    );
    expect(modifierEvent.preventDefault).not.toHaveBeenCalled();
    expect(modifierEvent.stopPropagation).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("toggles non-link category rows with click and keyboard activation", () => {
    const onToggle = vi.fn();
    const nodes = renderNodeTree({
      item: {
        id: "identity-access",
        title: "身份与权限",
        icon: "IA",
        nodeType: "category",
        children: [
          {
            id: "users",
            title: "后台用户",
            icon: "ID",
            nodeType: "page",
            path: "/users",
          },
        ],
      },
      depth: 0,
      expandedIds: new Set(["identity-access"]),
      activePathIds: new Set(["identity-access", "users"]),
      onToggle,
      onNavigate: () => undefined,
    });
    const categoryControl = nodes.find(
      (node) => node.type === "div" && node.props.role === "button"
    );
    expect(categoryControl).toBeTruthy();

    (categoryControl?.props.onClick as () => void)();
    expect(onToggle).toHaveBeenCalledWith("identity-access");

    const ignoredKeyEvent = {
      key: "Escape",
      preventDefault: vi.fn(),
    };
    (
      categoryControl?.props.onKeyDown as (
        event: typeof ignoredKeyEvent
      ) => void
    )(ignoredKeyEvent);
    expect(ignoredKeyEvent.preventDefault).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledTimes(1);

    const enterKeyEvent = {
      key: "Enter",
      preventDefault: vi.fn(),
    };
    (categoryControl?.props.onKeyDown as (event: typeof enterKeyEvent) => void)(
      enterKeyEvent
    );
    expect(enterKeyEvent.preventDefault).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
