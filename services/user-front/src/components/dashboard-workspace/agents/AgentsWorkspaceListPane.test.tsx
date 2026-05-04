// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { createElement } from "react";

import AgentsWorkspaceListPane from "@/components/dashboard-workspace/agents/AgentsWorkspaceListPane";
import { renderWithLanguage } from "@/test/renderWithLanguage";

function renderPane(language: "en" | "zh") {
  return renderWithLanguage(
    createElement(AgentsWorkspaceListPane, {
      credentials: [],
      agentLimit: 5,
      canCreateAgent: true,
      isLoading: false,
      isManageMode: false,
      selectedAgentId: null,
      onOpenCreateModal: vi.fn(),
      onToggleManageMode: vi.fn(),
      onSelectAgent: vi.fn(),
      onRequestDeleteAgent: vi.fn(),
    }),
    language
  );
}

describe("AgentsWorkspaceListPane i18n", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders English agent workspace labels", () => {
    renderPane("en");

    expect(screen.getByText("Your Agents")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Create Agent \+/ })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage agents" })).toBeTruthy();
  });

  it("renders Chinese agent workspace labels without stale English CTA copy", () => {
    renderPane("zh");

    expect(screen.getByText("你的 Agents")).toBeTruthy();
    expect(screen.getByRole("button", { name: /创建 Agent \+/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "管理 Agents" })).toBeTruthy();
    expect(screen.queryByText("Your Agents")).toBeNull();
    expect(screen.queryByText("Create Agent +")).toBeNull();
    expect(screen.queryByText("Manage agents")).toBeNull();
  });
});
